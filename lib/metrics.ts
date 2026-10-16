import { stockOf } from './rank'
import { notNeeded } from './state'
import type { CallKind, CallStatus, Extraction } from './types'

export type MetricRow = {
  id: string
  request_id: string
  mode: string
  kind: CallKind
  status: CallStatus
  language: string
  product: string
  shop: string
  provider_status: string | null
  error: string | null
  dispatched_at: string | null
  answered_at: string | null
  ended_at: string | null
  first_quote_at: string | null
  duration_seconds: number | null
  cost_cents: number | null
  quantity: number
  extracted: Extraction | null
  labels: { field: string; is_correct: boolean }[]
}

// Bolna bills in US cents. Shown in rupees at the rate Bolna's own pricing page uses (6.00¢ = ₹5.52, Oct 2026).
export const INR_PER_USD = 92
export const centsToInr = (cents: number) => Math.round(cents * INR_PER_USD) / 100

export const MIN_SAMPLE = 10 // below this, metrics are shown with an "insufficient data" warning
export const LABEL_FIELDS = ['in_stock', 'unit_price_inr', 'total_price_inr', 'qty_available', 'ready_in_minutes', 'can_hold', 'brand_or_variant'] as const

const ratio = (a: number, b: number) => (b ? a / b : null)
function median(xs: number[]) {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
function groupCount<T>(xs: T[], key: (x: T) => string) {
  const m = new Map<string, T[]>()
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x])
  return m
}

// Definitions (quote calls only): initiated = dialled (dispatched); answered = reached a conversation or a
// final "done"; failed = failed or timed out; first usable quote = availability known plus a price, or a
// clear "not in stock"; accuracy = correct labels / all labels. Cost: quote-call spend per answered call, and
// all spend (reservation calls too) per search in which a shop confirmed the full quantity.
export function computeMetrics(all: MetricRow[]) {
  const rows = all.filter((r) => r.kind === 'quote')
  const calls = rows.filter((r) => r.dispatched_at && !notNeeded(r.error)) // a call skipped once the item was found was never dialled
  const answered = calls.filter((r) => r.answered_at || r.status === 'done')
  const failed = calls.filter((r) => r.status === 'failed' || r.status === 'timeout')
  const firstQuote = calls.filter((r) => r.first_quote_at).map((r) => (Date.parse(r.first_quote_at!) - Date.parse(r.dispatched_at!)) / 1000)
  const labels = rows.flatMap((r) => r.labels)
  const spend = (rs: MetricRow[]) => (rs.some((r) => r.cost_cents !== null) ? rs.reduce((sum, r) => sum + (r.cost_cents ?? 0), 0) : null)
  const found = new Set(calls.filter((r) => r.status === 'done' && stockOf(r.extracted, r.quantity) === 'full').map((r) => r.request_id))
  const quoteSpend = spend(calls)
  const allSpend = spend(all)
  return {
    initiated: calls.length,
    answered: answered.length,
    completed: calls.filter((r) => r.status === 'done').length,
    failed: failed.length,
    answerRate: ratio(answered.length, calls.length),
    failureRate: ratio(failed.length, calls.length),
    medianFirstQuoteSec: median(firstQuote),
    firstQuoteN: firstQuote.length,
    accuracy: ratio(labels.filter((l) => l.is_correct).length, labels.length),
    labelsN: labels.length,
    labelledCalls: rows.filter((r) => r.labels.length).length,
    byField: [...groupCount(labels, (l) => l.field)].map(([field, ls]) => ({ field, n: ls.length, correct: ls.filter((l) => l.is_correct).length })),
    spentCents: allSpend,
    costPerAnsweredCents: quoteSpend === null ? null : ratio(quoteSpend, answered.length),
    costPerFoundCents: allSpend === null ? null : ratio(allSpend, found.size),
    searches: new Set(calls.map((r) => r.request_id)).size,
    found: found.size,
    byLanguage: [...groupCount(calls, (r) => r.language)].map(([language, rs]) => ({
      language,
      n: rs.length,
      answered: rs.filter((r) => r.answered_at || r.status === 'done').length,
      completed: rs.filter((r) => r.status === 'done').length,
    })),
  }
}

const COLS = ['execution_id', 'request_id', 'mode', 'kind', 'language', 'product', 'shop', 'status', 'provider_status', 'error', 'dispatched_at', 'answered_at', 'ended_at', 'first_quote_at', 'duration_seconds', 'cost_cents', 'in_stock', 'unit_price_inr', 'total_price_inr', 'qty_available', 'ready_in_minutes', 'can_hold', 'confidence', 'labels_correct', 'labels_total']

// RFC 4180 CSV. No transcripts or phone numbers. Cells that a spreadsheet would execute are neutralised.
export function toCsv(rows: MetricRow[]) {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? '' : String(v)
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const line = (r: MetricRow) =>
    [
      r.id, r.request_id, r.mode, r.kind, r.language, r.product, r.shop, r.status, r.provider_status, r.error, r.dispatched_at, r.answered_at, r.ended_at, r.first_quote_at, r.duration_seconds, r.cost_cents,
      r.extracted?.in_stock, r.extracted?.unit_price_inr, r.extracted?.total_price_inr, r.extracted?.qty_available, r.extracted?.ready_in_minutes, r.extracted?.can_hold, r.extracted?.confidence,
      r.labels.filter((l) => l.is_correct).length, r.labels.length,
    ].map(cell).join(',')
  return [COLS.join(','), ...rows.map(line)].join('\r\n') + '\r\n'
}
