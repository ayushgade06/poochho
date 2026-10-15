'use client'

import { useState } from 'react'
import { CONFIDENCE, inr, WEIGHTS, winnerReason, type Ranked } from '@/lib/rank'
import { holdOutcome, shareText, summarize, type HoldOutcome } from '@/lib/summary'
import type { PublicExecution, SearchState } from '@/lib/types'
import { speakText, token } from './ui'

const OUTCOME: Record<HoldOutcome, [string, string]> = {
  confirmed: ['Reservation confirmed by the shop', 'text-kirana'],
  declined: ['Shop declined to hold it', 'text-chili'],
  pending: ['Confirmation pending: calling the shop…', 'text-indigo'],
  failed: ['Reservation call failed', 'text-chili'],
  unknown: ['Outcome unknown: the shop did not clearly agree', 'text-marigold-deep'],
}

export default function Results({ data, ranked, holds, finished }: { data: SearchState; ranked: Ranked[]; holds: PublicExecution[]; finished: boolean }) {
  const req = data.request
  const winner = ranked.find((r) => r.winner)
  const byId = new Map(data.executions.map((e) => [e.id, e]))
  const holdFor = (r: Ranked) => holds.find((h) => h.shop_id === byId.get(r.id)?.shop_id)
  const winnerHold = winner && holdFor(winner)
  const hold = winnerHold ? { shopName: winner!.shopName, outcome: holdOutcome(winnerHold) } : null
  const summary = summarize(req, ranked, req.language, hold)

  return (
    <section className="space-y-6" aria-labelledby="results">
      <h2 id="results" className="font-display text-3xl">
        {finished ? 'Results' : 'Results so far'}
      </h2>

      {winner ? (
        <WinnerCard data={data} r={winner} hold={winnerHold} why={winnerReason(ranked, hold?.outcome ?? null)} />
      ) : (
        finished && (
          <div className="rounded-2xl border-2 border-dashed border-line bg-card p-6">
            <p className="font-display text-2xl">
              No shop confirmed all {req.quantity} {req.unit}
              {(req.max_budget_inr || req.need_within_minutes) && ' within your limits'}.
            </p>
            <p className="mt-1 text-muted">See the ledger below for partial stock and unconfirmed answers. Nothing here is guessed.</p>
          </div>
        )
      )}

      <Ledger data={data} ranked={ranked} holdFor={holdFor} />

      <div className="flex flex-col gap-4 rounded-2xl border border-line bg-card p-5 sm:flex-row sm:items-center">
        <p className="flex-1 text-lg leading-relaxed" lang={req.language}>
          {summary}
        </p>
        <SpeakButton text={summary} lang={req.language} />
      </div>
    </section>
  )
}

function WinnerCard({ data, r, hold, why }: { data: SearchState; r: Ranked; hold?: PublicExecution; why: string | null }) {
  const req = data.request
  const outcome = hold && holdOutcome(hold)
  const reserved = outcome === 'confirmed'
  return (
    <article className="rise relative overflow-hidden rounded-2xl border-2 border-kirana bg-kirana-soft/60 p-6 sm:p-8" aria-label="Best match">
      <div className="stamp pointer-events-none absolute right-5 top-5 rounded-md border-[3px] border-double border-chili px-3 py-1 text-center font-display text-xl uppercase leading-tight text-chili sm:right-8 sm:top-7 sm:text-2xl" aria-hidden>
        Best match
        <span className="block font-sans text-base font-bold normal-case" lang="hi">
          सबसे अच्छा
        </span>
      </div>
      <p className="text-sm font-semibold uppercase tracking-widest text-kirana">Best match</p>
      <h3 className="mt-1 pr-36 font-display text-4xl leading-tight sm:text-5xl">{r.shopName}</h3>
      <p className="mt-2 text-3xl font-semibold tabular">
        {r.total !== null ? `${inr(r.total)} for ${req.quantity} ${req.unit}` : 'Price not quoted'}
        {r.ready !== null && <span className="text-xl font-normal text-muted"> · ready {r.ready === 0 ? 'now' : `in ~${r.ready} min`}</span>}
      </p>
      <p className="mt-3 text-lg">{r.explanation}.</p>
      {why && <p className="mt-1 text-muted">Why: {why}</p>}
      {outcome && <p className={`mt-3 text-lg font-semibold ${OUTCOME[outcome][1]}`}>{OUTCOME[outcome][0]}</p>}
      <div className="mt-6 flex flex-wrap gap-3">
        {!hold && <HoldButton data={data} executionId={r.id} shopName={r.shopName} />}
        <a
          className="inline-flex items-center gap-2 rounded-xl bg-[#1f7a43] px-5 py-3 font-semibold text-white"
          href={`https://wa.me/?text=${encodeURIComponent(shareText(req, r, reserved))}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Share on WhatsApp
        </a>
      </div>
    </article>
  )
}

function HoldButton({ data, executionId, shopName }: { data: SearchState; executionId: string; shopName: string }) {
  const [stage, setStage] = useState<'idle' | 'confirm' | 'sending' | 'sent'>('idle')
  const [err, setErr] = useState<string | null>(null)
  const live = data.request.mode === 'live'
  async function send() {
    setStage('sending')
    setErr(null)
    const r = await fetch(`/api/executions/${executionId}/hold`, { method: 'POST', headers: live ? { 'x-admin-token': token.get() } : {} }).catch(() => null)
    const d = r && (await r.json().catch(() => null))
    if (r?.ok) setStage('sent')
    else {
      setErr(d?.error ?? 'Could not start the reservation call.')
      setStage('idle')
    }
  }
  if (stage === 'sent') return <span className="inline-flex items-center rounded-xl bg-indigo-soft px-5 py-3 font-semibold text-indigo">Calling {shopName} to reserve…</span>
  return (
    <div className="flex flex-wrap items-center gap-2">
      {stage === 'confirm' ? (
        <>
          <button className="rounded-xl bg-ink px-5 py-3 font-semibold text-paper" onClick={send}>
            Yes, {live ? 'place a real call to' : 'simulate a call to'} {shopName}
          </button>
          <button className="rounded-xl border border-line bg-white px-4 py-3 font-semibold" onClick={() => setStage('idle')}>
            Cancel
          </button>
        </>
      ) : (
        <button className="rounded-xl bg-ink px-5 py-3 font-semibold text-paper disabled:opacity-50" onClick={() => setStage('confirm')} disabled={stage === 'sending'}>
          {stage === 'sending' ? 'Starting…' : 'Hold it'}
        </button>
      )}
      {err && (
        <p className="w-full text-sm text-chili" role="alert">
          {err}
        </p>
      )}
    </div>
  )
}

function Ledger({ data, ranked, holdFor }: { data: SearchState; ranked: Ranked[]; holdFor: (r: Ranked) => PublicExecution | undefined }) {
  const req = data.request
  const ex = new Map(data.executions.map((e) => [e.id, e]))
  const muted = (t: string) => <span className="italic text-muted">{t}</span>
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-card">
      <table className="w-full min-w-[960px] border-collapse text-left">
        <caption className="border-b-2 border-chili/50 px-5 py-3 text-left">
          <span className="font-display text-2xl">Ledger</span> <span className="text-muted">· ranked by a fixed formula, verified answers only</span>
        </caption>
        <thead className="text-xs uppercase tracking-wider text-muted">
          <tr className="border-b border-rule">
            {['#', 'Shop', 'Stock', 'Unit price', `Total (${req.quantity} ${req.unit})`, 'Variant', 'Pickup', 'Ready', 'Hold', 'Confidence', 'Score', ''].map((h) => (
              <th key={h} scope="col" className="px-3 py-2.5 font-semibold first:pl-5">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular">
          {ranked.map((r, i) => {
            const e = ex.get(r.id)!
            const x = e.status === 'done' ? e.extracted : null
            const h = holdFor(r)
            const answered = e.status === 'done'
            return (
              <tr key={r.id} className={`border-b border-rule align-top last:border-0 ${r.winner ? 'bg-kirana-soft/70' : r.eligible ? '' : 'text-ink/75'}`}>
                <td className="py-3 pl-5 pr-3 font-display text-xl" title={r.eligible ? undefined : 'Not ranked: cannot fully meet the request'}>
                  {r.eligible ? i + 1 : '–'}
                </td>
                <td className="px-3 py-3">
                  <span className="font-semibold">{r.shopName}</span>
                  {r.winner && <span className="ml-2 rounded bg-kirana px-1.5 py-0.5 text-xs font-bold uppercase text-white">Best</span>}
                  <span className="block text-sm text-muted">{r.explanation}</span>
                  {r.flags.length > 0 && answered && <span className="block text-sm text-chili">{r.flags.join(' · ')}</span>}
                </td>
                <td className="px-3 py-3">{!answered ? muted('not reached') : r.stock === 'full' ? <span className="text-kirana">✓ all {req.quantity}</span> : r.stock === 'short' ? <span className="text-marigold-deep">{x?.qty_available !== null && x?.qty_available !== undefined ? `only ${x.qty_available}` : 'partial'}</span> : r.stock === 'none' ? <span className="text-chili">✕ none</span> : muted('unclear')}</td>
                <td className="px-3 py-3">{!x || r.stock === 'none' ? muted('—') : !r.comparable ? muted(`per ${x.price_unit}`) : r.unit !== null ? inr(r.unit) : muted('not quoted')}</td>
                <td className="px-3 py-3 font-semibold">{r.total !== null ? inr(r.total) : muted(r.stock === 'short' ? 'n/a (short)' : '—')}</td>
                <td className="px-3 py-3">{x?.brand_or_variant ?? muted(x ? 'not stated' : '—')}</td>
                <td className="px-3 py-3">{x && r.stock !== 'none' ? (x.pickup_or_delivery === 'unknown' ? muted('not discussed') : x.pickup_or_delivery) : muted('—')}</td>
                <td className="px-3 py-3">{r.ready !== null ? (r.ready === 0 ? 'now' : `~${r.ready} min`) : muted(x && r.stock !== 'none' ? 'not confirmed' : '—')}</td>
                <td className="px-3 py-3">{h ? <span className={OUTCOME[holdOutcome(h)][1]}>{holdOutcome(h)}</span> : x && r.stock !== 'none' ? (x.can_hold === 'yes' ? 'can hold' : x.can_hold === 'no' ? <span className="text-chili">can&apos;t</span> : muted('not confirmed')) : muted('—')}</td>
                <td className="px-3 py-3">{x ? (x.confidence === 'med' ? 'medium' : x.confidence) : muted('—')}</td>
                <td className="px-3 py-3">
                  <span className="font-display text-xl">{answered ? r.score : '–'}</span>
                  {answered && x && <Bars f={r.factors} />}
                </td>
                <td className="py-3 pl-3 pr-5">{r.stock !== 'none' && answered && x && (x.in_stock === 'yes' || x.in_stock === 'partial') && !h && !r.winner && <HoldButton data={data} executionId={r.id} shopName={r.shopName} />}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <details className="border-t border-rule px-5 py-3 text-sm text-muted">
        <summary className="cursor-pointer font-semibold text-ink">How the score works</summary>
        <p className="mt-2 max-w-3xl leading-relaxed">
          Score = (stock up to {WEIGHTS.stock} + price up to {WEIGHTS.price} + readiness up to {WEIGHTS.ready} + can-hold {WEIGHTS.hold}) × confidence (high {CONFIDENCE.high}, medium{' '}
          {CONFIDENCE.med}, low {CONFIDENCE.low}). The cheapest verified unit price gets the full price points and others get points in proportion. Readiness falls from {WEIGHTS.ready} (ready
          now) to 0 at two hours. Only a shop with the full quantity, within your budget and deadline, can be the best match. Unknown prices score 0 and are never called cheapest. Prices
          quoted for a different unit are not compared. Ties go to the lower total, then faster readiness, higher confidence, then name.
        </p>
      </details>
    </div>
  )
}

function Bars({ f }: { f: Ranked['factors'] }) {
  const parts: [number, number, string, string][] = [
    [f.stock, WEIGHTS.stock, 'bg-kirana', 'stock'],
    [f.price, WEIGHTS.price, 'bg-marigold', 'price'],
    [f.ready, WEIGHTS.ready, 'bg-indigo', 'ready'],
    [f.hold, WEIGHTS.hold, 'bg-plum', 'hold'],
  ]
  return (
    <span className="mt-1 flex h-1.5 w-28 overflow-hidden rounded-full bg-line" title={parts.map(([v, , , n]) => `${n} ${v}`).join(' · ') + ` · ×${f.confidence}`}>
      {parts.map(([v, , c, n]) => (
        <span key={n} className={c} style={{ width: `${v}%` }} />
      ))}
    </span>
  )
}

function SpeakButton({ text, lang }: { text: string; lang: 'hi' | 'en' }) {
  const [via, setVia] = useState<string | null>(null)
  return (
    <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
      <button className="rounded-xl border-2 border-ink px-5 py-3 font-semibold hover:bg-ink hover:text-paper" onClick={async () => setVia(await speakText(text, lang))}>
        🔊 Hear the summary
      </button>
      {via && <span className="text-xs text-muted">{via === 'sarvam' ? 'Voice: Sarvam' : via === 'browser' ? "Voice: this browser's speech" : 'No speech available here; please read the text.'}</span>}
    </div>
  )
}
