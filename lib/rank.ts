import type { CallStatus, Extraction, SearchRequest } from './types'

// Score (0–100) = (stock + readiness + hold + price points) × confidence multiplier. See README "Ranking".
// Availability leads: packaged goods and medicines carry a printed MRP, so prices barely differ between shops.
export const WEIGHTS = { stock: 50, ready: 20, hold: 15, price: 15 }
export const CONFIDENCE = { high: 1, med: 0.85, low: 0.6 }
const READY_HORIZON_MIN = 120 // readiness points fall linearly to 0 at two hours

type Input = { id: string; shopName: string; status: CallStatus; error: string | null; extracted: Extraction | null }
type Req = Pick<SearchRequest, 'quantity' | 'unit' | 'max_budget_inr' | 'need_within_minutes'>

export type Ranked = {
  id: string
  shopName: string
  status: CallStatus
  ready: number | null
  stock: 'full' | 'short' | 'none' | 'unknown'
  unit: number | null
  total: number | null
  comparable: boolean
  factors: { stock: number; price: number; ready: number; hold: number; confidence: number }
  score: number
  eligible: boolean
  flags: string[]
  explanation: string
  winner: boolean
}

const UNIT_ALIASES: Record<string, string> = {
  pc: 'piece', pcs: 'piece', piece: 'piece', nos: 'piece', no: 'piece', unit: 'piece', item: 'piece',
  pkt: 'packet', pack: 'packet', packet: 'packet',
  kilo: 'kg', kilogram: 'kg', kg: 'kg', gram: 'g', gm: 'g', g: 'g',
  l: 'litre', ltr: 'litre', litre: 'litre', liter: 'litre', ml: 'ml',
  strip: 'strip', bottle: 'bottle', box: 'box', dozen: 'dozen', m: 'metre', meter: 'metre', metre: 'metre',
}
export function normUnit(u: string) {
  const s = u.trim().toLowerCase().replace(/^(per|each|1|a|one)\s+/, '').replace(/s$/, '')
  return UNIT_ALIASES[s] ?? s
}

export const inr = (n: number) => '₹' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n)
const PLURAL: Record<string, string> = { piece: 'pieces', packet: 'packets', strip: 'strips', bottle: 'bottles', box: 'boxes', litre: 'litres', metre: 'metres' }
// "2 packets", "1 packet", "0.5 kg" (English display only; the Hinglish agent variable keeps "2 packet").
export const qtyLabel = (q: number, unit: string) => `${q} ${q === 1 ? unit : (PLURAL[unit] ?? unit)}`

const positive = (n: number | null | undefined) => (n != null && n > 0 ? n : null)

// Whether a shop's answer covers the requested quantity.
export function stockOf(x: Extraction | null, quantity: number): Ranked['stock'] {
  if (!x) return 'unknown'
  if (x.in_stock === 'no') return 'none'
  if (x.in_stock === 'partial' || (x.in_stock === 'yes' && x.qty_available !== null && x.qty_available < quantity)) return 'short'
  return x.in_stock === 'yes' ? 'full' : 'unknown'
}

export function rankResults(req: Req, rows: Input[]): Ranked[] {
  const q = req.quantity
  const base = rows.map((r) => {
    const x = r.status === 'done' ? r.extracted : null
    const stock = stockOf(x, q)
    // unitMatch: true = price stated for the requested unit; false = for a different unit; null = unit not stated.
    const unitMatch = x?.price_unit ? normUnit(x.price_unit) === normUnit(req.unit) : null
    const comparable = unitMatch !== false
    // A per-unit price is only multiplied out when the shop said which unit it was for (500 g × "₹120" is not
    // ₹60,000). A quoted total for the full quantity is used as given and sets the unit price: it is what the
    // customer pays, and Bolna's extraction model has been seen back-calculating a unit price the shop never said.
    const quotedTotal = comparable && stock === 'full' ? positive(x?.total_price_inr) : null
    const unit = quotedTotal !== null ? quotedTotal / q : unitMatch === true ? positive(x?.unit_price_inr) : null
    const total = stock === 'full' ? (quotedTotal ?? (unit !== null ? Math.round(unit * q * 100) / 100 : null)) : null
    return { r, x, stock, comparable, unitMatch, unit, total }
  })

  const units = base.map((b) => b.unit).filter((u): u is number => u !== null)
  const minUnit = units.length ? Math.min(...units) : null

  const ranked: Ranked[] = base.map(({ r, x, stock, comparable, unitMatch, unit, total }) => {
    const flags: string[] = []
    const factors = { stock: 0, price: 0, ready: 0, hold: 0, confidence: 0 }
    if (!x) {
      flags.push(r.status === 'done' ? 'No usable answer extracted' : r.status === 'failed' || r.status === 'timeout' ? `Call ${r.status === 'timeout' ? 'timed out' : 'failed'}${r.error ? `: ${r.error}` : ''}` : 'Call in progress')
      return { id: r.id, shopName: r.shopName, status: r.status, ready: null, stock, unit, total, comparable, factors, score: 0, eligible: false, flags, explanation: flags[0], winner: false }
    }
    const has = stock === 'full' || stock === 'short' // price, readiness and hold only count for stock that exists
    factors.stock = stock === 'full' ? WEIGHTS.stock : stock === 'short' ? Math.round(WEIGHTS.stock * 0.4 * (x.qty_available !== null ? Math.min(1, x.qty_available / q) : 0.5)) : 0
    factors.price = has && unit !== null && minUnit !== null ? Math.round(((WEIGHTS.price * minUnit) / unit) * 10) / 10 : 0
    factors.ready = has && x.ready_in_minutes !== null ? Math.round(WEIGHTS.ready * Math.max(0, 1 - x.ready_in_minutes / READY_HORIZON_MIN) * 10) / 10 : 0
    factors.hold = has && x.can_hold === 'yes' ? WEIGHTS.hold : 0
    factors.confidence = CONFIDENCE[x.confidence]
    const score = Math.round((factors.stock + factors.price + factors.ready + factors.hold) * factors.confidence * 10) / 10

    // With a budget or deadline set, an unknown price or readiness cannot count as meeting it.
    const overBudget = req.max_budget_inr !== null && total !== null && total > req.max_budget_inr
    const budgetUnknown = req.max_budget_inr !== null && total === null
    const late = req.need_within_minutes !== null && x.ready_in_minutes !== null && x.ready_in_minutes > req.need_within_minutes
    const readyUnknown = req.need_within_minutes !== null && x.ready_in_minutes === null
    if (stock !== 'full') flags.push(stock === 'none' ? 'Not in stock' : stock === 'short' ? 'Cannot supply the full quantity' : 'Stock unclear')
    if (overBudget) flags.push(`Over your ${inr(req.max_budget_inr!)} budget`)
    if (budgetUnknown && stock === 'full') flags.push('Price not confirmed against your budget')
    if (late) flags.push(`Needs ~${x.ready_in_minutes} min; you need it within ${req.need_within_minutes} min`)
    if (readyUnknown && stock === 'full') flags.push('Readiness not confirmed against your deadline')
    if (!comparable) flags.push(`Price quoted per ${x.price_unit}, not per ${req.unit}: not compared`)
    else if (unit === null && positive(x.unit_price_inr) && stock !== 'none') flags.push('Price unit not stated: not compared')
    else if (unit === null && stock !== 'none') flags.push('Price not quoted')
    if (x.confidence === 'low') flags.push('Low-confidence answer')

    // Has it, how soon, will they hold it; the price comes last.
    const parts = [
      stock === 'full' ? `Has all ${qtyLabel(q, req.unit)}` : stock === 'short' ? (x.qty_available !== null ? `Only ${x.qty_available} available` : 'Partial stock') : stock === 'none' ? 'Not in stock' : 'Stock unclear',
    ]
    if (stock !== 'none') {
      parts.push(x.ready_in_minutes === null ? 'readiness not confirmed' : x.ready_in_minutes === 0 ? 'ready now' : `ready in ~${x.ready_in_minutes} min`)
      parts.push(x.can_hold === 'yes' ? 'can hold it' : x.can_hold === 'no' ? 'cannot hold it' : 'hold not confirmed')
      parts.push(
        total !== null ? `${inr(total)} total${q !== 1 && unit !== null ? ` (${inr(unit)} each)` : ''}`
        : unit !== null ? `${inr(unit)} per ${req.unit}`
        : unitMatch === null && positive(x.unit_price_inr) ? `${inr(x.unit_price_inr!)} (unit not stated)`
        : 'price not quoted',
      )
    }
    const ready = stock === 'none' ? null : x.ready_in_minutes
    const eligible = stock === 'full' && !overBudget && !late && !budgetUnknown && !readyUnknown
    return { id: r.id, shopName: r.shopName, status: r.status, ready, stock, unit, total, comparable, factors, score, eligible, flags, explanation: parts.join(' · '), winner: false }
  })

  ranked.sort(
    (a, b) =>
      Number(b.eligible) - Number(a.eligible) ||
      b.score - a.score ||
      (a.total ?? Infinity) - (b.total ?? Infinity) ||
      (a.ready ?? Infinity) - (b.ready ?? Infinity) ||
      b.factors.confidence - a.factors.confidence ||
      a.shopName.localeCompare(b.shopName) ||
      a.id.localeCompare(b.id),
  )
  if (ranked[0]?.eligible) ranked[0].winner = true
  return ranked
}

// Why the winner won, from verified facts only. `hold` is the outcome of a separate reservation call, if any.
export function winnerReason(ranked: Ranked[], hold: 'confirmed' | 'declined' | 'pending' | 'failed' | 'unknown' | null = null) {
  const w = ranked.find((r) => r.winner)
  if (!w) return null
  const full = ranked.filter((r) => r.eligible)
  const others = full.filter((r) => r !== w)
  const priced = full.filter((r) => r.total !== null)
  const unpriced = ranked.filter((r) => r.stock !== 'none' && r.stock !== 'unknown' && r.unit === null).length
  const bits: string[] = []
  if (!others.length) bits.push('Only shop that confirmed everything you asked for')
  // "Soonest" only when every other full-stock shop confirmed a later time; a tie or an unknown time is no claim.
  else if (w.ready !== null && others.every((r) => r.ready !== null && r.ready > w.ready!)) bits.push(`Ready soonest of ${full.length} shops with the full quantity`)
  else if (w.total !== null && priced.length > 1 && priced.every((r) => r.total! >= w.total!)) bits.push(`Lowest verified total of ${priced.length} priced quotes for the full quantity`)
  else bits.push(`Highest score among ${full.length} shops that confirmed the full quantity`)
  if (unpriced) bits.push(`${unpriced} shop${unpriced > 1 ? 's' : ''} did not quote a comparable price`)
  bits.push(
    hold === 'confirmed' ? 'the shop confirmed the reservation on a separate call'
    : hold === 'declined' ? 'the shop declined to hold it'
    : w.factors.hold ? 'shop says it can hold the item (not yet reserved)'
    : 'reservation not confirmed',
  )
  return bits.join('; ') + '.'
}
