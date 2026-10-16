// MOCKED: the engine is replaced with a stub, so this only tests the tool route's own logic.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const applyEvent = vi.fn()
const adoptExecution = vi.fn()
vi.mock('@/lib/engine', () => ({ applyEvent, adoptExecution, isUuid: (s: string) => /^[0-9a-f-]{36}$/.test(s) }))
const { POST } = await import('@/app/api/bolna/tool/route')

const SECRET = 'test-webhook-secret-123'
const OURS = '0b8f5c2e-7d1a-4f3b-9c6e-2a1d3e4f5a6b'
// As Bolna sends it: every %(x)s-substituted value is a string.
const params = { execution_id: 'exec-1', in_stock: 'yes', qty_available: 'None', price_inr: '540.0', ready_in_minutes: '10', can_hold: 'True' }
const call = (body: unknown, headers: Record<string, string> = { 'x-poochho-secret': SECRET }) =>
  POST(new Request('http://localhost/api/bolna/tool', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }))

beforeEach(() => {
  applyEvent.mockReset()
  adoptExecution.mockReset()
  process.env.BOLNA_WEBHOOK_SECRET = SECRET
  delete process.env.BOLNA_WEBHOOK_IPS
})

describe('POST /api/bolna/tool', () => {
  it('needs the shared secret header and passes the optional IP allowlist', async () => {
    expect((await call(params, {})).status).toBe(401)
    expect((await call(params, { 'x-poochho-secret': 'wrong' })).status).toBe(401)
    process.env.BOLNA_WEBHOOK_IPS = '13.203.39.153'
    expect((await call(params, { 'x-poochho-secret': SECRET, 'x-forwarded-for': '1.2.3.4' })).status).toBe(403)
    expect(applyEvent).not.toHaveBeenCalled()
  })

  it("reads Bolna's string values and applies them as a live answer, answering with a tiny body", async () => {
    applyEvent.mockResolvedValueOnce({ id: 'row', changed: true })
    const res = await call(params)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true }) // nothing about other shops ever goes back to the agent
    const [where, ev, source, payload] = applyEvent.mock.calls[0]
    expect(where).toEqual({ providerId: 'exec-1' })
    expect(ev).toEqual({ status: '__live', live: { in_stock: 'yes', price_inr: 540, ready_in_minutes: 10, can_hold: 'yes' } })
    expect(source).toBe('tool')
    expect(payload).toEqual({ status: '__live', tool_call: ev.live }) // only the parsed answer is logged
  })

  it('treats stale or repeated reports as harmless (200, unchanged) and unknown calls as 202', async () => {
    applyEvent.mockResolvedValueOnce({ id: 'row', changed: false })
    expect((await call(params)).status).toBe(200)
    applyEvent.mockResolvedValueOnce(null)
    expect((await call(params)).status).toBe(202)
    applyEvent.mockRejectedValueOnce(new Error('db down'))
    expect((await call(params)).status).toBe(503)
  })

  it('falls back to our own id, adopting a call whose Bolna id was never stored', async () => {
    applyEvent.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: OURS, changed: true })
    expect((await call({ ...params, poochho_execution_id: OURS })).status).toBe(200)
    expect(adoptExecution).toHaveBeenCalledWith(OURS, 'exec-1')
    applyEvent.mockResolvedValueOnce({ id: OURS, changed: true })
    expect((await call({ in_stock: 'no', execution_id: 'None', poochho_execution_id: OURS })).status).toBe(200)
    expect(applyEvent.mock.calls.at(-1)![0]).toEqual({ id: OURS })
  })

  it('rejects reports with no call id or no usable answer', async () => {
    expect((await call({ in_stock: 'yes' })).status).toBe(400)
    expect((await call({ execution_id: 'exec-1', in_stock: 'maybe', can_hold: 'None' })).status).toBe(400)
    expect(applyEvent).not.toHaveBeenCalled()
  })
})
