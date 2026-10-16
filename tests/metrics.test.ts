import { describe, expect, it } from 'vitest'
import { centsToInr, computeMetrics, toCsv, type MetricRow } from '@/lib/metrics'

const T0 = '2026-10-16T10:00:00.000Z'
const at = (s: number) => new Date(Date.parse(T0) + s * 1000).toISOString()
const row = (o: Partial<MetricRow>): MetricRow => ({
  id: 'e1', request_id: 'r1', mode: 'live', kind: 'quote', status: 'done', language: 'hi', product: 'Butter', shop: 'Shop', provider_status: 'completed', error: null,
  dispatched_at: T0, answered_at: at(5), ended_at: at(40), first_quote_at: at(45), duration_seconds: 35, cost_cents: null, quantity: 2, extracted: null, labels: [], ...o,
})
const has = (in_stock: 'yes' | 'no', qty_available: number | null = null) => ({
  in_stock, unit_price_inr: null, total_price_inr: 540, price_unit: null, qty_available, brand_or_variant: null, pickup_or_delivery: 'pickup' as const,
  ready_in_minutes: 10, can_hold: 'yes' as const, opt_out: 'no' as const, confidence: 'high' as const, notes: null, stock_quote: null,
})

describe('computeMetrics', () => {
  it('uses explicit denominators and the median time to first usable quote', () => {
    const m = computeMetrics([
      row({ id: 'a', first_quote_at: at(40) }),
      row({ id: 'b', first_quote_at: at(60) }),
      row({ id: 'c', status: 'failed', answered_at: null, first_quote_at: null, error: 'no-answer' }),
      row({ id: 'd', status: 'timeout', answered_at: null, first_quote_at: null }),
      row({ id: 'e', status: 'queued', dispatched_at: null, answered_at: null, first_quote_at: null }), // never dialled: excluded
      row({ id: 'f', status: 'failed', answered_at: null, first_quote_at: null, error: 'not needed: already found at A' }), // claimed, then skipped: excluded
    ])
    expect(m).toMatchObject({ initiated: 4, answered: 2, completed: 2, failed: 2, answerRate: 0.5, failureRate: 0.5, medianFirstQuoteSec: 50, firstQuoteN: 2 })
    expect(m.byLanguage).toEqual([{ language: 'hi', n: 4, answered: 2, completed: 2 }])
  })

  it('computes extraction accuracy from manual labels only', () => {
    const m = computeMetrics([
      row({ id: 'a', labels: [{ field: 'in_stock', is_correct: true }, { field: 'unit_price_inr', is_correct: false }] }),
      row({ id: 'b', labels: [{ field: 'in_stock', is_correct: true }] }),
      row({ id: 'c' }),
    ])
    expect(m.accuracy).toBeCloseTo(2 / 3)
    expect(m).toMatchObject({ labelsN: 3, labelledCalls: 2 })
    expect(m.byField).toEqual([{ field: 'in_stock', n: 2, correct: 2 }, { field: 'unit_price_inr', n: 1, correct: 0 }])
  })

  it('reports no rates instead of zeros when there is no data', () => {
    expect(computeMetrics([])).toMatchObject({ initiated: 0, answerRate: null, failureRate: null, medianFirstQuoteSec: null, accuracy: null, spentCents: null, costPerAnsweredCents: null, costPerFoundCents: null })
  })

  it('costs answered calls with quote spend, and successful searches with all spend', () => {
    const m = computeMetrics([
      row({ id: 'a', request_id: 'r1', cost_cents: 9, extracted: has('yes') }), // found the full quantity
      row({ id: 'b', request_id: 'r1', cost_cents: 1, status: 'failed', answered_at: null }), // unanswered calls still cost
      row({ id: 'h', request_id: 'r1', kind: 'hold', cost_cents: 6 }), // a reservation call: spend, not a quote
      row({ id: 'c', request_id: 'r2', cost_cents: 8, extracted: has('yes', 1) }), // only 1 of 2: not a success
    ])
    expect(m).toMatchObject({ initiated: 3, answered: 2, spentCents: 24, costPerAnsweredCents: 9, costPerFoundCents: 24, searches: 2, found: 1 })
    expect(centsToInr(24)).toBe(22.08) // at ₹92 per US dollar
  })
})

describe('toCsv', () => {
  it('escapes quotes, commas and newlines and neutralises spreadsheet formulas', () => {
    const csv = toCsv([row({ shop: 'Gupta, "Best" Stores', product: '=HYPERLINK("x")', error: 'line1\nline2', cost_cents: 9 })])
    const [head, line] = csv.split('\r\n')
    expect(head.split(',')[0]).toBe('execution_id')
    expect(line).toContain(',9,') // cost_cents
    expect(line).toContain('"Gupta, ""Best"" Stores"')
    expect(line).toContain(`"'=HYPERLINK(""x"")"`)
    expect(line).toContain('"line1\nline2"')
    expect(csv.endsWith('\r\n')).toBe(true)
  })
})
