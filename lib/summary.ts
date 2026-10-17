import { qtyLabel, rankResults, type Ranked } from './rank'
import { notNeeded } from './state'
import { CALL_LANGS, type Extraction, type Lang, type PublicExecution, type SearchRequest, type SearchState } from './types'

type Req = Pick<SearchRequest, 'product' | 'quantity' | 'unit' | 'area'>
export type HoldOutcome = 'confirmed' | 'declined' | 'pending' | 'failed' | 'unknown'
type Hold = { shopName: string; outcome: HoldOutcome } | null

// A reservation counts as confirmed only when the shop explicitly agreed on the hold call itself.
export function holdOutcome(h: Pick<PublicExecution, 'status' | 'extracted'>): HoldOutcome {
  if (h.status === 'done') return h.extracted?.can_hold === 'yes' ? 'confirmed' : h.extracted?.can_hold === 'no' ? 'declined' : 'unknown'
  return h.status === 'failed' || h.status === 'timeout' ? 'failed' : 'pending'
}

const money = (n: number) => String(Math.round(n * 100) / 100)

// Spoken/visible summary in the user's language. Every number comes from a verified, extracted answer.
// Availability first (has it, how soon, can they keep it), then the price. `alts`: shops with the same composition
// under another brand (medicines), mentioned neutrally, never as the answer.
export function summarize(req: Req, ranked: Ranked[], lang: Lang, hold: Hold = null, alts: string[] = []) {
  const skipped = ranked.filter((r) => r.skipped).length // not dialled: a shop already had it all and will hold it
  const called = ranked.length - skipped
  const answered = ranked.filter((r) => r.status === 'done').length
  const have = ranked.filter((r) => r.stock === 'full' || r.stock === 'short').length
  const unanswered = ranked.filter((r) => (r.status === 'failed' || r.status === 'timeout') && !r.skipped).length
  const w = ranked.find((r) => r.winner)
  const ready = (n: number | null, hi: boolean) => (n === null ? '' : n === 0 ? (hi ? ', अभी तैयार' : ', ready now') : hi ? `, लगभग ${n} मिनट में तैयार` : `, ready in about ${n} minutes`)
  const canHold = w && w.factors.hold > 0 && !hold // once a hold call exists, its outcome is reported instead
  let qty = `${req.quantity} ${req.unit}` // Hinglish keeps "2 packet"

  if (lang === 'hi') {
    const out = [`मैंने ${called} ${called === 1 ? 'दुकान' : 'दुकानों'} पर call किया। ${answered} ने जवाब दिया, और ${have} के पास ${req.product} है।`]
    if (w) out.push(`सबसे अच्छा विकल्प: ${w.shopName}, उनके पास पूरे ${qty} हैं${ready(w.ready, true)}${canHold ? ', और वे इसे आपके लिए रख सकते हैं' : ''}। ${w.total !== null ? `कुल कीमत ${money(w.total)} रुपये।` : 'कीमत नहीं बताई।'}`)
    else out.push(`किसी भी दुकान ने पूरे ${qty} की पुष्टि नहीं की।`)
    if (alts.length) out.push(`${alts.join(', ')} के पास इसी composition का दूसरा brand है; बदलने से पहले अपने doctor से पूछें।`)
    if (unanswered) out.push(`${unanswered} ${unanswered === 1 ? 'दुकान' : 'दुकानों'} से बात नहीं हो पाई।`)
    if (skipped) out.push(`सामान मिल गया था, इसलिए ${skipped} और ${skipped === 1 ? 'दुकान' : 'दुकानों'} को call नहीं किया।`)
    if (hold?.outcome === 'confirmed') out.push(`${hold.shopName} ने आपके लिए सामान रखने की पुष्टि की है।`)
    if (hold?.outcome === 'declined') out.push(`${hold.shopName} ने सामान रखने से मना किया।`)
    return out.join(' ')
  }
  qty = qtyLabel(req.quantity, req.unit)
  const out = [`I called ${called} shop${called === 1 ? '' : 's'}. ${answered} answered and ${have} ${have === 1 ? 'has' : 'have'} ${req.product}.`]
  if (w) out.push(`Best option: ${w.shopName} has all ${qty}${ready(w.ready, false)}${canHold ? ', and says it can keep it for you' : ''}. ${w.total !== null ? `Price: ${money(w.total)} rupees in total.` : 'Price not quoted.'}`)
  else out.push(`No shop confirmed all ${qty}.`)
  if (alts.length) out.push(`${alts.join(', ')} ${alts.length === 1 ? 'has' : 'have'} another brand with the same composition; ask your doctor before switching.`)
  if (unanswered) out.push(`${unanswered} shop${unanswered === 1 ? '' : 's'} could not be reached.`)
  if (skipped) out.push(`It was already found, so ${skipped} more shop${skipped === 1 ? ' was' : 's were'} not called.`)
  if (hold?.outcome === 'confirmed') out.push(`${hold.shopName} confirmed they will keep it for you.`)
  if (hold?.outcome === 'declined') out.push(`${hold.shopName} declined to hold it.`)
  return out.join(' ')
}

// The summary for a whole search, shared by the results page and the TTS route.
export function searchSummary(s: SearchState, lang: Lang = s.request.language) {
  const quotes = s.executions.filter((e) => e.kind === 'quote')
  const ranked = rankResults(s.request, quotes.map((e) => ({ id: e.id, shopName: e.shop.name, status: e.status, error: e.error, extracted: e.extracted })))
  const w = ranked.find((r) => r.winner)
  const shopId = w && quotes.find((e) => e.id === w.id)?.shop_id
  const h = shopId ? s.executions.find((e) => e.kind === 'hold' && e.shop_id === shopId) : undefined
  return summarize(s.request, ranked, lang, w && h ? { shopName: w.shopName, outcome: holdOutcome(h) } : null, alternatives(s, ranked).map((a) => a.r.shopName))
}

// Medicines: shops without the full requested brand that said they have the same composition under another brand.
// Only when the user asked for it; never ranked against the requested brand.
export const alternatives = (s: SearchState, ranked: Ranked[]) =>
  !s.request.ask_alternative ? []
  : ranked.flatMap((r) => {
      const x = s.executions.find((e) => e.id === r.id)?.extracted
      return r.status === 'done' && r.stock !== 'full' && x?.alt_available === 'yes' ? [{ r, x: x as Extraction }] : []
    })

// The languages a search's shops were called in, e.g. "हिन्दी, मराठी" (older calls: the request's language).
export const calledIn = (s: SearchState) =>
  [...new Set(s.executions.filter((e) => e.kind === 'quote').map((e) => e.language ?? s.request.language))].map((l) => CALL_LANGS[l]?.name ?? l).join(', ')

// "14:05" in India time, whatever the viewer's time zone.
export const istTime = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

// "confirmed 6 min ago": how fresh an answer is.
export function ago(iso: string, now: number) {
  const min = Math.floor((now - Date.parse(iso)) / 60_000)
  return min < 1 ? 'just now' : min < 60 ? `${min} min ago` : min < 1440 ? `${Math.floor(min / 60)} h ago` : `on ${new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })}`
}

// WhatsApp share text: only the verified quote the user chooses to share, availability first. No phone numbers.
// `confirmedAt` is when the shop said it; a replay plays an old run back, so its time would mislead.
export function shareText(req: Req & Pick<SearchRequest, 'mode'>, r: Ranked, reserved: boolean, confirmedAt: string | null) {
  const tag = req.mode === 'simulated' ? '[SIMULATED DEMO, not a real shop] ' : req.mode === 'replay' ? '[REPLAY of a recorded run] ' : ''
  const asOf = confirmedAt && req.mode !== 'replay' ? ` as of ${istTime(confirmedAt)} IST` : ''
  return `${tag}Poochho found ${req.product} at ${r.shopName}: ${r.explanation}.${reserved ? ' The shop confirmed it will hold it.' : ''} (Quoted by phone${asOf}; please confirm at the shop.)`
}

// Parallel calling vs ringing the same shops one after another: the measured wall-clock time of the whole search
// against the sum of each call's own dial-to-end time. Null until every quote call that was dialled has ended.
export function timeSaved(calls: Pick<PublicExecution, 'kind' | 'dispatched_at' | 'ended_at' | 'error'>[]) {
  const q = calls.filter((c) => c.kind === 'quote' && !notNeeded(c.error))
  if (!q.length || q.some((c) => !c.dispatched_at || !c.ended_at)) return null
  const start = q.map((c) => Date.parse(c.dispatched_at!))
  const end = q.map((c) => Date.parse(c.ended_at!))
  const parallel = Math.max(...end) - Math.min(...start)
  const sequential = q.reduce((sum, _, i) => sum + Math.max(0, end[i] - start[i]), 0)
  return { calls: q.length, parallelSec: Math.round(parallel / 1000), sequentialSec: Math.round(sequential / 1000) }
}
