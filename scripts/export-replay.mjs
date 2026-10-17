// Saves a finished run as a sanitised REPLAY in data/replays.json.
// Run: npm run replay:export -- <search_request_id> ["Title"]
// Keeps statuses, timing, transcripts, extractions and each call's cost; drops phone numbers, provider ids and
// recording links, and masks long digit runs in transcripts.
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const [id, title] = process.argv.slice(2)
if (!/^[0-9a-f-]{36}$/i.test(id ?? '')) {
  console.error('Usage: npm run replay:export -- <search_request_id> ["Title"]')
  process.exit(1)
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
const must = ({ data, error }) => {
  if (error) throw new Error(error.message)
  return data
}
const req = must(await db.from('search_requests').select('*').eq('id', id).single())
if (req.mode === 'replay') throw new Error('That search is itself a replay.')
const calls = must(await db.from('call_executions').select('id, kind, language, status, dispatched_at, created_at, shops(name, area, language)').eq('request_id', id).order('created_at'))
// Masks long digit runs (phone numbers) in every string, at any depth. For real calls, free-text notes are
// dropped entirely: they can hold anything the shopkeeper said.
const mask = (v) =>
  typeof v === 'string' ? v.replace(/\+?\d[\d\s-]{6,}\d/g, '[number removed]')
  : Array.isArray(v) ? v.map(mask)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !(req.mode === 'live' && /^notes$/i.test(k))).map(([k, x]) => [k, mask(x)]))
  : v

// Quote calls share one clock from the start of the search, so a call that waited for a free line (or was
// skipped) keeps its delay; each hold call is timed from its own click.
const searchStart = Math.min(...calls.filter((c) => c.kind === 'quote').map((c) => Date.parse(c.created_at)))
const out = []
for (const c of calls) {
  const events = must(await db.from('call_events').select('provider_status, payload, received_at').eq('execution_id', c.id).order('received_at'))
  if (!events.length) continue
  const t0 = c.kind === 'quote' ? searchStart : Date.parse(c.dispatched_at ?? c.created_at)
  out.push({
    shop: c.shops,
    kind: c.kind,
    language: c.language, // the language the call was placed in
    events: events
      .filter((e) => e.payload && typeof e.payload === 'object' && e.payload.status)
      .map((e) => ({
        at: Math.max(0, Date.parse(e.received_at) - t0),
        payload: {
          id: 'replay',
          status: e.payload.status,
          ...(e.payload.transcript && { transcript: mask(e.payload.transcript) }),
          ...(e.payload.extracted_data && { extracted_data: mask(e.payload.extracted_data) }),
          ...(e.payload.conversation_duration != null && { conversation_duration: e.payload.conversation_duration }),
          ...(e.payload.total_cost != null && { total_cost: e.payload.total_cost }), // US cents, so a replay of a real run shows its cost
          ...(e.payload.tool_call && { tool_call: e.payload.tool_call }), // an answer heard mid-call
          ...(e.payload.error_message && { error_message: mask(e.payload.error_message) }),
          ...(e.payload.answered_by_voice_mail && { answered_by_voice_mail: true }),
        },
      })),
  })
}
// Start the playback at the first recorded event (drops app start-up latency, keeps relative timing).
// Quote calls share one clock; each hold call is timed from its own click.
const first = (cs) => Math.min(...cs.flatMap((c) => c.events.map((e) => e.at)))
const quoteStart = first(out.filter((c) => c.kind === 'quote'))
for (const c of out) {
  const start = c.kind === 'quote' ? quoteStart : first([c])
  for (const e of c.events) e.at -= start
}
const keep = ['product', 'brand_or_variant', 'category', 'quantity', 'unit', 'city', 'area', 'language', 'max_budget_inr', 'need_within_minutes', 'constraints', 'composition', 'ask_alternative']
const replay = {
  id: `run-${id.slice(0, 8)}`,
  title: title ?? `${req.quantity} ${req.unit} ${req.product} near ${req.area} (${req.mode === 'live' ? 'real calls' : 'simulated'})`,
  source: req.mode,
  recorded_at: req.created_at,
  request: Object.fromEntries(keep.map((k) => [k, req[k]])),
  calls: out,
}
const file = new URL('../data/replays.json', import.meta.url)
const all = JSON.parse(readFileSync(file, 'utf8')).filter((r) => r.id !== replay.id)
writeFileSync(file, JSON.stringify([...all, replay], null, 2) + '\n')
console.log(`Saved replay "${replay.title}" (${replay.calls.length} calls, source: ${replay.source}) to data/replays.json`)
