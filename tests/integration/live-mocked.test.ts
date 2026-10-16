// Integration with a MOCKED provider: real Supabase, but every request to api.bolna.ai is answered by a stub,
// so no phone call can be placed. Exercises LIVE dispatch, concurrency, webhooks, polling and no-auto-retry.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

process.env.CALL_WINDOW_IST = '00:00-23:59' // run at any hour
process.env.MAX_CONCURRENCY = '2'
process.env.BOLNA_API_KEY = 'mock-key'
process.env.BOLNA_AGENT_ID = 'mock-agent'
process.env.LIVE_CALLS_ENABLED = 'true'
process.env.POOCHHO_ADMIN_TOKEN = 'test-operator-token-123'
process.env.BOLNA_WEBHOOK_SECRET = 'test-webhook-secret'

const realFetch = globalThis.fetch
const started: { to: string; body: Record<string, unknown> }[] = []
const polled: Record<string, unknown> = {}
let callMode: 'ok' | 'refuse' | 'hang' = 'ok' // how the mocked POST /call behaves
vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (!url.startsWith('https://api.bolna.ai')) return realFetch(input, init)
  if (url.endsWith('/call') && init?.method === 'POST') {
    const body = JSON.parse(String(init.body))
    if (callMode === 'refuse') return Response.json({ error: 1001, message: 'Invalid recipient_phone_number' }, { status: 400 })
    if (callMode === 'hang') throw new TypeError('fetch failed') // network error: the call may or may not exist
    started.push({ to: body.recipient_phone_number, body })
    return Response.json({ message: 'done', status: 'queued', execution_id: `mock-${started.length}` })
  }
  const m = /\/executions\/([^/]+)$/.exec(url)
  if (m) return Response.json(polled[m[1]] ?? { id: m[1], status: 'ringing' })
  return Response.json({ message: 'not mocked' }, { status: 404 })
})

const { adoptExecution, applyEvent, db, dispatchQueued, getSearch, tick } = await import('@/lib/engine')
const SHOPS = ['zz-mock-a', 'zz-mock-b', 'zz-mock-c', 'zz-mock-d']
let requestId = ''

beforeAll(async () => {
  const now = new Date().toISOString()
  await db().from('shops').upsert(SHOPS.map((id, i) => ({ id, name: `Mock Shop ${i + 1}`, area: 'Test', source: 'live', phone: `+91000000001${i}`, consent_status: 'verified', consent_verified_at: now, opted_out_at: null })))
  const r = await db().from('search_requests').insert({ mode: 'live', product: 'Dolo 650', quantity: 2, unit: 'strip', city: 'Pune', area: 'Kothrud', language: 'hi' }).select('id').single()
  requestId = r.data!.id
  await db().from('call_executions').insert(SHOPS.map((shop_id) => ({ request_id: requestId, shop_id, mode: 'live', status: 'queued' })))
})
afterAll(async () => {
  await db().from('search_requests').delete().eq('id', requestId)
  await db().from('shops').delete().in('id', SHOPS)
  vi.unstubAllGlobals()
})

describe('LIVE orchestration against a mocked Bolna', () => {
  it('never has more calls in flight than the concurrency limit, and sends the agent variables', async () => {
    await Promise.all([dispatchQueued(), dispatchQueued()]) // two dispatchers racing
    expect(started.length).toBe(2)
    const s = (await getSearch(requestId, true))!
    expect(s.executions.filter((e) => e.status === 'dispatching').map((e) => e.provider_execution_id).sort()).toEqual(['mock-1', 'mock-2'])
    expect(s.executions.filter((e) => e.status === 'queued')).toHaveLength(2)
    expect(started[0].body).toMatchObject({ agent_id: 'mock-agent', user_data: { item: 'Dolo 650', quantity: '2 strip', customer_area: 'Kothrud', call_purpose: 'quote', timezone: 'Asia/Kolkata' } })
    expect(started[0].body).not.toHaveProperty('retry_config') // Bolna never retries on its own
    expect((started[0].body.user_data as Record<string, string>).poochho_execution_id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('applies webhooks by provider id, frees the line, and dispatches the next queued call', async () => {
    await applyEvent({ providerId: 'mock-1' }, { status: 'in-progress' }, 'webhook')
    await applyEvent({ providerId: 'mock-1' }, { status: 'completed', duration: 30, cost: 9, transcript: 'assistant: hi\nuser: haan', extracted_data: { Q: { in_stock: { objective: 'yes', subjective: '' }, unit_price_inr: { objective: null, subjective: '30' } } } }, 'webhook')
    await applyEvent({ providerId: 'mock-2' }, { status: 'no-answer' }, 'webhook')
    await dispatchQueued()
    expect(started.length).toBe(4)
    const s = (await getSearch(requestId, true))!
    const byPid = Object.fromEntries(s.executions.map((e) => [e.provider_execution_id, e]))
    expect(byPid['mock-1']).toMatchObject({ status: 'done', provider_status: 'completed', cost_cents: 9 })
    expect(byPid['mock-1'].extracted?.unit_price_inr).toBe(30)
    expect(byPid['mock-2']).toMatchObject({ status: 'failed', error: 'no-answer' })
  })

  it('falls back to polling the provider when no webhook arrives', async () => {
    polled['mock-3'] = { id: 'mock-3', status: 'completed', conversation_duration: 20, transcript: 'assistant: hi', extracted_data: { Q: { in_stock: { objective: 'no', subjective: '' } } } }
    await tick(requestId)
    const s = (await getSearch(requestId, true))!
    expect(s.executions.find((e) => e.provider_execution_id === 'mock-3')).toMatchObject({ status: 'done', provider_status: 'completed' })
  })

  it('does not retry a failed call automatically', async () => {
    await tick(requestId)
    await dispatchQueued()
    expect(started.length).toBe(4) // the no-answer call was not re-dialled
    const events = await db().from('call_events').select('source').eq('source', 'poll')
    expect(events.error).toBeNull()
  })

  it("hides live transcripts and Bolna's call ids (they unlock recordings) unless the operator token is presented", async () => {
    const pub = (await getSearch(requestId))!
    expect(pub.redacted).toBe(true)
    expect(pub.executions.every((e) => e.transcript === null && e.provider_execution_id === null)).toBe(true)
    const op = (await getSearch(requestId, true))!
    expect(op.executions.find((e) => e.provider_execution_id === 'mock-1')?.transcript).toContain('assistant: hi')
  })
})

describe('LIVE safety edges (mocked Bolna)', () => {
  const queue = async (minutesAgo = 0) => {
    const r = await db().from('call_executions').insert({ request_id: requestId, shop_id: SHOPS[0], mode: 'live', status: 'queued', created_at: new Date(Date.now() - minutesAgo * 60_000).toISOString() }).select('id').single()
    return r.data!.id as string
  }
  const row = async (id: string) => (await db().from('call_executions').select('status, error, provider_execution_id').eq('id', id).single()).data!

  it('turning LIVE off fails queued calls instead of dialling them', async () => {
    const id = await queue()
    const before = started.length
    process.env.LIVE_CALLS_ENABLED = 'false'
    await dispatchQueued()
    process.env.LIVE_CALLS_ENABLED = 'true'
    expect(started.length).toBe(before)
    expect(await row(id)).toMatchObject({ status: 'failed', error: expect.stringContaining('LIVE calling is disabled') })
  })

  it('expires calls left in the queue for over 10 minutes', async () => {
    await db().from('call_executions').update({ status: 'done' }).eq('request_id', requestId).in('status', ['dispatching', 'ringing', 'talking']) // free the lines
    const id = await queue(11)
    const before = started.length
    await dispatchQueued()
    expect(started.length).toBe(before)
    expect(await row(id)).toMatchObject({ status: 'failed', error: expect.stringContaining('expired') })
  })

  it('marks a refused call failed, but keeps an unconfirmed one open for a late webhook', async () => {
    callMode = 'refuse'
    const refused = await queue()
    await dispatchQueued()
    expect(await row(refused)).toMatchObject({ status: 'failed', error: expect.stringContaining('Bolna 400') })

    callMode = 'hang'
    const unsure = await queue()
    await dispatchQueued()
    expect(await row(unsure)).toMatchObject({ status: 'timeout', provider_execution_id: null })
    callMode = 'ok'
    // The call did go through: its webhook carries our id in recipient_data and is adopted.
    await adoptExecution(unsure, 'mock-late')
    await applyEvent({ providerId: 'mock-late' }, { status: 'completed', duration: 25, extracted_data: { Q: { in_stock: { objective: 'yes', subjective: '' } } } }, 'webhook')
    expect(await row(unsure)).toMatchObject({ status: 'done', provider_execution_id: 'mock-late' })
  })
})
