import callLangs from '@/data/call-languages.json'

// judge: the judge plays one shop in their own browser (Bolna Web Call SDK); the other shops are simulated.
export const MODES = ['simulated', 'live', 'replay', 'judge'] as const
export type Mode = (typeof MODES)[number]

// The request's language: the summary's language, and the call language for shops whose own language the agent
// doesn't speak.
export const LANGS = { hi: 'Hindi', en: 'English' } as const
export type Lang = keyof typeof LANGS

// Every language the Bolna agent can place a call in (its multilingual_config languages; `npm run bolna -- check`
// compares the two), with the greeting each call opens with. Bolna refuses a call in any other language.
export const CALL_LANGS: Record<string, { name: string; greeting: string }> = callLangs
// A shop is called in its own language when the agent speaks it, otherwise in the request's language.
export const callLanguage = (shopLang: string, requestLang: string) => (Object.hasOwn(CALL_LANGS, shopLang) ? shopLang : requestLang)

// Languages the user can speak to Poochho and hear the summary in (Sarvam saaras STT + bulbul TTS). Languages
// other than Hindi and English are machine-translated for the user.
export const VOICE_LANGS = {
  'hi-IN': 'हिन्दी', 'en-IN': 'English', 'mr-IN': 'मराठी', 'bn-IN': 'বাংলা', 'ta-IN': 'தமிழ்', 'te-IN': 'తెలుగు',
  'kn-IN': 'ಕನ್ನಡ', 'ml-IN': 'മലയാളം', 'gu-IN': 'ગુજરાતી', 'pa-IN': 'ਪੰਜਾਬੀ', 'od-IN': 'ଓଡ଼ିଆ',
} as const
export type VoiceLang = keyof typeof VOICE_LANGS

export const UNITS = ['piece', 'packet', 'kg', 'g', 'litre', 'ml', 'strip', 'bottle', 'box', 'dozen', 'metre'] as const
export const CATEGORIES = ['grocery', 'pharmacy', 'hardware', 'electronics', 'stationery', 'other'] as const

// Internal call state model. Provider statuses are mapped onto this in lib/state.ts.
export type CallStatus = 'queued' | 'dispatching' | 'ringing' | 'talking' | 'processing' | 'done' | 'failed' | 'timeout'
export type CallKind = 'quote' | 'hold'

export type Extraction = {
  in_stock: 'yes' | 'no' | 'partial' | 'unsure'
  unit_price_inr: number | null
  total_price_inr: number | null
  price_unit: string | null
  qty_available: number | null
  brand_or_variant: string | null
  pickup_or_delivery: 'pickup' | 'delivery' | 'unknown'
  ready_in_minutes: number | null
  can_hold: 'yes' | 'no' | 'unknown'
  opt_out: 'yes' | 'no'
  confidence: 'high' | 'med' | 'low'
  notes: string | null
  stock_quote: string | null // the shopkeeper's own words about availability; shown only if found in the transcript
}

// What the agent reported mid-call through its report_availability tool: provisional, and only what was said.
// The post-call extraction replaces it.
export type LiveAnswer = Partial<Pick<Extraction, 'in_stock' | 'qty_available' | 'ready_in_minutes' | 'can_hold'> & { price_inr: number }>

export type SearchRequest = {
  id: string
  mode: Mode
  product: string
  brand_or_variant: string | null
  category: string | null
  quantity: number
  unit: string
  city: string
  area: string
  language: Lang
  max_budget_inr: number | null
  need_within_minutes: number | null
  constraints: string | null
  asked_in: VoiceLang | null // the language the user spoke the request in, if they spoke it (Sarvam-detected)
  stop_when_found: boolean // stop dialling once a shop confirms it has everything and will hold it
  replay_of: string | null
  created_at: string
}

export type Shop = {
  id: string
  name: string
  area: string
  city: string
  language: string
  source: 'demo' | 'live' | 'replay'
}

// A provider event after normalisation (lib/bolna.ts toEvent): from a webhook, a poll, or a scripted step.
export type ProviderEvent = {
  status: string
  transcript?: string | null
  extracted_data?: unknown
  duration?: number | null
  error_message?: string | null
  answered_by_voice_mail?: boolean | null
  cost?: number | null // US cents (Bolna total_cost)
  live?: LiveAnswer | null // heard mid-call (tool call); merged until the post-call extraction exists
}
// SIMULATED/REPLAY step: a Bolna-shaped execution payload delivered `at` ms after dispatch.
export type ScriptEvent = { at: number; payload: Record<string, unknown> }

export type Execution = {
  id: string
  request_id: string
  shop_id: string
  kind: CallKind
  mode: Mode
  language: string | null // what the call was placed in; null on calls made before this was recorded
  status: CallStatus
  provider_execution_id: string | null
  provider_status: string | null
  error: string | null
  transcript: string | null
  extracted: Extraction | null
  raw_extracted: unknown
  live_answer: LiveAnswer | null
  live_answer_at: string | null
  duration_seconds: number | null
  cost_cents: number | null // what Bolna charged, in US cents
  script: ScriptEvent[] | null
  script_cursor: number
  version: number
  dispatched_at: string | null
  answered_at: string | null
  ended_at: string | null
  first_quote_at: string | null
  last_polled_at: string | null
  created_at: string
}

// What the browser receives: never phone numbers, never the scripted future.
export type PublicExecution = Omit<Execution, 'script' | 'script_cursor' | 'version' | 'raw_extracted' | 'last_polled_at'> & { shop: Shop }
// `redacted`: a LIVE search viewed without the operator token (no transcripts, notes or raw errors).
export type SearchState = { request: SearchRequest; executions: PublicExecution[]; redacted?: boolean }
