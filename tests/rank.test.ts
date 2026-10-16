import { describe, expect, it } from 'vitest'
import { hasAndHolds, rankResults, stockOf, WEIGHTS, winnerReason } from '@/lib/rank'
import type { Extraction } from '@/lib/types'

const req = { quantity: 2, unit: 'packet', max_budget_inr: null, need_within_minutes: null }
const x = (o: Partial<Extraction> = {}): Extraction => ({
  in_stock: 'yes', unit_price_inr: null, total_price_inr: null, price_unit: 'packet', qty_available: null, brand_or_variant: null,
  pickup_or_delivery: 'pickup', ready_in_minutes: 10, can_hold: 'unknown', opt_out: 'no', confidence: 'high', notes: null, stock_quote: null, ...o,
})
const row = (id: string, extracted: Extraction | null, status: 'done' | 'failed' = 'done') => ({ id, shopName: `Shop ${id}`, status, error: status === 'failed' ? 'no-answer' : null, extracted })

describe('rankResults', () => {
  it('puts availability first: ready sooner and able to hold beats a few rupees cheaper', () => {
    expect(WEIGHTS).toEqual({ stock: 50, ready: 20, hold: 15, price: 15 })
    const r = rankResults(req, [row('cheap-later', x({ total_price_inr: 520, ready_in_minutes: 60 })), row('ready-holds', x({ total_price_inr: 560, ready_in_minutes: 0, can_hold: 'yes' }))])
    expect(r[0].id).toBe('ready-holds')
    expect(r[0].explanation).toBe('Has all 2 packets · ready now · can hold it · ₹560 total (₹280 each)')
    expect(winnerReason(r)).toMatch(/^Ready soonest of 2 shops with the full quantity; shop says it can hold the item/)
    expect(stockOf(x({ qty_available: 1 }), 2)).toBe('short')
    expect(stockOf(x({ in_stock: 'unsure' }), 2)).toBe('unknown')
  })

  it('knows when a shop has it all and will hold it (final or live answer), and labels calls skipped for that', () => {
    expect(hasAndHolds(x({ can_hold: 'yes' }), 2)).toBe(true)
    expect(hasAndHolds({ in_stock: 'yes', can_hold: 'yes' }, 2)).toBe(true) // heard live, quantity not stated
    expect(hasAndHolds({ in_stock: 'yes', qty_available: 1, can_hold: 'yes' }, 2)).toBe(false)
    expect(hasAndHolds({ in_stock: 'yes', can_hold: 'unknown' }, 2)).toBe(false)
    expect(hasAndHolds(null, 2)).toBe(false)
    const r = rankResults(req, [{ id: 's', shopName: 'S', status: 'failed', error: 'not needed: already found at Sharma Kirana', extracted: null }])
    expect(r[0]).toMatchObject({ skipped: true, explanation: 'Not called: already found at Sharma Kirana' })
  })

  it('takes the unit price from a stated total, not a per-unit figure that disagrees with it', () => {
    const r = rankResults(req, [row('a', x({ unit_price_inr: 270, total_price_inr: 500 })), row('b', x({ unit_price_inr: 260 }))])
    expect(r.map((y) => [y.id, y.total, y.unit])).toEqual([['a', 500, 250], ['b', 520, 260]])
  })

  it('prefers the cheapest shop that has the full quantity', () => {
    const r = rankResults(req, [row('a', x({ unit_price_inr: 300 })), row('b', x({ total_price_inr: 560 })), row('c', x({ unit_price_inr: 260 }))])
    expect(r[0].id).toBe('c')
    expect(r[0].winner).toBe(true)
    expect(r[0].total).toBe(520)
    expect(r.find((y) => y.id === 'b')!.unit).toBe(280) // total ÷ quantity when only a total was quoted
    expect(winnerReason(r)).toMatch(/^Lowest verified total of 3 priced quotes/)
    expect(winnerReason(r)).toMatch(/reservation not confirmed\.$/)
    expect(winnerReason(r, 'confirmed')).toMatch(/confirmed the reservation on a separate call\.$/)
    expect(r.filter((y) => y.winner)).toHaveLength(1)
  })

  it('never treats a missing price as zero or as the cheapest', () => {
    const r = rankResults(req, [row('a', x({ unit_price_inr: 300 })), row('b', x({ unit_price_inr: null }))])
    const b = r.find((y) => y.id === 'b')!
    expect(b.unit).toBeNull()
    expect(b.total).toBeNull()
    expect(b.factors.price).toBe(0)
    expect(b.flags).toContain('Price not quoted')
    expect(r[0].id).toBe('a')
    expect(winnerReason(r)).toContain('1 shop did not quote a comparable price')
    expect(winnerReason(r)).not.toMatch(/lowest/i) // only one priced quote: cannot claim "lowest"
  })

  it('excludes shops that cannot supply the full quantity from winning', () => {
    const r = rankResults(req, [row('a', x({ unit_price_inr: 100, qty_available: 1 })), row('b', x({ in_stock: 'partial', unit_price_inr: 90 }))])
    expect(r.every((y) => !y.eligible && !y.winner)).toBe(true)
    expect(r[0].stock).toBe('short')
    expect(r[0].total).toBeNull() // a total for a quantity the shop cannot supply is not calculable
  })

  it('reduces the score of low-confidence answers', () => {
    const r = rankResults(req, [row('a', x({ unit_price_inr: 300, confidence: 'low' })), row('b', x({ unit_price_inr: 300, confidence: 'high' }))])
    expect(r[0].id).toBe('b')
    expect(r[1].score).toBeLessThan(r[0].score)
    expect(r[1].flags).toContain('Low-confidence answer')
  })

  it('does not compare prices quoted for a different unit', () => {
    const r = rankResults(req, [row('a', x({ unit_price_inr: 50, price_unit: 'kg' })), row('b', x({ unit_price_inr: 300, price_unit: 'packets' }))])
    const a = r.find((y) => y.id === 'a')!
    expect(a.comparable).toBe(false)
    expect(a.unit).toBeNull()
    expect(r[0].id).toBe('b')
  })

  it('never multiplies a per-unit price whose unit was not stated', () => {
    const r = rankResults({ ...req, quantity: 500, unit: 'g' }, [row('a', x({ unit_price_inr: 120, price_unit: null }))])
    expect(r[0].total).toBeNull() // not "₹60,000 total"
    expect(r[0].unit).toBeNull()
    expect(r[0].factors.price).toBe(0)
    expect(r[0].flags).toContain('Price unit not stated: not compared')
    expect(r[0].explanation).toContain('₹120 (unit not stated)')
    // A quoted total for the requested quantity is used as given, even without a unit.
    expect(rankResults(req, [row('b', x({ total_price_inr: 540, price_unit: null }))])[0].total).toBe(540)
  })

  it('does not let an unknown price or readiness pass a budget or deadline', () => {
    const r = rankResults({ ...req, max_budget_inr: 500, need_within_minutes: 30 }, [row('a', x({ ready_in_minutes: null })), row('b', x({ unit_price_inr: 260, ready_in_minutes: 10 }))])
    const a = r.find((y) => y.id === 'a')!
    expect(a.eligible).toBe(false)
    expect(a.flags).toEqual(expect.arrayContaining(['Price not confirmed against your budget', 'Readiness not confirmed against your deadline']))
    expect(r.find((y) => y.id === 'b')!.eligible).toBe(false) // ₹520 is over the ₹500 budget
    expect(winnerReason(r)).toBeNull()
    const one = rankResults(req, [row('c', x({ unit_price_inr: 100 }))])
    expect(winnerReason(one)).toMatch(/^Only shop that confirmed everything you asked for/)
  })

  it('applies budget and deadline limits', () => {
    const r = rankResults({ ...req, max_budget_inr: 500, need_within_minutes: 30 }, [
      row('cheap-late', x({ unit_price_inr: 100, ready_in_minutes: 60 })),
      row('over', x({ unit_price_inr: 400 })),
      row('ok', x({ unit_price_inr: 240 })),
    ])
    expect(r[0].id).toBe('ok')
    expect(r.find((y) => y.id === 'over')!.flags).toContain('Over your ₹500 budget')
    expect(r.find((y) => y.id === 'cheap-late')!.eligible).toBe(false)
  })

  it('gives failed calls no score and no winner when nothing qualifies', () => {
    const r = rankResults(req, [row('a', null, 'failed'), row('b', x({ in_stock: 'no' }))])
    expect(r.map((y) => y.score)).toEqual([0, 0])
    expect(r.some((y) => y.winner)).toBe(false)
    expect(r.find((y) => y.id === 'a')!.flags[0]).toBe('Call failed: no-answer')
    expect(winnerReason(r)).toBeNull()
  })

  it('is deterministic regardless of input order, breaking ties by price, readiness and name', () => {
    const rows = [row('z', x({ unit_price_inr: 300, ready_in_minutes: 10 })), row('y', x({ unit_price_inr: 300, ready_in_minutes: 10 })), row('w', x({ unit_price_inr: 300, ready_in_minutes: 10 }))]
    const a = rankResults(req, rows).map((y) => y.id)
    const b = rankResults(req, [...rows].reverse()).map((y) => y.id)
    expect(a).toEqual(b)
    expect(a).toEqual(['w', 'y', 'z'])
  })
})
