import type { Extraction } from './types'

const FIELDS = ['in_stock', 'unit_price_inr', 'total_price_inr', 'price_unit', 'qty_available', 'brand_or_variant', 'pickup_or_delivery', 'ready_in_minutes', 'can_hold', 'opt_out', 'notes', 'confidence']
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
  const number = (k: string, max: number, integer = false) => {
    let v = get(k)
    if (typeof v === 'string') {
      const s = v.replace(/₹|rs\.?|inr|rupees?|,/gi, '').trim()
      v = /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN // ranges like "500-600" stay unknown
    }
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) return null
    return integer ? Math.floor(v) : Math.round(v * 100) / 100
  }
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

  const x: Extraction = {
    in_stock: pick('in_stock', ['yes', 'no', 'partial', 'unsure'], 'unsure'),
    unit_price_inr: number('unit_price_inr', 10_000_000),
    total_price_inr: number('total_price_inr', 10_000_000),
    price_unit: str('price_unit', 30),
    qty_available: number('qty_available', 1_000_000),
    brand_or_variant: str('brand_or_variant', 120),
    pickup_or_delivery: pick('pickup_or_delivery', ['pickup', 'delivery', 'unknown'], 'unknown'),
    ready_in_minutes: number('ready_in_minutes', 10_080, true),
    can_hold: pick('can_hold', ['yes', 'no', 'unknown'], 'unknown'),
    opt_out: word('opt_out') === 'yes' ? 'yes' : 'no',
    confidence: 'low',
    notes: str('notes', 300),
  }
  // Explicit confidence field if configured; otherwise the weakest provider confidence among the answers that
  // drive ranking (availability and the quoted price). No signal at all means "low".
  const explicit = word('confidence')
  const derived = ['in_stock', x.unit_price_inr !== null ? 'unit_price_inr' : 'total_price_inr'].map(conf).filter(Boolean)
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

// A quote is usable once availability is known and, if available, a price was given.
export function isUsableQuote(x: Extraction | null) {
  if (!x) return false
  return x.in_stock === 'no' || (['yes', 'partial'].includes(x.in_stock) && (x.unit_price_inr ?? x.total_price_inr) != null)
}
