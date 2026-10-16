import Link from 'next/link'
import { Suspense } from 'react'
import Labeler from '@/components/Labeler'
import { metricsRows } from '@/lib/engine'
import { centsToInr, computeMetrics, MIN_SAMPLE } from '@/lib/metrics'
import { inr } from '@/lib/rank'

const MODES = ['live', 'simulated', 'replay'] as const
const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`)
const rupees = (cents: number | null) => (cents === null ? '—' : `≈ ${inr(centsToInr(cents))}`)
const usc = (cents: number | null) => (cents === null ? '—' : `${Math.round(cents * 10) / 10}¢`)

export default function MetricsPage({ searchParams }: PageProps<'/metrics'>) {
  return (
    <div className="space-y-8">
      <header>
        <p className="text-sm font-semibold uppercase tracking-widest text-muted">Evidence, not adjectives</p>
        <h1 className="mt-1 font-display text-5xl">Metrics</h1>
        <p className="mt-2 max-w-3xl text-lg text-muted">Computed from stored call records only. Sample sizes are shown next to every number; small samples are flagged, not dressed up.</p>
      </header>
      <Suspense fallback={<p className="text-muted">Loading metrics…</p>}>
        <Metrics searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function Metrics({ searchParams }: { searchParams: PageProps<'/metrics'>['searchParams'] }) {
  const sp = await searchParams
  const mode = MODES.find((m) => m === sp.mode) ?? 'live'
  let m: ReturnType<typeof computeMetrics>
  try {
    m = computeMetrics(await metricsRows(mode))
  } catch {
    return <p className="rounded-xl bg-chili-soft p-4 text-chili">Could not load metrics. Check the Supabase settings.</p>
  }
  const thin = (n: number) => n < MIN_SAMPLE
  const stats: [string, string, string, number][] = [
    ['Calls initiated', String(m.initiated), 'quote calls actually dialled', m.initiated],
    ['Answer rate', pct(m.answerRate), `${m.answered} answered / ${m.initiated} initiated`, m.initiated],
    ['Failure rate', pct(m.failureRate), `${m.failed} failed or timed out / ${m.initiated}`, m.initiated],
    ['Median time to first usable quote', m.medianFirstQuoteSec === null ? '—' : `${Math.round(m.medianFirstQuoteSec)} s`, `from dialling; n = ${m.firstQuoteN}`, m.firstQuoteN],
    ['Extraction accuracy', pct(m.accuracy), `${m.labelsN} labelled fields across ${m.labelledCalls} calls`, m.labelsN],
    ['Calls completed', String(m.completed), 'reached a final answer', m.initiated],
  ]
  // What Bolna charged (US cents, shown in rupees). Only real calls cost anything.
  if (mode === 'live')
    stats.push(
      ['Cost per answered call', rupees(m.costPerAnsweredCents), `${usc(m.costPerAnsweredCents)} US: quote-call charges / ${m.answered} answered`, m.answered],
      ['Cost per successful search', rupees(m.costPerFoundCents), `${usc(m.costPerFoundCents)} US: all ${usc(m.spentCents)} charged / ${m.found} of ${m.searches} searches where a shop had it all`, m.found],
    )
  return (
    <>
      <nav className="flex gap-2" aria-label="Mode">
        {MODES.map((x) => (
          <Link key={x} href={`/metrics?mode=${x}`} className={`rounded-full border px-4 py-2 font-semibold capitalize ${x === mode ? 'border-ink bg-ink text-paper' : 'border-line bg-card'}`} aria-current={x === mode ? 'page' : undefined}>
            {x}
          </Link>
        ))}
      </nav>
      {mode !== 'live' && (
        <p className="hatch rounded-xl border-2 border-marigold bg-marigold-soft px-4 py-3 font-semibold text-marigold-deep">
          {mode === 'simulated' ? 'SIMULATED' : 'REPLAY'} data exercises the pipeline. It is not real-world performance.
        </p>
      )}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Headline metrics">
        {stats.map(([title, value, note, n]) => (
          <div key={title} className="rounded-2xl border border-line bg-card p-5">
            <p className="text-sm font-semibold text-muted">{title}</p>
            <p className="mt-1 font-display text-5xl tabular">{value}</p>
            <p className="mt-1 text-sm text-muted">{note}</p>
            {thin(n) && <p className="mt-2 inline-block rounded-full bg-marigold-soft px-2.5 py-0.5 text-xs font-semibold text-marigold-deep">Insufficient data (n = {n}, need {MIN_SAMPLE}+)</p>}
          </div>
        ))}
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <Table title="By language" head={['Language', 'Calls', 'Answered', 'Completed']} rows={m.byLanguage.map((l) => [l.language === 'hi' ? 'Hindi' : l.language === 'en' ? 'English' : l.language, l.n, `${l.answered} (${pct(l.answered / l.n)})`, l.completed])} empty="No calls yet." />
        <Table title="Extraction accuracy by field" head={['Field', 'Labelled', 'Correct', 'Accuracy']} rows={m.byField.map((f) => [f.field, f.n, f.correct, pct(f.correct / f.n)])} empty="No labels yet. Label calls below." />
      </section>
      <details className="rounded-2xl border border-line bg-card p-5 text-muted">
        <summary className="cursor-pointer font-semibold text-ink">Definitions</summary>
        <ul className="mt-3 list-disc space-y-1 pl-5">
          <li>Only quote calls count; reservation calls are excluded. A call counts as initiated once it is dialled.</li>
          <li>Answered: the call reached a conversation or a final answer. Failed: no answer, busy, voicemail, provider error, not placed, or no result in time.</li>
          <li>First usable quote: availability known plus a price, or a clear &quot;not in stock&quot;. Time is measured from dialling to when that answer was stored.</li>
          <li>Extraction accuracy: share of manually labelled fields marked correct. Unlabelled calls are not counted either way.</li>
          <li>
            Cost (LIVE only): what Bolna charged per call (its <code>total_cost</code>, in US cents, which matched the wallet deduction), shown in rupees at ₹92 per dollar. Per answered call:
            quote-call charges, unanswered calls included, over answered calls. Per successful search: everything charged, reservation calls included, over searches in which a shop
            confirmed the full quantity.
          </li>
        </ul>
      </details>
      <Labeler mode={mode} />
    </>
  )
}

function Table({ title, head, rows, empty }: { title: string; head: string[]; rows: (string | number)[][]; empty: string }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-card">
      <table className="w-full text-left">
        <caption className="px-5 py-3 text-left font-display text-2xl">{title}</caption>
        <thead className="text-xs uppercase tracking-wider text-muted">
          <tr className="border-y border-rule">
            {head.map((h) => (
              <th key={h} scope="col" className="px-5 py-2">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular">
          {rows.length ? (
            rows.map((r, i) => (
              <tr key={i} className="border-b border-rule last:border-0">
                {r.map((c, j) => (
                  <td key={j} className="px-5 py-2.5">
                    {c}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={head.length} className="px-5 py-4 text-muted">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
