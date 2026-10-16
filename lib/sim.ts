import demo from '@/data/shops.json'
import { CALL_LANGS, type ScriptEvent, type SearchRequest } from './types'

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

type Req = Pick<SearchRequest, 'product' | 'brand_or_variant' | 'category' | 'quantity' | 'unit' | 'area'>

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

// What each side says, per call language. Every call opens with the same greeting a real call does (the agent's
// welcome message), then follows the prompt's order. The shopkeepers' lines are scripted, not real.
const LINES = {
  hi: {
    yes: 'हाँ, बोलिए.',
    ask: (item: string, q: string, area: string) => `${area} के एक customer को ${item} चाहिए, ${q}. क्या यह आपके पास stock में है?`,
    have: (q: string) => `हाँ है, ${q} मिल जाएगा.`,
    some: (n: number, unit: string) => `अभी सिर्फ ${n} ${unit} है.`,
    none: 'नहीं, अभी stock में नहीं है.',
    price: 'इसकी price क्या है?',
    total: (q: string, t: number) => `${q} का ${t} रुपये लगेगा.`,
    each: (unit: string, p: number) => `एक ${unit} का ${p} रुपये.`,
    noPrice: 'Price तो counter पे आके पता चलेगा.',
    hold: 'अगर customer लेना चाहें, तो क्या आप इसे उनके लिए थोड़ी देर रख पाएँगे? यह कितने minute में ready हो जाएगा?',
    holdYes: (m: number) => `हाँ रख देंगे, ${m} मिनट में ready हो जाएगा.`,
    holdMaybe: (m: number) => `देखते हैं, ${m} मिनट में ready कर देंगे.`,
    holdNo: 'नहीं, रख नहीं पाएंगे.',
    bye: 'बहुत धन्यवाद, मैं customer को बता दूँगी. आपका दिन अच्छा हो.',
    sorry: 'ठीक है, समझ गई. बताने के लिए धन्यवाद, आपका दिन शुभ हो.',
    reserve: (item: string) => `थोड़ी देर पहले हमने आपसे ${item} के बारे में पूछा था. Customer इसे लेना चाहते हैं, क्या आप इसे उनके लिए रख देंगे?`,
    reserved: 'हाँ, रख दिया. आ जाइए.',
    unsure: 'अभी पक्का नहीं बोल सकते, आके देख लीजिए.',
  },
  en: {
    yes: 'Yes, go ahead.',
    ask: (item: string, q: string, area: string) => `A customer from ${area} needs ${item}, ${q}. Do you have it in stock?`,
    have: (q: string) => `Yes, we have ${q}.`,
    some: (n: number, unit: string) => `Right now we only have ${n} ${unit}.`,
    none: 'No, it is out of stock right now.',
    price: 'What is the price?',
    total: (q: string, t: number) => `${q} will be ${t} rupees.`,
    each: (unit: string, p: number) => `${p} rupees per ${unit}.`,
    noPrice: 'You will get the price at the counter.',
    hold: 'If the customer wants it, could you keep it for them for a while? How many minutes until it is ready?',
    holdYes: (m: number) => `Yes, we will keep it. It will be ready in ${m} minutes.`,
    holdMaybe: (m: number) => `We will see. We can have it ready in ${m} minutes.`,
    holdNo: 'No, we cannot keep it aside.',
    bye: 'Thank you so much, I will let the customer know. Have a good day.',
    sorry: 'Okay, understood. Thank you for telling me, have a good day.',
    reserve: (item: string) => `A little while ago we asked you about ${item}. The customer wants to buy it. Could you keep it for them?`,
    reserved: 'Yes, it is kept aside. Please come.',
    unsure: 'I cannot promise right now, please come and check.',
  },
  // Marathi: written by the developer, needs a native speaker's review (BUILD_REPORT §9).
  mr: {
    yes: 'हो, बोला.',
    ask: (item: string, q: string, area: string) => `${area} मधल्या एका customer ला ${item} हवे आहे, ${q}. तुमच्याकडे stock मध्ये आहे का?`,
    have: (q: string) => `हो आहे, ${q} मिळेल.`,
    some: (n: number, unit: string) => `आत्ता फक्त ${n} ${unit} आहे.`,
    none: 'नाही, आत्ता stock मध्ये नाही.',
    price: 'याची price किती आहे?',
    total: (q: string, t: number) => `${q} चे ${t} रुपये होतील.`,
    each: (unit: string, p: number) => `एका ${unit} चे ${p} रुपये.`,
    noPrice: 'Price counter वर आल्यावर कळेल.',
    hold: 'Customer ला घ्यायचे असेल, तर तुम्ही हे त्यांच्यासाठी थोडा वेळ ठेवू शकाल का? किती minute मध्ये ready होईल?',
    holdYes: (m: number) => `हो ठेवतो, ${m} मिनिटांत ready होईल.`,
    holdMaybe: (m: number) => `बघू, ${m} मिनिटांत ready करू.`,
    holdNo: 'नाही, ठेवता येणार नाही.',
    bye: 'खूप धन्यवाद, मी customer ला सांगेन. तुमचा दिवस चांगला जावो.',
    sorry: 'ठीक आहे, समजले. सांगितल्याबद्दल धन्यवाद, तुमचा दिवस चांगला जावो.',
    reserve: (item: string) => `थोड्या वेळापूर्वी आम्ही तुम्हाला ${item} बद्दल विचारले होते. Customer ला ते घ्यायचे आहे, तुम्ही ते त्यांच्यासाठी ठेवाल का?`,
    reserved: 'हो, ठेवले आहे. या.',
    unsure: 'आत्ता नक्की सांगू शकत नाही, येऊन बघा.',
  },
}
const lines = (lang: string) => ({ ...LINES[(lang in LINES ? lang : 'hi') as keyof typeof LINES], greeting: CALL_LANGS[lang]?.greeting ?? CALL_LANGS.hi.greeting })

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

// `lang` is the language the call is placed in (callLanguage in lib/types.ts).
export function quoteScript(shop: DemoShop, req: Req, lang: string, providerId: string): ScriptEvent[] {
  const s = shop.sim
  if (s.outcome !== 'quote') return timeline(providerId, s, null)
  const L = lines(lang)
  const item = itemLabel(req)
  const q = `${req.quantity} ${req.unit}`
  const unit = s.priceFactor ? round5(simUnitPrice(req.product, req.category) * s.priceFactor) : null
  const stock = s.stock ?? 'yes'
  const t: [boolean, string][] = [[true, L.greeting], [false, L.yes], [true, L.ask(item, q, req.area)]]
  const f: Record<string, string | null> = { in_stock: stock, unit_price_inr: '', total_price_inr: '', price_unit: '', qty_available: '', brand_or_variant: req.brand_or_variant ?? '', pickup_or_delivery: 'unknown', ready_in_minutes: '', can_hold: 'unknown', opt_out: 'no', notes: '' }
  // stock_quote is the shopkeeper's availability line, verbatim, as Bolna's extraction is asked to return it.
  if (stock === 'no') {
    t.push([false, L.none], [true, L.sorry])
    f.stock_quote = L.none
  } else {
    f.stock_quote = stock === 'partial' ? L.some(s.qty ?? 1, req.unit) : L.have(q)
    t.push([false, f.stock_quote], [true, L.price])
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

export function holdScript(shop: DemoShop, req: Req, lang: string, providerId: string): ScriptEvent[] {
  const L = lines(lang)
  const ok = shop.sim.hold === 'yes'
  const t: [boolean, string][] = [[true, L.greeting], [false, L.yes], [true, L.reserve(itemLabel(req))], [false, ok ? L.reserved : L.unsure], [true, L.bye]]
  const f = { in_stock: 'yes', can_hold: ok ? 'yes' : 'unknown', opt_out: 'no', pickup_or_delivery: 'pickup' }
  return timeline(providerId, { outcome: 'quote', ringMs: 2800, talkMs: 9000 }, { transcript: turns(t), extracted_data: extraction(f, 'high') })
}
