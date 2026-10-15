import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import replays from '@/data/replays.json'
import { getExecution, sanitize, startCall, stopCall, toEvent } from './bolna'
import { cfg, inCallingWindow } from './config'
import { LABEL_FIELDS, type MetricRow } from './metrics'
import { DEMO_SHOPS, holdScript, quoteScript } from './sim'
import { ACTIVE, mergeEvent } from './state'
import type { CallStatus, Execution, ProviderEvent, PublicExecution, ScriptEvent, SearchRequest, SearchState } from './types'
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

// Errors whose message is safe and useful to show the user (HTTP 400).
export class UserError extends Error {}

export function errorResponse(e: unknown) {
  if (e instanceof UserError) return Response.json({ error: e.message }, { status: 400 })
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

type Source = 'webhook' | 'poll' | 'simulated' | 'replay' | 'dispatch' | 'watchdog'
type ShopRow = { id: string; name: string; area: string; city: string; language: string; source: string; phone: string | null; consent_status: string; opted_out_at: string | null }
const SHOP_COLS = 'id, name, area, city, language, source, phone, consent_status, opted_out_at'
export const callable = (s: ShopRow | null) => Boolean(s && s.source === 'live' && s.phone && s.consent_status === 'verified' && !s.opted_out_at)

// ---------- shops ----------
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
  if (input.mode === 'simulated') {
    const picked = DEMO_SHOPS.filter((s) => shop_ids.includes(s.id))
    if (picked.length !== shop_ids.length) throw new UserError('Unknown demo shop.')
    must(await db().from('shops').upsert(picked.map((s) => ({ id: s.id, name: s.name, area: s.area, language: s.language, source: 'demo' }))))
  } else {
    const rows = must<ShopRow[]>(await db().from('shops').select(SHOP_COLS).in('id', shop_ids))
    const bad = shop_ids.filter((id) => !callable(rows.find((r) => r.id === id) ?? null))
    if (bad.length) throw new UserError(`Not eligible for calls (consent or opt-out): ${bad.join(', ')}`)
    await assertLiveBudget(shop_ids.length)
  }
  const request = must<SearchRequest>(await db().from('search_requests').insert(fields).select('*').single())
  const now = new Date().toISOString()
  const rows = shop_ids.map((shopId) => {
    const base = { request_id: request.id, shop_id: shopId, kind: 'quote', mode: input.mode }
    if (input.mode === 'live') return { ...base, status: 'queued' }
    const pid = `sim-${crypto.randomUUID()}`
    const shop = DEMO_SHOPS.find((s) => s.id === shopId)!
    return { ...base, status: 'dispatching', provider_execution_id: pid, dispatched_at: now, script: quoteScript(shop, request, pid) }
  })
  must(await db().from('call_executions').insert(rows))
  if (input.mode === 'live') await dispatchQueued()
  return request.id
}

type Replay = {
  id: string
  title: string
  source: 'live' | 'simulated'
  recorded_at: string
  request: Omit<SearchRequest, 'id' | 'mode' | 'replay_of' | 'created_at'>
  calls: { shop: { name: string; area: string; language: string }; kind: 'quote' | 'hold'; events: ScriptEvent[] }[]
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
      quotes.map((c) => ({ request_id: request.id, shop_id: replayShopId(c.shop.name), kind: 'quote', mode: 'replay', status: 'dispatching', provider_execution_id: `replay-${crypto.randomUUID()}`, dispatched_at: now, script: c.events })),
    ),
  )
  return request.id
}

const PUBLIC_COLS = 'id, request_id, shop_id, kind, mode, status, provider_execution_id, provider_status, error, transcript, extracted, duration_seconds, dispatched_at, answered_at, ended_at, first_quote_at, created_at, shops(id, name, area, city, language, source)'

export async function getSearch(id: string): Promise<SearchState | null> {
  const request = must<SearchRequest | null>(await db().from('search_requests').select('*').eq('id', id).maybeSingle())
  if (!request) return null
  const rows = must<Row[]>(await db().from('call_executions').select(PUBLIC_COLS).eq('request_id', id).order('created_at').order('id'))
  const executions = rows.map(({ shops, ...e }) => ({ ...e, shop: shops })) as PublicExecution[]
  return { request, executions }
}

// ---------- reservation ("Hold it") ----------
export async function createHold(executionId: string, liveAllowed: boolean) {
  const src = must<Row>(await db().from('call_executions').select('id, request_id, shop_id, kind, mode, status, extracted, search_requests(*)').eq('id', executionId).maybeSingle())
  if (!src) throw new UserError('Unknown call.')
  if (src.mode === 'live' && !liveAllowed) throw new UserError('A live hold call needs LIVE mode enabled and the operator token.')
  if (src.kind !== 'quote' || src.status !== 'done' || !['yes', 'partial'].includes(src.extracted?.in_stock)) throw new UserError('Only a shop that confirmed stock can be asked to hold it.')
  const req = src.search_requests as SearchRequest
  const base = { request_id: src.request_id, shop_id: src.shop_id, kind: 'hold', mode: src.mode }
  let row: Record<string, unknown> = { ...base, status: 'queued' }
  if (src.mode === 'live') await assertLiveBudget(1)
  else {
    const pid = `${src.mode === 'replay' ? 'replay' : 'sim'}-${crypto.randomUUID()}`
    const shop = DEMO_SHOPS.find((s) => s.id === src.shop_id)
    const script =
      src.mode === 'simulated' ? shop && holdScript(shop, req, pid)
      : REPLAYS.find((r) => r.id === req.replay_of)?.calls.find((c) => c.kind === 'hold' && replayShopId(c.shop.name) === src.shop_id)?.events
    if (!script) throw new UserError('No recorded or scripted hold call exists for this shop.')
    row = { ...base, status: 'dispatching', provider_execution_id: pid, dispatched_at: new Date().toISOString(), script }
  }
  const r = await db().from('call_executions').insert(row).select('id').single()
  if (r.error?.code === '23505') throw new UserError('A hold call for this shop was already placed.')
  if (r.error) throw new Error(r.error.message)
  if (src.mode === 'live') await dispatchQueued()
  return r.data.id as string
}

// ---------- live dispatch ----------
// claim_live_calls (SQL) atomically moves queued live calls to "dispatching" without exceeding the
// concurrency limit, so a call is dialled at most once even with several dispatchers. Consent and opt-out
// are re-checked at dial time.
export async function dispatchQueued() {
  if (!inCallingWindow()) {
    const queued = must<Row[]>(await db().from('call_executions').select('id').eq('mode', 'live').eq('status', 'queued'))
    for (const q of queued) await applyEvent({ id: q.id }, { status: '__failed', error_message: `not placed: outside the calling window (${cfg.callWindow} IST)` }, 'dispatch')
    return
  }
  const claimed = must<Row[]>(await db().rpc('claim_live_calls', { max_active: cfg.maxConcurrency }))
  if (!claimed.length) return
  const details = must<Row[]>(await db().from('call_executions').select(`id, kind, shops(${SHOP_COLS}), search_requests(product, brand_or_variant, quantity, unit, area, language)`).in('id', claimed.map((c) => c.id)))
  for (const q of details) {
    const shop = q.shops as ShopRow
    const req = q.search_requests as SearchRequest
    if (!callable(shop)) {
      await applyEvent({ id: q.id }, { status: '__failed', error_message: 'not placed: shop is no longer eligible (consent or opt-out)' }, 'dispatch')
      continue
    }
    try {
      const vars = {
        shop_name: shop.name,
        item: req.brand_or_variant ? `${req.product} (${req.brand_or_variant})` : req.product,
        quantity: `${req.quantity} ${req.unit}`,
        customer_area: req.area,
        call_purpose: q.kind === 'hold' ? 'hold' : 'quote',
      }
      const pid = await startCall(shop.phone!, vars, req.language, q.kind === 'hold' && process.env.BOLNA_HOLD_AGENT_ID ? process.env.BOLNA_HOLD_AGENT_ID : undefined)
      must(await db().from('call_executions').update({ provider_execution_id: pid, provider_status: 'queued' }).eq('id', q.id))
      await logEvent(q.id, 'dispatch', 'queued', { execution_id: pid, kind: q.kind })
    } catch (e) {
      await applyEvent({ id: q.id }, { status: '__failed', error_message: `could not start the call: ${(e as Error).message}` }, 'dispatch')
    }
  }
}

// ---------- applying provider events ----------
async function logEvent(executionId: string, source: Source, status: string | null, payload: unknown) {
  const r = await db().from('call_events').insert({ execution_id: executionId, source, provider_status: status, payload: source === 'webhook' || source === 'poll' ? sanitize(payload) : payload })
  if (r.error) console.error('call_events insert failed:', r.error.message)
}

async function recordOptOut(shopId: string, executionId: string) {
  const r = await db().from('shops').update({ opted_out_at: new Date().toISOString(), opt_out_note: `Asked not to be called again (call ${executionId})` }).eq('id', shopId).is('opted_out_at', null)
  if (r.error) throw new Error(r.error.message)
}

// Merge one event into a call with optimistic concurrency (version check + retry). Idempotent: replays of
// the same event change nothing. Returns null when no call matches.
export async function applyEvent(where: { id: string } | { providerId: string }, ev: ProviderEvent, source: Source, payload?: unknown) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const q = db().from('call_executions').select('id, mode, shop_id, provider_execution_id, status, transcript, extracted, duration_seconds, answered_at, ended_at, first_quote_at, version')
    const cur = must<Row>(await ('id' in where ? q.eq('id', where.id) : q.eq('provider_execution_id', where.providerId)).maybeSingle())
    if (!cur) return null
    const patch = mergeEvent(cur as Execution, ev, new Date().toISOString())
    if (attempt === 0 && (patch || source !== 'poll')) await logEvent(cur.id, source, ev.status, payload ?? ev)
    if (!patch) return { id: cur.id as string, changed: false }
    const done = must<Row[]>(await db().from('call_executions').update({ ...patch, version: cur.version + 1 }).eq('id', cur.id).eq('version', cur.version).select('id'))
    if (!done.length) continue // lost a race with a concurrent event: re-read and merge again
    if (patch.extracted?.opt_out === 'yes') await recordOptOut(cur.shop_id, cur.id)
    if (cur.mode === 'live' && ev.status === 'rescheduled' && cur.provider_execution_id) await stopCall(cur.provider_execution_id).catch(() => null)
    return { id: cur.id as string, changed: true }
  }
  throw new Error('Could not apply event: too many concurrent updates')
}

// ---------- metrics and manual labels ----------
export async function metricsRows(mode: string): Promise<MetricRow[]> {
  const rows = must<Row[]>(
    await db()
      .from('call_executions')
      .select('id, request_id, mode, status, provider_status, error, dispatched_at, answered_at, ended_at, first_quote_at, duration_seconds, extracted, shops(name), search_requests(language, product), result_labels(field, is_correct)')
      .eq('mode', mode)
      .eq('kind', 'quote')
      .order('created_at', { ascending: false })
      .limit(2000),
  )
  return rows.map(({ shops, search_requests, result_labels, ...r }) => ({ ...r, shop: shops?.name ?? '', language: search_requests?.language ?? '', product: search_requests?.product ?? '', labels: result_labels ?? [] }))
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

// ---------- the tick: advances one search (client-driven, idempotent, safe to run from several tabs) ----------
export async function tick(requestId: string) {
  const rows = must<Row[]>(await db().from('call_executions').select('id, mode, status, script, script_cursor, dispatched_at, provider_execution_id, last_polled_at').eq('request_id', requestId))
  const now = Date.now()
  // Calls are independent, so each one's due steps are delivered in parallel (in order within a call).
  await Promise.all(
    rows.map(async (ex) => {
      const script = ex.script as ScriptEvent[] | null
      if (!script || !ex.dispatched_at || ex.script_cursor >= script.length) return
      const elapsed = now - Date.parse(ex.dispatched_at)
      let n = ex.script_cursor
      while (n < script.length && script[n].at <= elapsed) n++
      if (n === ex.script_cursor) return
      const claimed = must<Row[]>(await db().from('call_executions').update({ script_cursor: n }).eq('id', ex.id).eq('script_cursor', ex.script_cursor).select('id'))
      if (!claimed.length) return // another tab delivered these steps
      for (const step of script.slice(ex.script_cursor, n)) {
        const ev = toEvent(step.payload)
        if (ev) await applyEvent({ id: ex.id }, ev, ex.mode === 'replay' ? 'replay' : 'simulated', step.payload)
      }
    }),
  )
  const live = rows.filter((r) => r.mode === 'live')
  if (!live.length) return
  await dispatchQueued()
  const cutoff = new Date(now - 5000).toISOString()
  for (const ex of live) {
    const age = ex.dispatched_at ? now - Date.parse(ex.dispatched_at) : 0
    const watch = ACTIVE.includes(ex.status as CallStatus)
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
    if (watch && age > cfg.watchdogSec * 1000) await applyEvent({ id: ex.id }, { status: '__timeout' }, 'watchdog')
  }
}
