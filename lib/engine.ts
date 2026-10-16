import { createHmac } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import replays from '@/data/replays.json'
import { BolnaHttpError, createWebSession, getExecution, sanitize, startCall, stopCall, toEvent } from './bolna'
import { cfg, clientIp, inCallingWindow, liveBlockers } from './config'
import { quoteHeard } from './extraction'
import { LABEL_FIELDS, type MetricRow } from './metrics'
import { hasAndHolds } from './rank'
import { DEMO_SHOPS, holdScript, itemLabel, quoteScript, SIM_LINES } from './sim'
import { ACTIVE, mergeEvent, notNeeded } from './state'
import { CALL_LANGS, callLanguage, type CallStatus, type Execution, type ProviderEvent, type PublicExecution, type ScriptEvent, type SearchRequest, type SearchState } from './types'
import type { NewSearch } from './validate'

let client: SupabaseClient | null = null
export function db() {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SECRET_KEY
    if (!url || !key) throw new Error('Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY')
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  }
  return client
}

// Errors whose message is safe and useful to show the user (HTTP 400; 429 when a daily cap is used up).
export class UserError extends Error {}
export class CapReached extends UserError {}

export function errorResponse(e: unknown) {
  if (e instanceof UserError) return Response.json({ error: e.message }, { status: e instanceof CapReached ? 429 : 400 })
  console.error(e)
  return Response.json({ error: 'Something went wrong on the server. Please try again.' }, { status: 500 })
}
export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any // untyped Supabase rows; shapes are fixed by the migration
function must<T = Row>(r: { data: unknown; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message)
  return r.data as T
}

type Source = 'webhook' | 'poll' | 'simulated' | 'replay' | 'dispatch' | 'watchdog' | 'tool'
type ShopRow = { id: string; name: string; area: string; city: string; language: string; source: string; phone: string | null; consent_status: string; opted_out_at: string | null }
const SHOP_COLS = 'id, name, area, city, language, source, phone, consent_status, opted_out_at'
export const callable = (s: ShopRow | null) => Boolean(s && s.source === 'live' && s.phone && s.consent_status === 'verified' && !s.opted_out_at)

// ---------- shops ----------
const JUDGE_WAIT_MS = 15 * 60_000
// Judge mode's own shop: the judge answers its call in the browser. One shared row, never callable by phone.
export const JUDGE_SHOP = { id: 'judge-your-shop', name: 'Your shop', area: 'In your browser', language: 'hi', source: 'judge' }

export async function listShops(mode: 'simulated' | 'live') {
  if (mode === 'simulated') return DEMO_SHOPS.map((s) => ({ id: s.id, name: s.name, area: s.area, language: s.language, callable: true, note: 'Simulated shop' }))
  const rows = must<ShopRow[]>(await db().from('shops').select(SHOP_COLS).eq('source', 'live').order('name'))
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    area: s.area,
    language: s.language,
    callable: callable(s),
    note: s.opted_out_at ? 'Opted out of calls' : s.consent_status !== 'verified' ? 'Consent not verified' : `Consent verified · number ends ${s.phone?.slice(-2)}`,
  }))
}

async function assertLiveBudget(n: number) {
  if (!inCallingWindow()) throw new UserError(`Live calls are only placed between ${cfg.callWindow} IST.`)
  const since = new Date(Date.now() - 86_400_000).toISOString()
  const r = await db().from('call_executions').select('id', { count: 'exact', head: true }).eq('mode', 'live').gte('created_at', since)
  if (r.error) throw new Error(r.error.message)
  if ((r.count ?? 0) + n > cfg.maxLivePerDay) throw new UserError(`Daily live-call limit (${cfg.maxLivePerDay}) reached.`)
}

// ---------- searches ----------
export async function createSearch(input: NewSearch) {
  const { shop_ids, ...fields } = input
  const shopLang: Record<string, string> = {}
  if (input.mode === 'simulated' || input.mode === 'judge') {
    const picked = DEMO_SHOPS.filter((s) => shop_ids.includes(s.id))
    if (picked.length !== shop_ids.length) throw new UserError('Unknown demo shop.')
    if (input.mode === 'judge' && picked.length > 2) throw new UserError('Judge mode calls at most 2 simulated shops besides yours.')
    must(await db().from('shops').upsert([...picked.map((s) => ({ id: s.id, name: s.name, area: s.area, language: s.language, source: 'demo' })), ...(input.mode === 'judge' ? [JUDGE_SHOP] : [])]))
    for (const s of picked) shopLang[s.id] = s.language
  } else {
    const rows = must<ShopRow[]>(await db().from('shops').select(SHOP_COLS).in('id', shop_ids))
    const bad = shop_ids.filter((id) => !callable(rows.find((r) => r.id === id) ?? null))
    if (bad.length) throw new UserError(`Not eligible for calls (consent or opt-out): ${bad.join(', ')}`)
    await assertLiveBudget(shop_ids.length)
    for (const s of rows) shopLang[s.id] = s.language
  }
  const request = must<SearchRequest>(await db().from('search_requests').insert(fields).select('*').single())
  const now = new Date().toISOString()
  const rows: Record<string, unknown>[] = shop_ids.map((shopId, i) => {
    // Decided once, here, and stored: each shop is called in its own language when the agent speaks it.
    const language = callLanguage(shopLang[shopId], request.language)
    const base = { request_id: request.id, shop_id: shopId, kind: 'quote', mode: input.mode === 'judge' ? 'simulated' : input.mode, language }
    if (input.mode === 'live') return { ...base, status: 'queued' }
    const pid = `sim-${crypto.randomUUID()}`
    const shop = DEMO_SHOPS.find((s) => s.id === shopId)!
    const sim = { ...base, provider_execution_id: pid, script: quoteScript(shop, request, language, pid) }
    // Simulated calls get SIM_LINES lines, like a real account's concurrency limit; the rest wait (startSimulated).
    return i < SIM_LINES ? { ...sim, status: 'dispatching', dispatched_at: now } : { ...sim, status: 'queued' }
  })
  // The judge's own call waits for their click ("Answer the call"), which mints a web-call session (startWebCall).
  if (input.mode === 'judge') rows.push({ request_id: request.id, shop_id: JUDGE_SHOP.id, kind: 'quote', mode: 'judge', language: request.language, status: 'queued' })
  must(await db().from('call_executions').insert(rows))
  // The calls are saved: a dispatch hiccup must not fail the request (a retry would queue them twice).
  // The page's tick keeps dispatching.
  if (input.mode === 'live') await dispatchQueued().catch(logDispatchError)
  return request.id
}

const logDispatchError = (e: unknown) => console.error('dispatch failed (the tick will retry):', (e as Error).message)

type Replay = {
  id: string
  title: string
  source: 'live' | 'simulated'
  recorded_at: string
  request: Omit<SearchRequest, 'id' | 'mode' | 'replay_of' | 'created_at'>
  calls: { shop: { name: string; area: string; language: string }; kind: 'quote' | 'hold'; language?: string | null; events: ScriptEvent[] }[]
}
export const REPLAYS = replays as unknown as Replay[]
const replayShopId = (name: string) => `replay-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)}`

export async function createReplay(replayId: string) {
  const r = REPLAYS.find((x) => x.id === replayId)
  if (!r) throw new UserError('Unknown replay.')
  const quotes = r.calls.filter((c) => c.kind === 'quote')
  const shops = new Map(quotes.map((c) => [replayShopId(c.shop.name), { id: replayShopId(c.shop.name), name: c.shop.name, area: c.shop.area, language: c.shop.language, source: 'replay' }]))
  must(await db().from('shops').upsert([...shops.values()]))
  const request = must<SearchRequest>(await db().from('search_requests').insert({ ...r.request, mode: 'replay', replay_of: r.id }).select('*').single())
  const now = new Date().toISOString()
  must(
    await db().from('call_executions').insert(
      // A call that waited for a line (or was skipped) in the recorded run waits in the queue until its first event.
      quotes.map((c) => ({ request_id: request.id, shop_id: replayShopId(c.shop.name), kind: 'quote', mode: 'replay', language: c.language ?? callLanguage(c.shop.language, r.request.language), status: c.events[0] && (c.events[0].at > 1000 || c.events[0].payload.status === '__failed') ? 'queued' : 'dispatching', provider_execution_id: `replay-${crypto.randomUUID()}`, dispatched_at: now, script: c.events })),
    ),
  )
  return request.id
}

const PUBLIC_COLS = 'id, request_id, shop_id, kind, mode, language, status, provider_execution_id, provider_status, error, transcript, extracted, live_answer, live_answer_at, duration_seconds, cost_cents, dispatched_at, answered_at, ended_at, first_quote_at, created_at, shops(id, name, area, city, language, source)'

// Real calls with real shopkeepers: without the operator token, transcripts, the shopkeeper's quoted words,
// free-text notes, raw provider errors and Bolna's call id (it unlocks the recording) are withheld. Simulated
// and replayed calls are fictional and shown in full. A quote is only ever shown if the transcript contains it.
export async function getSearch(id: string, operator = false): Promise<SearchState | null> {
  const request = must<SearchRequest | null>(await db().from('search_requests').select('*').eq('id', id).maybeSingle())
  if (!request) return null
  const rows = must<Row[]>(await db().from('call_executions').select(PUBLIC_COLS).eq('request_id', id).order('created_at').order('id'))
  const redacted = request.mode === 'live' && !operator
  const executions = rows.map(({ shops, ...e }) => {
    const x = e.extracted && { ...e.extracted, stock_quote: quoteHeard(e.extracted.stock_quote, e.transcript) ? e.extracted.stock_quote : null }
    return {
      ...e,
      extracted: x,
      shop: shops,
      ...(redacted && { transcript: null, provider_execution_id: null, extracted: x && { ...x, notes: null, stock_quote: null }, error: e.error && (/^[a-z -]+$/.test(e.error) || notNeeded(e.error)) ? e.error : e.error && 'details hidden' }), // "not needed: already found at <shop>" names a shop on this page
    }
  }) as PublicExecution[]
  return { request, executions, redacted }
}

// Bolna's id for an answered LIVE call, for its recording. Server-side only.
export async function recordingId(executionId: string) {
  const r = must<Row | null>(await db().from('call_executions').select('mode, answered_at, provider_execution_id').eq('id', executionId).maybeSingle())
  return r?.mode === 'live' && r.answered_at && r.provider_execution_id ? (r.provider_execution_id as string) : null
}

// ---------- reservation ("Hold it") ----------
export async function createHold(executionId: string, liveAllowed: boolean) {
  const src = must<Row>(await db().from('call_executions').select('id, request_id, shop_id, kind, mode, language, status, extracted, search_requests(*)').eq('id', executionId).maybeSingle())
  if (!src) throw new UserError('Unknown call.')
  if (src.mode === 'live' && !liveAllowed) throw new UserError('A live hold call needs LIVE mode enabled and the operator token.')
  if (src.kind !== 'quote' || src.status !== 'done' || !['yes', 'partial'].includes(src.extracted?.in_stock)) throw new UserError('Only a shop that confirmed stock can be asked to hold it.')
  const req = src.search_requests as SearchRequest
  const language = src.language ?? req.language // the hold call speaks the language the quote call did
  const base = { request_id: src.request_id, shop_id: src.shop_id, kind: 'hold', mode: src.mode, language }
  let row: Record<string, unknown> = { ...base, status: 'queued' }
  if (src.mode === 'live') await assertLiveBudget(1)
  else {
    const pid = `${src.mode === 'replay' ? 'replay' : 'sim'}-${crypto.randomUUID()}`
    const shop = DEMO_SHOPS.find((s) => s.id === src.shop_id)
    const script =
      src.mode === 'simulated' ? shop && holdScript(shop, req, language, pid)
      : REPLAYS.find((r) => r.id === req.replay_of)?.calls.find((c) => c.kind === 'hold' && replayShopId(c.shop.name) === src.shop_id)?.events
    if (!script) throw new UserError('No recorded or scripted hold call exists for this shop.')
    row = { ...base, status: 'dispatching', provider_execution_id: pid, dispatched_at: new Date().toISOString(), script }
  }
  const r = await db().from('call_executions').insert(row).select('id').single()
  if (r.error?.code === '23505') throw new UserError('A hold call for this shop was already placed.')
  if (r.error) throw new Error(r.error.message)
  if (src.mode === 'live') await dispatchQueued().catch(logDispatchError)
  return r.data.id as string
}

// ---------- live dispatch ----------
// claim_live_calls (SQL) atomically moves queued live calls to "dispatching" without exceeding the
// concurrency limit, and expires calls queued for over 10 minutes, so a call is dialled at most once even
// with several dispatchers. LIVE being switched off, the calling window, consent and opt-out are all
// re-checked here, right before dialling.
export async function dispatchQueued() {
  const blocked = liveBlockers()
  if (blocked.length) return failQueued(`not placed: LIVE calling is disabled (${blocked[0]})`)
  if (!inCallingWindow()) return failQueued(`not placed: outside the calling window (${cfg.callWindow} IST)`)
  const claimed = must<Row[]>(await db().rpc('claim_live_calls', { max_active: cfg.maxConcurrency }))
  if (!claimed.length) return
  const details = must<Row[]>(await db().from('call_executions').select(`id, request_id, kind, language, shops(${SHOP_COLS}), search_requests(product, brand_or_variant, quantity, unit, area, language, stop_when_found)`).in('id', claimed.map((c) => c.id)))
  for (const q of details) await dial(q).catch((e) => console.error('dial failed for', q.id, (e as Error).message))
}

// Only rows still queued: never one a dispatcher has just claimed.
async function failQueued(reason: string) {
  const rows = must<Row[]>(await db().from('call_executions').update({ status: 'failed', error: reason, ended_at: new Date().toISOString() }).eq('mode', 'live').eq('status', 'queued').select('id'))
  await Promise.all(rows.map((r) => logEvent(r.id, 'dispatch', '__failed', { error_message: reason })))
}

async function dial(q: Row) {
  const shop = q.shops as ShopRow
  const req = q.search_requests as SearchRequest
  if (!callable(shop)) return applyEvent({ id: q.id }, { status: '__failed', error_message: 'not placed: shop is no longer eligible (consent or opt-out)' }, 'dispatch')
  const found = q.kind === 'quote' && req.stop_when_found && (await foundElsewhere(q.request_id, req.quantity, q.id))
  if (found) return applyEvent({ id: q.id }, { status: '__failed', error_message: `not needed: already found at ${found}` }, 'dispatch')
  const language = q.language && Object.hasOwn(CALL_LANGS, q.language) ? (q.language as string) : req.language
  const vars = callVars(shop.name, req, q.kind, q.id, language)
  let pid: string
  try {
    pid = await startCall(shop.phone!, vars, language) // hold calls too: the prompt's Section 4A handles {call_purpose} = hold
  } catch (e) {
    // Bolna refused (HTTP error): no call was placed. A timeout or network error is ambiguous, because the
    // call may have gone through, so it stays open (timeout) for a late webhook instead of being called failed.
    const refused = e instanceof BolnaHttpError
    return applyEvent({ id: q.id }, { status: refused ? '__failed' : '__timeout', error_message: refused ? `could not start the call: ${(e as Error).message}` : 'Bolna did not confirm the call in time; outcome unknown' }, 'dispatch')
  }
  // Bolna accepted the call: from here on it is never marked failed. Keep trying to store its id.
  for (let i = 0; i < 4; i++) {
    const r = await db().from('call_executions').update({ provider_execution_id: pid, provider_status: 'queued' }).eq('id', q.id)
    if (!r.error) break
    await new Promise((res) => setTimeout(res, 300 * (i + 1)))
  }
  await logEvent(q.id, 'dispatch', 'queued', { execution_id: pid, kind: q.kind })
}

// The shop in this search that has already said it has the full quantity and will hold it (in its post-call answer,
// or heard live), if any. Then queued calls are not needed. A call already in progress is never stopped.
async function foundElsewhere(requestId: string, quantity: number, exceptId: string): Promise<string | null> {
  const rows = must<Row[]>(await db().from('call_executions').select('id, extracted, live_answer, shops(name)').eq('request_id', requestId).eq('kind', 'quote').neq('id', exceptId))
  return rows.find((r) => hasAndHolds(r.extracted ?? r.live_answer, Number(quantity)))?.shops?.name ?? null
}

// The agent's variables for one call, phone or browser.
const callVars = (shopName: string, req: SearchRequest, kind: string, id: string, language: string) => ({
  greeting: CALL_LANGS[language].greeting, // the agent's welcome message is {greeting}: AI disclosure and recording notice
  shop_name: shopName,
  item: itemLabel(req),
  quantity: `${req.quantity} ${req.unit}`,
  customer_area: req.area,
  call_purpose: kind === 'hold' ? 'hold' : 'quote',
  poochho_execution_id: id, // echoed back in webhooks, so a call can be matched even if storing its id fails
})

// The judge's call (judge mode): claimed once (queued → dispatching), then the daily cap is spent (`allowed`, so only a
// real start counts) and a Bolna web-call session is minted for the browser. From then on it is an ordinary call:
// webhooks and polling update it through the same pipeline.
export async function startWebCall(executionId: string, allowed: () => Promise<boolean>) {
  const claimed = must<Row[]>(
    await db().from('call_executions').update({ status: 'dispatching', dispatched_at: new Date().toISOString() }).eq('id', executionId).eq('mode', 'judge').eq('status', 'queued').select('id, kind, language, shops(name), search_requests(product, brand_or_variant, quantity, unit, area, language)'),
  )
  const q = claimed[0]
  if (!q) throw new UserError('This call has already started, or it is not a judge-mode call.')
  const req = q.search_requests as SearchRequest
  const language = q.language && Object.hasOwn(CALL_LANGS, q.language) ? (q.language as string) : req.language
  try {
    if (!(await allowed())) throw new CapReached("Today's judge-mode calls are used up. Please try again tomorrow, or watch a simulated run.")
    const session = await createWebSession(callVars(q.shops.name, req, q.kind, q.id, language), language)
    must(await db().from('call_executions').update({ provider_execution_id: session.run_id, provider_status: 'queued' }).eq('id', q.id))
    await logEvent(q.id, 'dispatch', 'queued', { execution_id: session.run_id, kind: q.kind, via: 'web-call' })
    return session
  } catch (e) {
    await db().from('call_executions').update({ status: 'queued', dispatched_at: null }).eq('id', q.id) // the judge can try again
    throw e
  }
}

// Daily caps on public features that cost money, counted atomically in the database (bump_usage): overall, and
// per visitor as an HMAC of the IP (the IP itself is never stored).
export async function withinDailyCap(kind: 'judge' | 'voice', req: Request) {
  const [perIp, perDay] = kind === 'judge' ? [cfg.judgePerIp, cfg.judgePerDay] : [cfg.voicePerIp, cfg.voicePerDay]
  const visitor = createHmac('sha256', process.env.SUPABASE_SECRET_KEY ?? '').update(clientIp(req)).digest('hex').slice(0, 16)
  // The visitor's own counter first: once they hit their limit, they stop counting against everyone else's.
  for (const [key, limit] of [[`${kind}:${visitor}`, perIp], [`${kind}:all`, perDay]] as const) {
    if (must<boolean | null>(await db().rpc('bump_usage', { p_key: key, p_limit: limit })) !== true) return false
  }
  return true
}

// A webhook for a call whose provider id we failed to store: attach it via our own id (from user_data).
export async function adoptExecution(ourId: string, providerId: string) {
  if (!isUuid(ourId)) return
  const r = await db().from('call_executions').update({ provider_execution_id: providerId }).eq('id', ourId).eq('mode', 'live').is('provider_execution_id', null)
  if (r.error) throw new Error(r.error.message)
}

// ---------- applying provider events ----------
async function logEvent(executionId: string, source: Source, status: string | null, payload: unknown) {
  const r = await db().from('call_events').insert({ execution_id: executionId, source, provider_status: status, payload: source === 'webhook' || source === 'poll' ? sanitize(payload) : payload })
  if (r.error) console.error('call_events insert failed:', r.error.message)
}

// Merge one event into a call with optimistic concurrency (version check + retry). Idempotent: replays of
// the same event change nothing. Returns null when no call matches. Opt-outs are recorded by a database
// trigger in the same write (migration 20261016020000), so they can't be lost between two writes.
export async function applyEvent(where: { id: string } | { providerId: string }, ev: ProviderEvent, source: Source, payload?: unknown) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const q = db().from('call_executions').select('id, mode, shop_id, provider_execution_id, status, transcript, extracted, live_answer, duration_seconds, cost_cents, answered_at, ended_at, first_quote_at, version')
    const cur = must<Row>(await ('id' in where ? q.eq('id', where.id) : q.eq('provider_execution_id', where.providerId)).maybeSingle())
    if (!cur) return null
    const patch = mergeEvent(cur as Execution, ev, new Date().toISOString())
    if (attempt === 0 && (patch || source !== 'poll')) await logEvent(cur.id, source, ev.status, payload ?? ev)
    if (!patch) return { id: cur.id as string, changed: false }
    const done = must<Row[]>(await db().from('call_executions').update({ ...patch, version: cur.version + 1 }).eq('id', cur.id).eq('version', cur.version).select('id'))
    if (!done.length) continue // lost a race with a concurrent event: re-read and merge again
    return { id: cur.id as string, changed: true }
  }
  throw new Error('Could not apply event: too many concurrent updates')
}

// ---------- metrics and manual labels ----------
export async function metricsRows(mode: string): Promise<MetricRow[]> {
  const rows = must<Row[]>(
    await db()
      .from('call_executions')
      .select('id, request_id, mode, kind, language, status, provider_status, error, dispatched_at, answered_at, ended_at, first_quote_at, duration_seconds, cost_cents, extracted, shops(name), search_requests(language, product, quantity), result_labels(field, is_correct)')
      .eq('mode', mode)
      .order('created_at', { ascending: false })
      .limit(2000),
  )
  return rows.map(({ shops, search_requests, result_labels, ...r }) => ({ ...r, shop: shops?.name ?? '', language: r.language ?? search_requests?.language ?? '', product: search_requests?.product ?? '', quantity: Number(search_requests?.quantity ?? 0), labels: result_labels ?? [] }))
}

export async function labelQueue(mode: string) {
  return must<Row[]>(
    await db()
      .from('call_executions')
      .select('id, transcript, extracted, created_at, shops(name), search_requests(product, quantity, unit), result_labels(field, is_correct, correct_value)')
      .eq('mode', mode)
      .eq('kind', 'quote')
      .eq('status', 'done')
      .order('created_at', { ascending: false })
      .limit(50),
  )
}

export async function saveLabel(executionId: string, field: string, isCorrect: boolean, correctValue: string | null) {
  if (!LABEL_FIELDS.includes(field as (typeof LABEL_FIELDS)[number])) throw new UserError('Unknown field.')
  must(await db().from('result_labels').upsert({ execution_id: executionId, field, is_correct: isCorrect, correct_value: correctValue?.slice(0, 200) || null }, { onConflict: 'execution_id,field' }))
}

// SIMULATED calls share SIM_LINES lines. A queued call starts when a line frees, unless a shop has already said it
// has everything and will hold it (stop_when_found): the same rule dial() applies to LIVE calls.
async function startSimulated(requestId: string, rows: Row[]) {
  const queued = rows.filter((r) => r.mode === 'simulated' && r.status === 'queued')
  let free = SIM_LINES - rows.filter((r) => r.mode === 'simulated' && ACTIVE.includes(r.status)).length
  if (!queued.length || free <= 0) return
  const req = must<Row>(await db().from('search_requests').select('quantity, stop_when_found').eq('id', requestId).single())
  for (const q of queued) {
    if (free <= 0) return
    const found = req.stop_when_found && (await foundElsewhere(requestId, req.quantity, q.id))
    if (found) {
      await applyEvent({ id: q.id }, { status: '__failed', error_message: `not needed: already found at ${found}` }, 'dispatch')
      continue
    }
    const at = new Date().toISOString()
    if (must<Row[]>(await db().from('call_executions').update({ status: 'dispatching', dispatched_at: at }).eq('id', q.id).eq('status', 'queued').select('id')).length) Object.assign(q, { status: 'dispatching', dispatched_at: at })
    free--
  }
}

// ---------- the tick: advances one search (client-driven, idempotent, safe to run from several tabs) ----------
export async function tick(requestId: string) {
  const rows = must<Row[]>(
    await db().from('call_executions').select('id, mode, status, provider_status, script, script_cursor, dispatched_at, answered_at, ended_at, provider_execution_id, last_polled_at, created_at').eq('request_id', requestId).order('created_at').order('id'),
  )
  await startSimulated(requestId, rows)
  // A judge call nobody answers expires, so the search can finish.
  for (const q of rows.filter((r) => r.mode === 'judge' && r.status === 'queued' && Date.now() - Date.parse(r.created_at) > JUDGE_WAIT_MS))
    await applyEvent({ id: q.id }, { status: '__failed', error_message: 'not placed: nobody answered the judge-mode call within 15 minutes' }, 'dispatch')
  const now = Date.now()
  // Calls are independent, so each one's due steps are delivered in parallel (in order within a call). Each
  // step is claimed by moving the cursor; if delivering it fails, the cursor moves back so it is retried.
  await Promise.all(
    rows.map(async (ex) => {
      const script = ex.script as ScriptEvent[] | null
      if (!script || !ex.dispatched_at) return
      const elapsed = now - Date.parse(ex.dispatched_at)
      for (let i = ex.script_cursor; i < script.length && script[i].at <= elapsed; i++) {
        const claimed = must<Row[]>(await db().from('call_executions').update({ script_cursor: i + 1 }).eq('id', ex.id).eq('script_cursor', i).select('id'))
        if (!claimed.length) return // another tab is delivering these steps
        try {
          const ev = toEvent(script[i].payload)
          if (ev) await applyEvent({ id: ex.id }, ev, ex.mode === 'replay' ? 'replay' : 'simulated', script[i].payload)
        } catch (e) {
          await db().from('call_executions').update({ script_cursor: i }).eq('id', ex.id).eq('script_cursor', i + 1)
          throw e
        }
      }
    }),
  )
  // Calls with a real Bolna execution: phone calls and the judge's browser call.
  const real = rows.filter((r) => r.mode === 'live' || r.mode === 'judge')
  if (!real.length) return
  if (real.some((r) => r.mode === 'live')) await dispatchQueued()
  const cutoff = new Date(now - 5000).toISOString()
  for (const ex of real) {
    const age = ex.dispatched_at ? now - Date.parse(ex.dispatched_at) : 0
    const watch = ACTIVE.includes(ex.status as CallStatus)
    // A call Bolna rescheduled (outside its own calling hours) must not happen later: ask it to stop until
    // Bolna gives a definite answer either way.
    if (ex.status === 'failed' && ex.provider_status === 'rescheduled' && ex.provider_execution_id && process.env.BOLNA_API_KEY) {
      const outcome = await stopCall(ex.provider_execution_id).then(
        () => 'rescheduled-stopped',
        (e) => (e instanceof BolnaHttpError ? 'rescheduled-stop-refused' : null),
      )
      if (outcome) await db().from('call_executions').update({ provider_status: outcome }).eq('id', ex.id)
    }
    // Poll the provider as a webhook fallback (local dev has no public webhook URL). Keep polling a
    // timed-out call for 30 minutes so a late result can still land.
    const polledRecently = ex.last_polled_at && Date.parse(ex.last_polled_at) > now - 5000
    if (process.env.BOLNA_API_KEY && ex.provider_execution_id && (watch || (ex.status === 'timeout' && age < 1_800_000)) && !polledRecently) {
      const claim = must<Row[]>(await db().from('call_executions').update({ last_polled_at: new Date().toISOString() }).eq('id', ex.id).or(`last_polled_at.is.null,last_polled_at.lt."${cutoff}"`).select('id'))
      if (claim.length) {
        try {
          const payload = await getExecution(ex.provider_execution_id)
          const ev = toEvent(payload)
          if (ev) await applyEvent({ id: ex.id }, ev, 'poll', payload)
        } catch (e) {
          console.error('Bolna poll failed:', (e as Error).message)
        }
      }
    }
    // Watchdog, measured from the last milestone the provider reported (ended, answered, or dialled).
    const since = Date.parse(ex.ended_at ?? ex.answered_at ?? ex.dispatched_at ?? new Date(now).toISOString())
    if (watch && now - since > cfg.watchdogSec * 1000) await applyEvent({ id: ex.id }, { status: '__timeout' }, 'watchdog')
  }
}
