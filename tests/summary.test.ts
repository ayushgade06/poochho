import { describe, expect, it } from 'vitest'
import { rankResults } from '@/lib/rank'
import { holdOutcome, shareText, summarize, timeSaved } from '@/lib/summary'
import type { Extraction } from '@/lib/types'

const req = { product: 'Amul Butter', quantity: 2, unit: 'packet', area: 'Kothrud', max_budget_inr: null, need_within_minutes: null }
const x = (o: Partial<Extraction>): Extraction => ({
  in_stock: 'yes', unit_price_inr: null, total_price_inr: null, price_unit: null, qty_available: null, brand_or_variant: null,
  pickup_or_delivery: 'pickup', ready_in_minutes: 10, can_hold: 'yes', opt_out: 'no', confidence: 'high', notes: null, ...o,
})
const ranked = rankResults(req, [
  { id: 'a', shopName: 'Sharma Kirana', status: 'done', error: null, extracted: x({ total_price_inr: 540 }) },
  { id: 'b', shopName: 'New Bharat', status: 'failed', error: 'no-answer', extracted: null },
])

describe('summarize', () => {
  it('speaks only verified numbers, in English and Hindi', () => {
    expect(summarize(req, ranked, 'en')).toBe('I called 2 shops. 1 answered and 1 has Amul Butter. Best option: Sharma Kirana, 540 rupees for 2 packets, ready in about 10 minutes. 1 shop could not be reached.')
    const hi = summarize(req, ranked, 'hi', { shopName: 'Sharma Kirana', outcome: 'confirmed' })
    expect(hi).toContain('मैंने 2 दुकानों पर call किया।')
    expect(hi).toContain('1 दुकान से बात नहीं हो पाई।') // singular
    expect(hi).toContain('Sharma Kirana ने आपके लिए सामान रखने की पुष्टि की है।')
  })

  it('says so when nobody can fully help', () => {
    const none = rankResults(req, [{ id: 'a', shopName: 'A', status: 'done', error: null, extracted: x({ in_stock: 'no' }) }])
    expect(summarize(req, none, 'en')).toContain('No shop confirmed all 2 packets.')
  })
})

describe('holdOutcome and shareText', () => {
  it('confirms a reservation only on an explicit yes from the hold call', () => {
    expect(holdOutcome({ status: 'done', extracted: x({ can_hold: 'yes' }) })).toBe('confirmed')
    expect(holdOutcome({ status: 'done', extracted: x({ can_hold: 'unknown' }) })).toBe('unknown')
    expect(holdOutcome({ status: 'done', extracted: x({ can_hold: 'no' }) })).toBe('declined')
    expect(holdOutcome({ status: 'talking', extracted: null })).toBe('pending')
    expect(holdOutcome({ status: 'timeout', extracted: null })).toBe('failed')
  })

  it('labels simulated results and never includes phone numbers', () => {
    const w = ranked.find((r) => r.winner)!
    expect(shareText({ ...req, mode: 'simulated' }, w, false)).toMatch(/^\[SIMULATED DEMO, not a real shop\] Poochho found Amul Butter at Sharma Kirana: ₹540 for 2 packets/)
    expect(shareText({ ...req, mode: 'live' }, w, true)).toMatch(/^Poochho found .* The shop confirmed it will hold it\./)
    expect(shareText({ ...req, mode: 'live' }, w, true)).not.toMatch(/\+91|\d{10}/)
  })
})

describe('timeSaved', () => {
  const c = (d: string, e: string | null, kind: 'quote' | 'hold' = 'quote') => ({ kind, dispatched_at: `2026-10-16T10:00:${d}Z`, ended_at: e && `2026-10-16T10:${e}Z` })
  it('compares the measured parallel time with calling one by one', () => {
    expect(timeSaved([c('00', '00:40'), c('01', '00:51'), c('02', '00:32'), c('00', '05:00', 'hold')])).toEqual({ calls: 3, parallelSec: 51, sequentialSec: 120 })
  })
  it('waits until every quote call has ended', () => {
    expect(timeSaved([c('00', '00:40'), c('01', null)])).toBeNull()
    expect(timeSaved([])).toBeNull()
  })
})
