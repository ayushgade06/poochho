// MOCKED: the engine is replaced with a stub, so this only tests the webhook route's own logic.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const applyEvent = vi.fn()
const adoptExecution = vi.fn()
vi.mock('@/lib/engine', () => ({ applyEvent, adoptExecution }))
const { POST } = await import('@/app/api/bolna/webhook/route')

const SECRET = 'test-webhook-secret-123'
const payload = { id: 'exec-1', status: 'completed', transcript: 'assistant: hi', conversation_duration: 31, extracted_data: { Q: { in_stock: { objective: 'yes', subjective: '' } } }, telephony_data: { to_number: '+919999999999' } }
const call = (body: unknown, headers: Record<string, string> = { 'x-poochho-secret': SECRET }, url = 'http://localhost/api/bolna/webhook') =>
  POST(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }))

beforeEach(() => {
  applyEvent.mockReset()
  adoptExecution.mockReset()
  process.env.BOLNA_WEBHOOK_SECRET = SECRET
  delete process.env.BOLNA_WEBHOOK_IPS
})

describe('POST /api/bolna/webhook', () => {
  it('rejects requests without the shared secret, or when none is configured', async () => {
    expect((await call(payload, {})).status).toBe(401)
    expect((await call(payload, { 'x-poochho-secret': 'wrong' })).status).toBe(401)
    delete process.env.BOLNA_WEBHOOK_SECRET
    expect((await call(payload)).status).toBe(401)
    expect(applyEvent).not.toHaveBeenCalled()
  })

  it('does not accept the secret in the URL (URLs end up in logs)', async () => {
    expect((await call(payload, {}, `http://localhost/api/bolna/webhook?secret=${SECRET}`)).status).toBe(401)
  })

  it('adopts a call whose provider id was never stored, via the id echoed in recipient_data', async () => {
    applyEvent.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'row', changed: true })
    const ours = '0b8f5c2e-7d1a-4f3b-9c6e-2a1d3e4f5a6b'
    const res = await call({ ...payload, context_details: { recipient_data: { poochho_execution_id: ours } } })
    expect(res.status).toBe(200)
    expect(adoptExecution).toHaveBeenCalledWith(ours, 'exec-1')
  })

  it('rejects malformed payloads', async () => {
    expect((await call('not json')).status).toBe(400)
    expect((await call({ status: 'completed' })).status).toBe(400)
    expect((await call({ id: 'x' })).status).toBe(400)
    expect(applyEvent).not.toHaveBeenCalled()
  })

  it('applies the normalised event by provider id and reports duplicates as unchanged', async () => {
    applyEvent.mockResolvedValueOnce({ id: 'row', changed: true }).mockResolvedValueOnce({ id: 'row', changed: false })
    const first = await call(payload)
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ ok: true, changed: true })
    const [where, ev, source] = applyEvent.mock.calls[0]
    expect(where).toEqual({ providerId: 'exec-1' })
    expect(ev).toMatchObject({ id: 'exec-1', status: 'completed', transcript: 'assistant: hi', duration: 31 })
    expect(source).toBe('webhook')
    expect(await (await call(payload)).json()).toEqual({ ok: true, changed: false })
  })

  it('answers 202 for unknown calls and 503 for transient failures (so Bolna retries)', async () => {
    applyEvent.mockResolvedValueOnce(null)
    expect((await call(payload)).status).toBe(202)
    applyEvent.mockRejectedValueOnce(new Error('db down'))
    expect((await call(payload)).status).toBe(503)
  })

  it('enforces the optional source-IP allowlist', async () => {
    process.env.BOLNA_WEBHOOK_IPS = '13.203.39.153, 13.126.9.249'
    applyEvent.mockResolvedValue({ id: 'x', changed: true })
    expect((await call(payload, { 'x-poochho-secret': SECRET, 'x-forwarded-for': '1.2.3.4' })).status).toBe(403)
    expect((await call(payload, { 'x-poochho-secret': SECRET, 'x-forwarded-for': '13.126.9.249, 10.0.0.1' })).status).toBe(200)
  })
})
