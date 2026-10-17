import { describe, expect, it } from 'vitest'
import { validateSearch } from '@/lib/validate'

const good = { mode: 'simulated', product: 'Amul Butter 500g', quantity: '2', unit: 'packet', city: 'Pune', area: 'Kothrud', language: 'hi', shop_ids: ['demo-a', 'demo-b'] }

describe('validateSearch', () => {
  it('accepts a complete request and coerces numbers', () => {
    const r = validateSearch({ ...good, max_budget_inr: '600', need_within_minutes: 45 }, 5)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toMatchObject({ quantity: 2, max_budget_inr: 600, need_within_minutes: 45, brand_or_variant: null, category: null, stop_when_found: true })
    const off = validateSearch({ ...good, stop_when_found: false }, 5)
    expect(off.ok && off.value.stop_when_found).toBe(false)
    expect(validateSearch({ ...good, stop_when_found: 'no' }, 5).ok).toBe(false)
  })

  it('takes a medicine only for pharmacy requests, and alternatives only with a medicine', () => {
    const ok = validateSearch({ ...good, category: 'pharmacy', medicine_id: 42, ask_alternative: true }, 5)
    expect(ok.ok && ok.value).toMatchObject({ medicine_id: 42, ask_alternative: true })
    const none = validateSearch({ ...good, ask_alternative: true }, 5)
    expect(none.ok && none.value).toMatchObject({ medicine_id: null, ask_alternative: false })
    const bad = validateSearch({ ...good, category: 'grocery', medicine_id: 42, ask_alternative: 'yes' }, 5)
    expect(!bad.ok && Object.keys(bad.errors).sort()).toEqual(['ask_alternative', 'medicine_id'])
    expect(validateSearch({ ...good, category: 'pharmacy', medicine_id: 1.5 }, 5).ok).toBe(false)
  })

  it('reports every missing required field', () => {
    const r = validateSearch({}, 5)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['area', 'city', 'language', 'mode', 'product', 'quantity', 'shop_ids', 'unit'])
  })

  it('rejects out-of-range and unknown values', () => {
    const r = validateSearch({ ...good, quantity: 0, unit: 'tonne', language: 'fr', mode: 'replay', max_budget_inr: -1, category: 'weapons' }, 5)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['category', 'language', 'max_budget_inr', 'mode', 'quantity', 'unit'])
  })

  it('accepts two-decimal quantities despite floating point, and whole minutes only', () => {
    for (const q of ['1.1', '2.3', '1.15', '0.07', '4.35']) expect(validateSearch({ ...good, quantity: q }, 5).ok).toBe(true)
    expect(validateSearch({ ...good, quantity: '1.234' }, 5).ok).toBe(false)
    expect(validateSearch({ ...good, need_within_minutes: 45.5 }, 5).ok).toBe(false)
  })

  it('enforces the per-request call cap and shop id format', () => {
    expect(validateSearch({ ...good, shop_ids: ['a', 'b', 'c'] }, 2).ok).toBe(false)
    expect(validateSearch({ ...good, shop_ids: ['ok', 'Bad Id!'] }, 5).ok).toBe(false)
    const dup = validateSearch({ ...good, shop_ids: ['a', 'a'] }, 1)
    expect(dup.ok && dup.value.shop_ids).toEqual(['a'])
  })

  it('strips control characters and rejects over-long text', () => {
    const r = validateSearch({ ...good, product: ' Amul\u0000 \n Butter ' }, 5)
    expect(r.ok && r.value.product).toBe('Amul Butter')
    expect(validateSearch({ ...good, product: 'x'.repeat(121) }, 5).ok).toBe(false)
  })
})
