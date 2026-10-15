export const MODES = ['simulated', 'live', 'replay'] as const
export type Mode = (typeof MODES)[number]

// Languages the configured Bolna agent speaks (Agent Studio → Languages: Hindi default, English).
export const LANGS = { hi: 'Hindi', en: 'English' } as const
export type Lang = keyof typeof LANGS

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
}

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
}
// SIMULATED/REPLAY step: a Bolna-shaped execution payload delivered `at` ms after dispatch.
export type ScriptEvent = { at: number; payload: Record<string, unknown> }

export type Execution = {
  id: string
  request_id: string
  shop_id: string
  kind: CallKind
  mode: Mode
  status: CallStatus
  provider_execution_id: string | null
  provider_status: string | null
  error: string | null
  transcript: string | null
  extracted: Extraction | null
  raw_extracted: unknown
  duration_seconds: number | null
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
export type SearchState = { request: SearchRequest; executions: PublicExecution[] }
