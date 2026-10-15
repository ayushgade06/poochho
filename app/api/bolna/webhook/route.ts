import { toEvent } from '@/lib/bolna'
import { safeEqual } from '@/lib/config'
import { applyEvent } from '@/lib/engine'

// Bolna POSTs the full execution object on every status change (several deliveries per call, same `id`).
// Bolna does not sign webhooks; its documented trust mechanisms are custom headers and source IPs, so we
// require a shared secret header (set under Agent → Extractions → Webhook → Add headers) and optionally an
// IP allowlist. Responses: 200 applied/duplicate, 202 unknown call (no retry wanted), 400 malformed,
// 401/403 rejected, 503 transient failure (Bolna retries non-2xx).
export async function POST(req: Request) {
  const secret = process.env.BOLNA_WEBHOOK_SECRET
  const given = req.headers.get('x-poochho-secret') ?? new URL(req.url).searchParams.get('secret')
  if (!secret || !given || !safeEqual(given, secret)) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const allow = (process.env.BOLNA_WEBHOOK_IPS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (allow.length) {
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || ''
    if (!allow.includes(ip)) return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const ev = toEvent(body)
  if (!ev) return Response.json({ error: 'not a Bolna execution payload' }, { status: 400 })
  try {
    const r = await applyEvent({ providerId: ev.id }, ev, 'webhook', body)
    if (!r) return Response.json({ ok: true, ignored: 'unknown execution' }, { status: 202 })
    return Response.json({ ok: true, changed: r.changed })
  } catch (e) {
    console.error('webhook processing failed:', (e as Error).message)
    return Response.json({ error: 'temporary failure, please retry' }, { status: 503 })
  }
}
