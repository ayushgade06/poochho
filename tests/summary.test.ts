import { describe, expect, it } from 'vitest'
import { rankResults } from '@/lib/rank'
import { ago, holdOutcome, istTime, shareText, summarize, timeSaved } from '@/lib/summary'
import type { Extraction } from '@/lib/types'

const req = { product: 'Amul Butter', quantity: 2, unit: 'packet', area: 'Kothrud', max_budget_inr: null, need_within_minutes: null }
const x = (o: Partial<Extraction>): Extraction => ({
  in_stock: 'yes', unit_price_inr: null, total_price_inr: null, price_unit: null, qty_available: null, brand_or_variant: null,
  pickup_or_delivery: 'pickup', ready_in_minutes: 10, can_hold: 'yes', opt_out: 'no', confidence: 'high', notes: null, stock_quote: null, ...o,
})
const ranked = rankResults(req, [
  { id: 'a', shopName: 'Sharma Kirana', status: 'done', error: null, extracted: x({ total_price_inr: 540 }) },
  { id: 'b', shopName: 'New Bharat', status: 'failed', error: 'no-answer', extracted: null },
])

describe('summarize', () => {
  it('speaks only verified numbers, availability first, in English and Hindi', () => {
    expect(summarize(req, ranked, 'en')).toBe('I called 2 shops. 1 answered and 1 has Amul Butter. Best option: Sharma Kirana has all 2 packets, ready in about 10 minutes, and says it can keep it for you. Price: 540 rupees in total. 1 shop could not be reached.')
    const hi = summarize(req, ranked, 'hi', { shopName: 'Sharma Kirana', outcome: 'confirmed' })
    expect(hi).toContain('मैंने 2 दुकानों पर call किया।')
    expect(hi).toContain('सबसे अच्छा विकल्प: Sharma Kirana, उनके पास पूरे 2 packet हैं, लगभग 10 मिनट में तैयार। कुल कीमत 540 रुपये।') // the hold call's answer replaces "can hold"
    expect(hi).toContain('1 दुकान से बात नहीं हो पाई।') // singular
    expect(hi).toContain('Sharma Kirana ने आपके लिए सामान रखने की पुष्टि की है।')
    const now = rankResults(req, [{ id: 'a', shopName: 'A', status: 'done', error: null, extracted: x({ ready_in_minutes: 0, can_hold: 'no' }) }])
    expect(summarize(req, now, 'en')).toContain('Best option: A has all 2 packets, ready now. Price not quoted.')
  })

  it('says how many shops were not called because it was already found', () => {
    const r = rankResults(req, [
      { id: 'a', shopName: 'Sharma Kirana', status: 'done', error: null, extracted: x({ total_price_inr: 540 }) },
      { id: 'b', shopName: 'Gupta', status: 'failed', error: 'not needed: already found at Sharma Kirana', extracted: null },
    ])
    expect(summarize(req, r, 'en')).toBe('I called 1 shop. 1 answered and 1 has Amul Butter. Best option: Sharma Kirana has all 2 packets, ready in about 10 minutes, and says it can keep it for you. Price: 540 rupees in total. It was already found, so 1 more shop was not called.')
    expect(summarize(req, r, 'hi')).toContain('सामान मिल गया था, इसलिए 1 और दुकान को call नहीं किया।')
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

  it('labels simulated results, says when the shop answered, and never includes phone numbers', () => {
    const w = ranked.find((r) => r.winner)!
    const at = '2026-10-16T08:35:00.000Z' // 14:05 IST
    expect(shareText({ ...req, mode: 'simulated' }, w, false, at)).toBe(
      '[SIMULATED DEMO, not a real shop] Poochho found Amul Butter at Sharma Kirana: Has all 2 packets · ready in ~10 min · can hold it · ₹540 total (₹270 each). (Quoted by phone as of 14:05 IST; please confirm at the shop.)',
    )
    expect(shareText({ ...req, mode: 'live' }, w, true, at)).toMatch(/^Poochho found .* The shop confirmed it will hold it\. \(Quoted by phone as of 14:05 IST/)
    expect(shareText({ ...req, mode: 'live' }, w, true, at)).not.toMatch(/\+91|\d{10}/)
    expect(shareText({ ...req, mode: 'replay' }, w, false, at)).not.toContain('as of') // a replay's clock is the playback's
  })

  it('formats freshness and India time', () => {
    const t = Date.parse('2026-10-16T08:35:00.000Z')
    expect([0, 30_000, 6 * 60_000, 3 * 3_600_000, 2 * 86_400_000].map((d) => ago('2026-10-16T08:35:00.000Z', t + d))).toEqual(['just now', 'just now', '6 min ago', '3 h ago', 'on 16 Oct'])
    expect(istTime('2026-10-16T18:40:00.000Z')).toBe('00:10')
  })
})

describe('timeSaved', () => {
  const c = (d: string, e: string | null, kind: 'quote' | 'hold' = 'quote') => ({ kind, dispatched_at: `2026-10-16T10:00:${d}Z`, ended_at: e && `2026-10-16T10:${e}Z`, error: null })
  it('compares the measured parallel time with calling one by one', () => {
    expect(timeSaved([c('00', '00:40'), c('01', '00:51'), c('02', '00:32'), c('00', '05:00', 'hold')])).toEqual({ calls: 3, parallelSec: 51, sequentialSec: 120 })
  })
  it('waits until every quote call has ended, ignoring calls that were never dialled', () => {
    expect(timeSaved([c('00', '00:40'), c('01', null)])).toBeNull()
    expect(timeSaved([])).toBeNull()
    expect(timeSaved([c('00', '00:40'), c('01', '00:51'), { kind: 'quote', dispatched_at: null, ended_at: '2026-10-16T10:00:52Z', error: 'not needed: already found at A' }])).toEqual({ calls: 2, parallelSec: 51, sequentialSec: 90 })
  })
})
