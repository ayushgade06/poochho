// Saves a finished run as a sanitised REPLAY in data/replays.json.
// Run: npm run replay:export -- <search_request_id> ["Title"]
// Keeps statuses, timing, transcripts and extractions; drops phone numbers, provider ids and recording links,
// and masks long digit runs in transcripts.
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
const calls = must(await db.from('call_executions').select('id, kind, status, dispatched_at, shops(name, area, language)').eq('request_id', id).order('created_at'))
const mask = (t) => (typeof t === 'string' ? t.replace(/\+?\d[\d\s-]{6,}\d/g, '[number removed]') : t)

const out = []
for (const c of calls) {
  if (!c.dispatched_at) continue
  const events = must(await db.from('call_events').select('provider_status, payload, received_at').eq('execution_id', c.id).order('received_at'))
  const t0 = Date.parse(c.dispatched_at)
  out.push({
    shop: c.shops,
    kind: c.kind,
    events: events
      .filter((e) => e.payload && typeof e.payload === 'object' && e.payload.status)
      .map((e) => ({
        at: Math.max(0, Date.parse(e.received_at) - t0),
        payload: {
          id: 'replay',
          status: e.payload.status,
          ...(e.payload.transcript && { transcript: mask(e.payload.transcript) }),
          ...(e.payload.extracted_data && { extracted_data: e.payload.extracted_data }),
          ...(e.payload.conversation_duration != null && { conversation_duration: e.payload.conversation_duration }),
          ...(e.payload.error_message && { error_message: e.payload.error_message }),
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
const keep = ['product', 'brand_or_variant', 'category', 'quantity', 'unit', 'city', 'area', 'language', 'max_budget_inr', 'need_within_minutes', 'constraints']
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
