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
const sessions: Record<string, unknown>[] = [] // web-call sessions minted (judge mode)
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
  if (url.endsWith('/web-call/session') && init?.method === 'POST') {
    sessions.push(JSON.parse(String(init.body)))
    return Response.json({ run_id: `web-${sessions.length}`, agent_id: 'mock-agent', sip_username: 'u', sip_password: 'p', sip_domain: 'd', wss_url: 'wss://x', sip_register: false, expires_in: 120, ice_servers: [] })
  }
  const m = /\/executions\/([^/]+)$/.exec(url)
  if (m) return Response.json(polled[m[1]] ?? { id: m[1], status: 'ringing' })
  return Response.json({ message: 'not mocked' }, { status: 404 })
})

const { adoptExecution, applyEvent, CapReached, createSearch, db, dispatchQueued, getSearch, startWebCall, tick, UserError } = await import('@/lib/engine')
const { rankResults } = await import('@/lib/rank')
const { CALL_LANGS } = await import('@/lib/types')
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

describe('call language (mocked Bolna)', () => {
  const LANG_SHOPS = [
    { id: 'zz-mock-marathi', language: 'mr' },
    { id: 'zz-mock-tamil', language: 'ta' }, // the agent has no Tamil yet: Bolna would refuse a call in it
  ]
  let searchId = ''
  afterAll(async () => {
    if (searchId) await db().from('search_requests').delete().eq('id', searchId)
    await db().from('shops').delete().in('id', LANG_SHOPS.map((s) => s.id))
  })

  it("calls each shop in its own language when the agent speaks it, else in the request's, with that language's greeting", async () => {
    await db().from('call_executions').update({ status: 'done' }).eq('request_id', requestId).in('status', ['dispatching', 'ringing', 'talking']) // free the lines
    const now = new Date().toISOString()
    await db().from('shops').upsert(LANG_SHOPS.map((s, i) => ({ ...s, name: `Mock ${s.language} shop`, area: 'Test', source: 'live', phone: `+91000000002${i}`, consent_status: 'verified', consent_verified_at: now, opted_out_at: null })))
    const before = started.length
    searchId = await createSearch({ mode: 'live', product: 'Dolo 650', brand_or_variant: null, category: 'pharmacy', quantity: 1, unit: 'strip', city: 'Pune', area: 'Kothrud', language: 'hi', max_budget_inr: null, need_within_minutes: null, constraints: null, asked_in: 'ta-IN', stop_when_found: true, shop_ids: LANG_SHOPS.map((s) => s.id) })
    const calls = started.slice(before).map((c) => ({ to: c.to, lang: (c.body.agent_data as { language: string }).language, greeting: (c.body.user_data as Record<string, string>).greeting }))
    expect(calls).toHaveLength(2)
    expect(calls.find((c) => c.to.endsWith('20'))).toEqual({ to: '+910000000020', lang: 'mr', greeting: CALL_LANGS.mr.greeting })
    expect(calls.find((c) => c.to.endsWith('21'))).toEqual({ to: '+910000000021', lang: 'hi', greeting: CALL_LANGS.hi.greeting })
    const s = (await getSearch(searchId, true))!
    expect(s.request.asked_in).toBe('ta-IN')
    expect(s.executions.map((e) => [e.shop_id, e.language]).sort()).toEqual([['zz-mock-marathi', 'mr'], ['zz-mock-tamil', 'hi']])
  })
})

describe('stop calling once found (mocked Bolna)', () => {
  const FOUND = ['zz-mock-found-1', 'zz-mock-found-2', 'zz-mock-found-3']
  let searchId = ''
  afterAll(async () => {
    if (searchId) await db().from('search_requests').delete().eq('id', searchId)
    await db().from('shops').delete().in('id', FOUND)
  })

  it('skips a queued call once a shop says, live, it has it all and will hold it, and never stops a call in progress', async () => {
    await db().from('call_executions').update({ status: 'done' }).like('shop_id', 'zz-mock%').in('status', ['dispatching', 'ringing', 'talking']) // free the lines (test shops only)
    const now = new Date().toISOString()
    await db().from('shops').upsert(FOUND.map((id, i) => ({ id, name: `Found Shop ${i + 1}`, area: 'Test', source: 'live', phone: `+91000000003${i}`, consent_status: 'verified', consent_verified_at: now, opted_out_at: null })))
    searchId = await createSearch({ mode: 'live', product: 'Dolo 650', brand_or_variant: null, category: 'pharmacy', quantity: 2, unit: 'strip', city: 'Pune', area: 'Kothrud', language: 'hi', max_budget_inr: null, need_within_minutes: null, constraints: null, asked_in: null, stop_when_found: true, shop_ids: FOUND })
    let s = (await getSearch(searchId, true))!
    const [first, second] = s.executions.filter((e) => e.status === 'dispatching')
    expect(s.executions.filter((e) => e.status === 'queued')).toHaveLength(1) // two lines on this account
    // The first shop says mid-call (the agent's tool) that it has both strips and will hold them.
    expect(await applyEvent({ providerId: first.provider_execution_id! }, { status: '__live', live: { in_stock: 'yes', can_hold: 'yes' } }, 'tool')).toEqual({ id: first.id, changed: true })
    await applyEvent({ providerId: second.provider_execution_id! }, { status: 'no-answer' }, 'webhook') // a line frees
    const before = started.length
    await dispatchQueued()
    expect(started.length).toBe(before) // nothing dialled
    s = (await getSearch(searchId, true))!
    expect(s.executions.find((e) => e.status === 'failed' && e.id !== second.id)).toMatchObject({ error: `not needed: already found at ${first.shop.name}` })
    expect(s.executions.find((e) => e.id === first.id)).toMatchObject({ status: 'talking', live_answer: { in_stock: 'yes', can_hold: 'yes' } })
    // Without the operator token the reason stays readable, so the call still shows as "not called", not as failed.
    expect((await getSearch(searchId))!.executions.filter((e) => e.error?.startsWith('not needed: '))).toHaveLength(1)
    const logged = await db().from('call_events').select('source, payload').eq('execution_id', first.id).eq('source', 'tool')
    expect(logged.data).toEqual([{ source: 'tool', payload: { status: '__live', live: { in_stock: 'yes', can_hold: 'yes' } } }])
  })
})

describe('judge mode (mocked Bolna web calls)', () => {
  let searchId = ''
  afterAll(async () => {
    if (searchId) await db().from('search_requests').delete().eq('id', searchId)
  })

  it("runs the judge's browser call through the same pipeline as a phone call, started once, only on request", async () => {
    searchId = await createSearch({ mode: 'judge', product: 'Amul Butter', brand_or_variant: '500g', category: 'grocery', quantity: 2, unit: 'packet', city: 'Pune', area: 'Kothrud', language: 'en', max_budget_inr: null, need_within_minutes: null, constraints: null, asked_in: null, stop_when_found: true, shop_ids: ['demo-gupta-general', 'demo-patil-provision'] })
    let s = (await getSearch(searchId))!
    expect(s.request.mode).toBe('judge')
    expect(s.redacted).toBe(false) // like a simulated run: visible through the search's unguessable URL
    const judge = s.executions.find((e) => e.mode === 'judge')!
    expect(judge).toMatchObject({ status: 'queued', language: 'en', shop: { name: 'Your shop', source: 'judge' } })
    expect(s.executions.filter((e) => e.mode === 'simulated').map((e) => e.status)).toEqual(['dispatching', 'dispatching'])
    expect(sessions).toHaveLength(0) // nothing is minted until the judge clicks

    await expect(startWebCall(judge.id, async () => false)).rejects.toBeInstanceOf(CapReached) // caps used up: nothing minted
    expect(sessions).toHaveLength(0)
    expect((await getSearch(searchId))!.executions.find((e) => e.id === judge.id)!.status).toBe('queued') // the claim is given back
    const session = await startWebCall(judge.id, async () => true)
    expect(session.run_id).toBe('web-1')
    expect(sessions[0]).toMatchObject({ agent_id: 'mock-agent', agent_data: { language: 'en' }, user_data: { shop_name: 'Your shop', item: 'Amul Butter, 500g', quantity: '2 packet', call_purpose: 'quote', poochho_execution_id: judge.id } })
    expect((sessions[0].user_data as Record<string, string>).greeting).toMatch(/AI assistant.*recorded/)
    await expect(startWebCall(judge.id, async () => true)).rejects.toBeInstanceOf(UserError) // one session per call
    expect(sessions).toHaveLength(1)

    // Bolna reports the browser call like any other: by its run_id.
    await applyEvent({ providerId: 'web-1' }, { status: 'completed', duration: 40, transcript: 'assistant: hi\nuser: yes we have it', extracted_data: { Q: { in_stock: { objective: 'yes', confidence_label: 'High' }, total_price_inr: { subjective: '190', confidence_label: 'High' }, ready_in_minutes: { subjective: '0' }, can_hold: { objective: 'yes' } } } }, 'webhook')
    s = (await getSearch(searchId))!
    const done = s.executions.find((e) => e.id === judge.id)!
    expect(done).toMatchObject({ status: 'done', provider_execution_id: 'web-1', extracted: { in_stock: 'yes', total_price_inr: 190, can_hold: 'yes' } })
    const ranked = rankResults(s.request, s.executions.map((e) => ({ id: e.id, shopName: e.shop.name, status: e.status, error: e.error, extracted: e.extracted })))
    expect(ranked.find((r) => r.winner)?.shopName).toBe('Your shop') // has it, ready now, will hold it
  })

  it('counts daily caps atomically and stops at the limit', async () => {
    const key = `zz-test:${crypto.randomUUID()}`
    const bump = async () => (await db().rpc('bump_usage', { p_key: key, p_limit: 2 })).data
    expect([await bump(), await bump(), await bump()]).toEqual([true, true, null])
    await db().from('usage_counters').delete().eq('key', key)
  })
})

