// MOCKED: the engine and Sarvam are stubs, so this only tests the judge-mode and voice routes' own rules.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const startWebCall = vi.fn()
const withinDailyCap = vi.fn()
const transcribe = vi.fn()
vi.mock('@/lib/engine', () => ({ startWebCall, withinDailyCap, isUuid: (s: string) => /^[0-9a-f-]{36}$/.test(s), errorResponse: (e: { message: string; status?: number }) => Response.json({ error: e.message }, { status: e.status ?? 500 }) }))
// Like the engine: claim the call, then spend the cap through `allowed` (only a real start counts).
const session = (s: object) => async (_id: string, allowed: () => Promise<boolean>) => {
  if (!(await allowed())) throw Object.assign(new Error("Today's judge-mode calls are used up."), { status: 429 })
  return s
}
vi.mock('@/lib/sarvam', () => ({ sarvamConfigured: () => true, transcribe, understand: async () => ({ product: 'Dolo 650' }) }))
const webCall = (await import('@/app/api/executions/[id]/web-call/route')).POST
const stt = (await import('@/app/api/stt/route')).POST

const ID = '0b8f5c2e-7d1a-4f3b-9c6e-2a1d3e4f5a6b'
const TOKEN = 'test-operator-token-123'
const start = (headers: Record<string, string> = {}, id = ID) => webCall(new Request(`http://localhost/api/executions/${id}/web-call`, { method: 'POST', headers }), { params: Promise.resolve({ id }) })
const speak = (headers: Record<string, string> = {}) => {
  const fd = new FormData()
  fd.append('audio', new Blob(['voice'], { type: 'audio/webm' }))
  return stt(new Request('http://localhost/api/stt', { method: 'POST', body: fd, headers }))
}

beforeEach(() => {
  for (const f of [startWebCall, withinDailyCap, transcribe]) f.mockReset()
  Object.assign(process.env, { WEB_CALL_ENABLED: 'true', BOLNA_API_KEY: 'k', BOLNA_AGENT_ID: 'a', POOCHHO_ADMIN_TOKEN: TOKEN })
})

describe('POST /api/executions/[id]/web-call (judge mode)', () => {
  it('is off unless WEB_CALL_ENABLED is true', async () => {
    process.env.WEB_CALL_ENABLED = 'false'
    expect((await start()).status).toBe(403)
    expect(startWebCall).not.toHaveBeenCalled()
  })

  it('hands the one-time session to the browser, uncached, within the daily caps', async () => {
    withinDailyCap.mockResolvedValue(true)
    startWebCall.mockImplementation(session({ run_id: 'run-1', sip_password: 'p', expires_in: 120 }))
    const res = await start()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toMatchObject({ run_id: 'run-1' })
    expect(withinDailyCap).toHaveBeenCalledWith('judge', expect.any(Request))
  })

  it('refuses once the caps are used up, except for the operator', async () => {
    withinDailyCap.mockResolvedValue(false)
    startWebCall.mockImplementation(session({ run_id: 'run-2' }))
    expect((await start()).status).toBe(429)
    expect((await start({ 'x-admin-token': TOKEN })).status).toBe(200)
    expect(withinDailyCap).toHaveBeenCalledTimes(1) // the operator's start never touched the caps
  })

  it('404s for an id that is not a uuid', async () => {
    expect((await start({}, 'nope')).status).toBe(404)
  })
})

describe('POST /api/stt (voice input for everyone, capped)', () => {
  it('transcribes for anyone within the caps, and says so when they are used up', async () => {
    transcribe.mockResolvedValue({ transcript: 'Dolo 650 ek strip', language: 'hi-IN' })
    withinDailyCap.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const ok = await speak()
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ transcript: 'Dolo 650 ek strip', language: 'hi-IN', fields: { product: 'Dolo 650' } })
    const capped = await speak()
    expect(capped.status).toBe(429)
    expect((await capped.json()).error).toMatch(/used up/)
    expect(withinDailyCap).toHaveBeenCalledWith('voice', expect.any(Request))
  })

  it('never caps the operator', async () => {
    transcribe.mockResolvedValue({ transcript: 'x', language: null })
    expect((await speak({ 'x-admin-token': TOKEN })).status).toBe(200)
    expect(withinDailyCap).not.toHaveBeenCalled()
  })
})
