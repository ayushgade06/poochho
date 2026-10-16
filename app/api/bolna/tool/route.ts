import { bolnaDenied } from '@/lib/config'
import { adoptExecution, applyEvent, isUuid } from '@/lib/engine'
import { parseLive } from '@/lib/extraction'

// The agent's report_availability tool, called mid-call right after the shopkeeper answers (Agent → Tools; see
// docs/bolna-setup.md). Bolna waits about 10 seconds for this reply and reads it back to the model, so it is
// tiny and never mentions other shops. Same trust rules as the webhook (shared-secret header, optional IP
// allowlist). Bolna fills a parameter named execution_id with its own call id; poochho_execution_id (our id, sent
// in user_data) is the fallback. Responses: 200 applied or unchanged, 202 unknown call, 400 nothing usable,
// 401/403 rejected, 503 transient failure.
export async function POST(req: Request) {
  const denied = bolnaDenied(req)
  if (denied) return denied
  const body = await req.json().catch(() => null)
  const live = parseLive(body)
  const pid = typeof body?.execution_id === 'string' && body.execution_id !== 'None' ? body.execution_id : ''
  const ours = typeof body?.poochho_execution_id === 'string' && isUuid(body.poochho_execution_id) ? body.poochho_execution_id : ''
  if (!live || (!pid && !ours)) return Response.json({ ok: false, error: 'expected execution_id and at least one answer' }, { status: 400 })
  // What call_events and replays keep: only the parsed answer, in the shape scripted calls use.
  const [ev, payload] = [{ status: '__live', live }, { status: '__live', tool_call: live }]
  try {
    let r = pid ? await applyEvent({ providerId: pid }, ev, 'tool', payload) : await applyEvent({ id: ours }, ev, 'tool', payload)
    if (!r && pid && ours) {
      await adoptExecution(ours, pid) // a call Bolna accepted but whose id we never stored
      r = await applyEvent({ providerId: pid }, ev, 'tool', payload)
    }
    if (!r) return Response.json({ ok: true, ignored: 'unknown call' }, { status: 202 })
    return Response.json({ ok: true })
  } catch (e) {
    console.error('tool call failed:', (e as Error).message)
    return Response.json({ ok: false }, { status: 503 })
  }
}
