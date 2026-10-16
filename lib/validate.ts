import { CATEGORIES, LANGS, UNITS, VOICE_LANGS, type Lang, type Mode, type VoiceLang } from './types'

export type NewSearch = {
  mode: Exclude<Mode, 'replay'>
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
  asked_in: VoiceLang | null
  shop_ids: string[]
}

type Result = { ok: true; value: NewSearch } | { ok: false; errors: Record<string, string> }

export function validateSearch(input: unknown, maxCalls: number): Result {
  const b = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const errors: Record<string, string> = {}

  const text = (k: string, max: number, required = false) => {
    const v = typeof b[k] === 'string' ? (b[k] as string).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : ''
    if (!v) {
      if (required) errors[k] = 'Required'
      return null
    }
    if (v.length > max) errors[k] = `At most ${max} characters`
    return v.slice(0, max)
  }
  const num = (k: string, min: number, max: number, required = false, integer = false) => {
    const raw = b[k]
    if (raw === undefined || raw === null || raw === '') {
      if (required) errors[k] = 'Required'
      return null
    }
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
      errors[k] = `Must be ${integer ? 'a whole number ' : ''}between ${min} and ${max}`
      return null
    }
    return n
  }
  const oneOf = <T extends string>(k: string, allowed: readonly T[], required = false): T | null => {
    const v = b[k]
    if (v === undefined || v === null || v === '') {
      if (required) errors[k] = 'Required'
      return null
    }
    if (!allowed.includes(v as T)) errors[k] = `Must be one of: ${allowed.join(', ')}`
    return allowed.includes(v as T) ? (v as T) : null
  }

  const mode = oneOf('mode', ['simulated', 'live'] as const, true)
  const product = text('product', 120, true)
  const quantity = num('quantity', 0.01, 1000, true)
  if (quantity !== null && Math.abs(Math.round(quantity * 100) - quantity * 100) > 1e-6) errors.quantity = 'At most two decimals'
  const unit = oneOf('unit', UNITS, true)
  const language = oneOf('language', Object.keys(LANGS) as Lang[], true)
  const shopIds = Array.isArray(b.shop_ids) ? [...new Set(b.shop_ids)] : []
  if (!shopIds.length) errors.shop_ids = 'Pick at least one shop'
  else if (shopIds.length > maxCalls) errors.shop_ids = `At most ${maxCalls} shops per search`
  else if (!shopIds.every((s) => typeof s === 'string' && /^[a-z0-9-]{1,64}$/.test(s))) errors.shop_ids = 'Invalid shop id'

  const value: NewSearch = {
    mode: mode ?? 'simulated',
    product: product ?? '',
    brand_or_variant: text('brand_or_variant', 80),
    category: oneOf('category', CATEGORIES),
    quantity: quantity ?? 0,
    unit: unit ?? 'piece',
    city: text('city', 60, true) ?? '',
    area: text('area', 80, true) ?? '',
    language: language ?? 'hi',
    max_budget_inr: num('max_budget_inr', 1, 10_000_000),
    need_within_minutes: num('need_within_minutes', 5, 1440, false, true),
    constraints: text('constraints', 300),
    asked_in: oneOf('asked_in', Object.keys(VOICE_LANGS) as VoiceLang[]),
    shop_ids: shopIds as string[],
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value }
}
