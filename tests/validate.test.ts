import { describe, expect, it } from 'vitest'
import { validateSearch } from '@/lib/validate'

const good = { mode: 'simulated', product: 'Amul Butter 500g', quantity: '2', unit: 'packet', city: 'Pune', area: 'Kothrud', language: 'hi', shop_ids: ['demo-a', 'demo-b'] }

describe('validateSearch', () => {
  it('accepts a complete request and coerces numbers', () => {
    const r = validateSearch({ ...good, max_budget_inr: '600', need_within_minutes: 45 }, 5)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toMatchObject({ quantity: 2, max_budget_inr: 600, need_within_minutes: 45, brand_or_variant: null, category: null })
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
