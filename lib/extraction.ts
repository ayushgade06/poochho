import type { Extraction, LiveAnswer } from './types'

const FIELDS = ['in_stock', 'unit_price_inr', 'total_price_inr', 'price_unit', 'qty_available', 'brand_or_variant', 'pickup_or_delivery', 'ready_in_minutes', 'can_hold', 'opt_out', 'notes', 'stock_quote', 'confidence', 'alt_available', 'alt_brand', 'alt_price_inr']
const key = (k: string) => k.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')

// Parses Bolna's extracted_data (Category → Extraction name → { objective, subjective, confidence_label }), and also
// flat or { value }-wrapped objects. Anything that is not an exact, valid answer becomes null / "unsure" /
// "unknown": we never guess. Bolna returns values as strings; "" means not found and "null" means not applicable.
export function parseExtraction(raw: unknown): Extraction | null {
  let o = raw
  if (typeof o === 'string') {
    try {
      o = JSON.parse(o)
    } catch {
      return null
    }
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null
  const rec: Record<string, unknown> = {}
  const add = (obj: object) => Object.entries(obj).forEach(([k, v]) => FIELDS.includes(key(k)) && (rec[key(k)] = v))
  add(o)
  if (!Object.keys(rec).length) Object.values(o).forEach((v) => v && typeof v === 'object' && !Array.isArray(v) && add(v))
  if (!Object.keys(rec).length) return null

  const get = (k: string): unknown => {
    const v = rec[k]
    if (!v || typeof v !== 'object') return v
    const d = v as Record<string, unknown>
    if ('value' in d) return d.value
    return typeof d.objective === 'string' && d.objective.trim() ? d.objective : d.subjective
  }
  const word = (k: string) => {
    const v = get(k)
    if (typeof v === 'boolean') return v ? 'yes' : 'no'
    return typeof v === 'string' ? v.trim().toLowerCase() : ''
  }
  const pick = <T extends string>(k: string, allowed: readonly T[], fallback: T): T => {
    const w = word(k)
    return allowed.includes(w as T) ? (w as T) : fallback
  }
  const number = (k: string, max: number, integer = false, min = 0) => {
    let v = get(k)
    if (typeof v === 'string') {
      const s = v.replace(/₹|rs\.?|inr|rupees?|,/gi, '').trim()
      v = /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN // ranges like "500-600" stay unknown
    }
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) return null
    return integer ? Math.floor(v) : Math.round(v * 100) / 100
  }
  const PRICE_MIN = 0.01 // a quoted price of 0 is not a price
  const str = (k: string, max: number) => {
    const v = get(k)
    if (typeof v !== 'string') return null
    const s = v.trim()
    return !s || ['null', 'unknown', 'none', 'n/a', 'na'].includes(s.toLowerCase()) ? null : s.slice(0, max)
  }
  // Provider confidence of one extraction: label ("High"/"Medium"/"Low") or 0–1 score.
  const conf = (k: string): 'high' | 'med' | 'low' | null => {
    const d = rec[k]
    if (!d || typeof d !== 'object') return null
    const { confidence_label: l, confidence: c } = d as Record<string, unknown>
    const label = typeof l === 'string' ? l.toLowerCase() : typeof c === 'number' ? (c >= 0.8 ? 'high' : c >= 0.5 ? 'medium' : 'low') : ''
    return label === 'high' ? 'high' : label === 'medium' || label === 'med' ? 'med' : label === 'low' ? 'low' : null
  }

  const alt = pick('alt_available', ['yes', 'no', 'unknown'], 'unknown')
  const x: Extraction = {
    in_stock: pick('in_stock', ['yes', 'no', 'partial', 'unsure'], 'unsure'),
    unit_price_inr: number('unit_price_inr', 10_000_000, false, PRICE_MIN),
    total_price_inr: number('total_price_inr', 10_000_000, false, PRICE_MIN),
    price_unit: str('price_unit', 30),
    qty_available: number('qty_available', 1_000_000),
    brand_or_variant: str('brand_or_variant', 120),
    pickup_or_delivery: pick('pickup_or_delivery', ['pickup', 'delivery', 'unknown'], 'unknown'),
    ready_in_minutes: number('ready_in_minutes', 10_080, true),
    can_hold: pick('can_hold', ['yes', 'no', 'unknown'], 'unknown'),
    opt_out: word('opt_out') === 'yes' ? 'yes' : 'no',
    confidence: 'low',
    notes: str('notes', 300),
    stock_quote: str('stock_quote', 300),
    // Another brand's name and price only count if the shop said it has one.
    alt_available: alt,
    alt_brand: alt === 'yes' ? str('alt_brand', 80) : null,
    alt_price_inr: alt === 'yes' ? number('alt_price_inr', 10_000_000, false, PRICE_MIN) : null,
  }
  // Explicit confidence field if configured; otherwise the weakest provider confidence among the answers that
  // drive ranking (availability and the quoted price). No signal at all means "low".
  const explicit = word('confidence')
  const derived = ['in_stock', x.total_price_inr !== null ? 'total_price_inr' : 'unit_price_inr'].map(conf).filter(Boolean)
  x.confidence =
    explicit === 'high' ? 'high'
    : ['med', 'medium'].includes(explicit) ? 'med'
    : explicit === 'low' ? 'low'
    : derived.includes('low') || !derived.length ? 'low'
    : derived.includes('med') ? 'med'
    : 'high'
  // A shop that says "not in stock" but quotes a quantity contradicts itself: keep the uncertainty.
  if (x.in_stock === 'no' && (x.qty_available ?? 0) > 0) x.in_stock = 'unsure'
  return x
}

// The extraction model is asked for the shopkeeper's words verbatim, but nothing guarantees it. A quote is shown
// only if it appears, word for word, inside one of the shopkeeper's own turns ("user:" lines; never the AI's),
// ignoring case, punctuation and spacing. A paraphrase, a translation or an invented line never reaches the screen.
const words = (s: string) => s.normalize('NFC').toLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim()
export function quoteHeard(quote: string | null | undefined, transcript: string | null | undefined) {
  const q = quote ? words(quote) : ''
  if (!q || !transcript) return false
  const turns: string[] = []
  let shop = false
  for (const line of transcript.split('\n')) {
    const m = /^\s*(assistant|user|agent|bot)\s*:(.*)$/i.exec(line)
    const isShop: boolean = m ? m[1].toLowerCase() === 'user' : shop // an unprefixed line continues the turn above it
    if (isShop && shop) turns[turns.length - 1] += ' ' + (m ? m[2] : line) // the transcriber splits a turn on pauses
    else if (isShop) turns.push(m![2])
    shop = isShop
  }
  return turns.some((t) => ` ${words(t)} `.includes(` ${q} `)) // whole words only
}

// The agent's report_availability tool call (mid-call). Bolna substitutes every value into a string ("True",
// "None", "540.0"), so each is read with the same rules as the post-call extraction. Only what was actually said
// is kept, so a later report adds to an earlier one instead of erasing it. price_inr is for the whole quantity.
export function parseLive(raw: unknown): LiveAnswer | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const yn = (v: unknown) => (/^true$/i.test(String(v).trim()) ? 'yes' : /^false$/i.test(String(v).trim()) ? 'no' : v)
  const x = parseExtraction({ in_stock: yn(o.in_stock), can_hold: yn(o.can_hold), qty_available: o.qty_available, total_price_inr: o.price_inr, ready_in_minutes: o.ready_in_minutes })!
  const live: LiveAnswer = {}
  if (x.in_stock !== 'unsure') live.in_stock = x.in_stock
  if (x.can_hold !== 'unknown') live.can_hold = x.can_hold
  if (x.qty_available !== null) live.qty_available = x.qty_available
  if (x.total_price_inr !== null) live.price_inr = x.total_price_inr
  if (x.ready_in_minutes !== null) live.ready_in_minutes = x.ready_in_minutes
  return Object.keys(live).length ? live : null
}

// A quote is usable once availability is known and, if available, a price was given.
export function isUsableQuote(x: Extraction | null) {
  if (!x) return false
  return x.in_stock === 'no' || (['yes', 'partial'].includes(x.in_stock) && (x.unit_price_inr ?? x.total_price_inr) != null)
}
