import { toEvent } from '@/lib/bolna'
import { bolnaDenied } from '@/lib/config'
import { adoptExecution, applyEvent } from '@/lib/engine'

// Bolna POSTs the full execution object on every status change (several deliveries per call, same `id`),
// with the shared-secret header set under Agent → Extractions → Webhook → Add headers (see bolnaDenied).
// Responses: 200 applied or duplicate, 202 unknown call (no retry wanted), 400 malformed, 401/403 rejected,
// 503 transient failure (Bolna retries non-2xx).
export async function POST(req: Request) {
  const denied = bolnaDenied(req)
  if (denied) return denied

  const body = await req.json().catch(() => null)
  const ev = toEvent(body)
  if (!ev) return Response.json({ error: 'not a Bolna execution payload' }, { status: 400 })
  try {
    let r = await applyEvent({ providerId: ev.id }, ev, 'webhook', body)
    if (!r && ev.ourId) {
      // A call Bolna accepted but whose id we never stored: match it by the id we sent in user_data.
      await adoptExecution(ev.ourId, ev.id)
      r = await applyEvent({ providerId: ev.id }, ev, 'webhook', body)
    }
    if (!r) return Response.json({ ok: true, ignored: 'unknown execution' }, { status: 202 })
    return Response.json({ ok: true, changed: r.changed })
  } catch (e) {
    console.error('webhook processing failed:', (e as Error).message)
    return Response.json({ error: 'temporary failure, please retry' }, { status: 503 })
  }
}
