import demo from '@/data/shops.json'
import type { Lang, ScriptEvent, SearchRequest } from './types'

type Sim = {
  outcome: 'quote' | 'no-answer' | 'busy'
  stock?: 'yes' | 'no' | 'partial' | 'unsure'
  qty?: number
  priceFactor?: number | null
  ready?: number
  hold?: 'yes' | 'no' | 'unknown'
  confidence?: 'high' | 'med' | 'low'
  ringMs: number
  talkMs?: number
}
export type DemoShop = { id: string; name: string; area: string; language: string; sim: Sim }
export const DEMO_SHOPS = demo as DemoShop[]

type Req = Pick<SearchRequest, 'product' | 'brand_or_variant' | 'category' | 'quantity' | 'unit' | 'area' | 'language'>

const RANGES: Record<string, [number, number]> = { grocery: [40, 400], pharmacy: [30, 450], hardware: [80, 1200], electronics: [300, 3000], stationery: [10, 150] }
const round5 = (n: number) => Math.max(5, Math.round(n / 5) * 5)
// What the agent says. A comma, not brackets: the voice reads "boAt Airdopes 141, Black" with a natural pause.
export const itemLabel = (r: Pick<SearchRequest, 'product' | 'brand_or_variant'>) => (r.brand_or_variant ? `${r.product}, ${r.brand_or_variant}` : r.product)

// Deterministic simulated unit price: product-name hash within a category range. Clearly fictional.
export function simUnitPrice(product: string, category: string | null) {
  let h = 2166136261
  for (const c of product.toLowerCase()) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0
  const [lo, hi] = RANGES[category ?? ''] ?? [50, 600]
  return round5(lo + (h % (hi - lo)))
}

const LABEL = { high: 'High', med: 'Medium', low: 'Low' } as const

function lines(lang: Lang) {
  const hi = lang === 'hi'
  return {
    open: (shop: string, area: string) =>
      hi ? `नमस्ते, क्या आप ${shop} से हैं? मैं Poochho की AI assistant हूँ, एक customer की तरफ से call कर रही हूँ जो ${area} से हैं. क्या आप एक मिनट दे सकते हैं?`
        : `Hello, is this ${shop}? I am Poochho's AI assistant, calling on behalf of a customer from ${area}. Do you have a minute?`,
    yes: hi ? 'हाँ, बोलिए.' : 'Yes, go ahead.',
    ask: (item: string, q: string) => (hi ? `क्या आपके पास ${item} है, ${q} की quantity में?` : `Do you have ${item}, ${q}?`),
    have: (q: string) => (hi ? `हाँ है, ${q} मिल जाएगा.` : `Yes, we have ${q}.`),
    some: (n: number, unit: string) => (hi ? `अभी सिर्फ ${n} ${unit} है.` : `Right now we only have ${n} ${unit}.`),
    none: hi ? 'नहीं, अभी stock में नहीं है.' : 'No, it is out of stock right now.',
    price: (item: string) => (hi ? `इस ${item} की कीमत क्या है, रुपये में?` : `What is the price of ${item}, in rupees?`),
    total: (q: string, t: number) => (hi ? `${q} का ${t} रुपये लगेगा.` : `${q} will be ${t} rupees.`),
    each: (unit: string, p: number) => (hi ? `एक ${unit} का ${p} रुपये.` : `${p} rupees per ${unit}.`),
    noPrice: hi ? 'Price तो counter पे आके पता चलेगा.' : 'You will get the price at the counter.',
    hold: hi ? 'क्या आप इसे हमारे customer के लिए रख सकते हैं? कितनी जल्दी ready हो सकता है?' : 'Could you keep it for our customer? How soon can it be ready?',
    holdYes: (m: number) => (hi ? `हाँ रख देंगे, ${m} मिनट में ready हो जाएगा.` : `Yes, we will keep it. It will be ready in ${m} minutes.`),
    holdMaybe: (m: number) => (hi ? `देखते हैं, ${m} मिनट में ready कर देंगे.` : `We will see. We can have it ready in ${m} minutes.`),
    holdNo: hi ? 'नहीं, रख नहीं पाएंगे.' : 'No, we cannot keep it aside.',
    bye: hi ? 'बहुत शुक्रिया. हम customer को सब बता देंगे. आपका दिन अच्छा हो.' : 'Thank you so much. We will let the customer know. Have a good day.',
    sorry: hi ? 'ठीक है, समझ गई. आपका समय देने के लिए धन्यवाद.' : 'Okay, understood. Thank you for your time.',
    reserve: (item: string, q: string, area: string) =>
      hi ? `नमस्ते, मैं Poochho की AI assistant हूँ. थोड़ी देर पहले ${item} के बारे में बात हुई थी. क्या आप ${q} हमारे customer के लिए रख सकते हैं? वो ${area} से आ रहे हैं.`
        : `Hello, this is Poochho's AI assistant again about ${item}. Could you please keep ${q} aside for our customer? They are coming from ${area}.`,
    reserved: hi ? 'हाँ, रख दिया. आ जाइए.' : 'Yes, it is kept aside. Please come.',
    unsure: hi ? 'अभी पक्का नहीं बोल सकते, आके देख लीजिए.' : 'I cannot promise right now, please come and check.',
  }
}

// Bolna-shaped disposition results: Category → name → { objective, subjective, confidence_label }.
function extraction(fields: Record<string, string | null>, confidence: 'high' | 'med' | 'low') {
  const objective = ['in_stock', 'can_hold', 'pickup_or_delivery', 'opt_out']
  return {
    'Shop Quote': Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [k, objective.includes(k) ? { objective: v, subjective: '', confidence_label: LABEL[confidence] } : { objective: null, subjective: v ?? '', confidence_label: LABEL[confidence] }]),
    ),
  }
}

const turns = (t: [boolean, string][]) => t.map(([agent, s]) => `${agent ? 'assistant' : 'user'}: ${s}`).join('\n') + '\n'

// Event timeline mirrors Bolna's documented order: queued → initiated → ringing → in-progress →
// call-disconnected → completed. Transcript and extraction arrive with "completed", as on live calls.
function timeline(id: string, s: Sim, final: { transcript: string; extracted_data: object } | null): ScriptEvent[] {
  const ev = (at: number, status: string, extra: object = {}) => ({ at, payload: { id, status, ...extra } })
  const head = [ev(0, 'queued'), ev(700, 'initiated'), ev(1500, 'ringing')]
  if (s.outcome === 'busy') return [ev(0, 'queued'), ev(700, 'initiated'), ev(s.ringMs, 'busy')]
  if (s.outcome === 'no-answer' || !final) return [...head, ev(s.ringMs, 'no-answer')]
  const end = s.ringMs + (s.talkMs ?? 12000)
  return [
    ...head,
    ev(s.ringMs, 'in-progress'),
    ev(end, 'call-disconnected', { conversation_duration: 0 }),
    ev(end + 2500, 'completed', { ...final, conversation_duration: Math.round((s.talkMs ?? 12000) / 1000) }),
  ]
}

export function quoteScript(shop: DemoShop, req: Req, providerId: string): ScriptEvent[] {
  const s = shop.sim
  if (s.outcome !== 'quote') return timeline(providerId, s, null)
  const L = lines(req.language)
  const item = itemLabel(req)
  const q = `${req.quantity} ${req.unit}`
  const unit = s.priceFactor ? round5(simUnitPrice(req.product, req.category) * s.priceFactor) : null
  const stock = s.stock ?? 'yes'
  const t: [boolean, string][] = [[true, L.open(shop.name, req.area)], [false, L.yes], [true, L.ask(item, q)]]
  const f: Record<string, string | null> = { in_stock: stock, unit_price_inr: '', total_price_inr: '', price_unit: '', qty_available: '', brand_or_variant: req.brand_or_variant ?? '', pickup_or_delivery: 'unknown', ready_in_minutes: '', can_hold: 'unknown', opt_out: 'no', notes: '' }
  if (stock === 'no') {
    t.push([false, L.none], [true, L.sorry])
  } else {
    t.push([false, stock === 'partial' ? L.some(s.qty ?? 1, req.unit) : L.have(q)], [true, L.price(item)])
    if (stock === 'partial') f.qty_available = String(s.qty ?? 1)
    if (unit === null) t.push([false, L.noPrice])
    else if (stock === 'partial') {
      t.push([false, L.each(req.unit, unit)])
      Object.assign(f, { unit_price_inr: String(unit), price_unit: req.unit })
    } else {
      t.push([false, L.total(q, unit * req.quantity)])
      Object.assign(f, { total_price_inr: String(Math.round(unit * req.quantity * 100) / 100), price_unit: req.unit })
    }
    const m = s.ready ?? 15
    t.push([true, L.hold], [false, s.hold === 'yes' ? L.holdYes(m) : s.hold === 'no' ? L.holdNo : L.holdMaybe(m)], [true, L.bye])
    Object.assign(f, { ready_in_minutes: String(m), can_hold: s.hold ?? 'unknown', pickup_or_delivery: 'pickup' })
  }
  return timeline(providerId, s, { transcript: turns(t), extracted_data: extraction(f, s.confidence ?? 'med') })
}

export function holdScript(shop: DemoShop, req: Req, providerId: string): ScriptEvent[] {
  const L = lines(req.language)
  const item = itemLabel(req)
  const q = `${req.quantity} ${req.unit}`
  const ok = shop.sim.hold === 'yes'
  const t: [boolean, string][] = [[true, L.reserve(item, q, req.area)], [false, ok ? L.reserved : L.unsure], [true, L.bye]]
  const f = { in_stock: 'yes', can_hold: ok ? 'yes' : 'unknown', opt_out: 'no', pickup_or_delivery: 'pickup' }
  return timeline(providerId, { outcome: 'quote', ringMs: 2800, talkMs: 9000 }, { transcript: turns(t), extracted_data: extraction(f, 'high') })
}
