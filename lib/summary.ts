import { inr, type Ranked } from './rank'
import type { Lang, SearchRequest } from './types'

type Req = Pick<SearchRequest, 'product' | 'quantity' | 'unit' | 'area'>
type Hold = { shopName: string; outcome: 'confirmed' | 'declined' | 'pending' | 'failed' | 'unknown' } | null

const money = (n: number) => String(Math.round(n * 100) / 100)

// Spoken/visible summary in the user's language. Every number comes from a verified, extracted answer.
export function summarize(req: Req, ranked: Ranked[], lang: Lang, hold: Hold = null) {
  const called = ranked.length
  const answered = ranked.filter((r) => r.status === 'done').length
  const have = ranked.filter((r) => r.stock === 'full' || r.stock === 'short').length
  const unanswered = ranked.filter((r) => r.status === 'failed' || r.status === 'timeout').length
  const w = ranked.find((r) => r.winner)
  const ready = (n: number | null, hi: boolean) => (n === null ? '' : hi ? `, लगभग ${n} मिनट में तैयार` : `, ready in about ${n} minutes`)
  const qty = `${req.quantity} ${req.unit}`

  if (lang === 'hi') {
    const out = [`मैंने ${called} दुकानों पर call किया। ${answered} ने जवाब दिया, और ${have} के पास ${req.product} है।`]
    if (w) out.push(`सबसे अच्छा विकल्प: ${w.shopName}${w.total !== null ? `, ${qty} के लिए ${money(w.total)} रुपये` : ', कीमत नहीं बताई'}${ready(w.ready, true)}।`)
    else out.push(`किसी भी दुकान ने पूरे ${qty} की पुष्टि नहीं की।`)
    if (unanswered) out.push(`${unanswered} दुकानों से बात नहीं हो पाई।`)
    if (hold?.outcome === 'confirmed') out.push(`${hold.shopName} ने आपके लिए सामान रखने की पुष्टि की है।`)
    if (hold?.outcome === 'declined') out.push(`${hold.shopName} ने सामान रखने से मना किया।`)
    return out.join(' ')
  }
  const out = [`I called ${called} shop${called === 1 ? '' : 's'}. ${answered} answered and ${have} ${have === 1 ? 'has' : 'have'} ${req.product}.`]
  if (w) out.push(`Best option: ${w.shopName}${w.total !== null ? `, ${money(w.total)} rupees for ${qty}` : ', price not quoted'}${ready(w.ready, false)}.`)
  else out.push(`No shop confirmed all ${qty}.`)
  if (unanswered) out.push(`${unanswered} shop${unanswered === 1 ? '' : 's'} could not be reached.`)
  if (hold?.outcome === 'confirmed') out.push(`${hold.shopName} confirmed they will keep it for you.`)
  if (hold?.outcome === 'declined') out.push(`${hold.shopName} declined to hold it.`)
  return out.join(' ')
}

// WhatsApp share text: only the verified quote the user chooses to share. No phone numbers.
export function shareText(req: Req, r: Ranked, reserved: boolean) {
  const price = r.total !== null ? `${inr(r.total)} for ${req.quantity} ${req.unit}` : 'price not quoted'
  return `Poochho found ${req.product} at ${r.shopName}: ${price}. ${r.explanation}.${reserved ? ' The shop confirmed it will hold it.' : ''} (Quoted by phone; please confirm at the shop.)`
}
