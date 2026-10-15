// Integration with a MOCKED provider: real Supabase, but every request to api.bolna.ai is answered by a stub,
// so no phone call can be placed. Exercises LIVE dispatch, concurrency, webhooks, polling and no-auto-retry.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

process.env.CALL_WINDOW_IST = '00:00-23:59' // run at any hour
process.env.MAX_CONCURRENCY = '2'
process.env.BOLNA_API_KEY = 'mock-key'
process.env.BOLNA_AGENT_ID = 'mock-agent'

const realFetch = globalThis.fetch
const started: { to: string; body: Record<string, unknown> }[] = []
const polled: Record<string, unknown> = {}
vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (!url.startsWith('https://api.bolna.ai')) return realFetch(input, init)
  if (url.endsWith('/call') && init?.method === 'POST') {
    const body = JSON.parse(String(init.body))
    started.push({ to: body.recipient_phone_number, body })
    return Response.json({ message: 'done', status: 'queued', execution_id: `mock-${started.length}` })
  }
  const m = /\/executions\/([^/]+)$/.exec(url)
  if (m) return Response.json(polled[m[1]] ?? { id: m[1], status: 'ringing' })
  return Response.json({ message: 'not mocked' }, { status: 404 })
})

const { applyEvent, db, dispatchQueued, getSearch, tick } = await import('@/lib/engine')
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
    const s = (await getSearch(requestId))!
    expect(s.executions.filter((e) => e.status === 'dispatching').map((e) => e.provider_execution_id).sort()).toEqual(['mock-1', 'mock-2'])
    expect(s.executions.filter((e) => e.status === 'queued')).toHaveLength(2)
    expect(started[0].body).toMatchObject({ agent_id: 'mock-agent', user_data: { item: 'Dolo 650', quantity: '2 strip', customer_area: 'Kothrud', call_purpose: 'quote', timezone: 'Asia/Kolkata' } })
    expect(started[0].body).not.toHaveProperty('retry_config') // Bolna never retries on its own
  })

  it('applies webhooks by provider id, frees the line, and dispatches the next queued call', async () => {
    await applyEvent({ providerId: 'mock-1' }, { status: 'in-progress' }, 'webhook')
    await applyEvent({ providerId: 'mock-1' }, { status: 'completed', duration: 30, transcript: 'assistant: hi\nuser: haan', extracted_data: { Q: { in_stock: { objective: 'yes', subjective: '' }, unit_price_inr: { objective: null, subjective: '30' } } } }, 'webhook')
    await applyEvent({ providerId: 'mock-2' }, { status: 'no-answer' }, 'webhook')
    await dispatchQueued()
    expect(started.length).toBe(4)
    const s = (await getSearch(requestId))!
    const byPid = Object.fromEntries(s.executions.map((e) => [e.provider_execution_id, e]))
    expect(byPid['mock-1']).toMatchObject({ status: 'done', provider_status: 'completed' })
    expect(byPid['mock-1'].extracted?.unit_price_inr).toBe(30)
    expect(byPid['mock-2']).toMatchObject({ status: 'failed', error: 'no-answer' })
  })

  it('falls back to polling the provider when no webhook arrives', async () => {
    polled['mock-3'] = { id: 'mock-3', status: 'completed', conversation_duration: 20, transcript: 'assistant: hi', extracted_data: { Q: { in_stock: { objective: 'no', subjective: '' } } } }
    await tick(requestId)
    const s = (await getSearch(requestId))!
    expect(s.executions.find((e) => e.provider_execution_id === 'mock-3')).toMatchObject({ status: 'done', provider_status: 'completed' })
  })

  it('does not retry a failed call automatically', async () => {
    await tick(requestId)
    await dispatchQueued()
    expect(started.length).toBe(4) // the no-answer call was not re-dialled
    const events = await db().from('call_events').select('source').eq('source', 'poll')
    expect(events.error).toBeNull()
  })
})
