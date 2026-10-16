'use client'

import { useState, useSyncExternalStore } from 'react'
import { centsToInr } from '@/lib/metrics'
import { CONFIDENCE, inr, qtyLabel, WEIGHTS, winnerReason, type Ranked } from '@/lib/rank'
import { holdOutcome, searchSummary, shareText, timeSaved, type HoldOutcome } from '@/lib/summary'
import { VOICE_LANGS, type PublicExecution, type SearchState, type VoiceLang } from '@/lib/types'
import { Proof, speakText, token, voiceLang } from './ui'

const OUTCOME: Record<HoldOutcome, [string, string]> = {
  confirmed: ['Reservation confirmed by the shop', 'text-kirana'],
  declined: ['Shop declined to hold it', 'text-chili'],
  pending: ['Confirmation pending: calling the shop…', 'text-indigo'],
  failed: ['Reservation call failed', 'text-chili'],
  unknown: ['Outcome unknown: the shop did not clearly agree', 'text-marigold-deep'],
}

export default function Results({ data, ranked, holds, finished, sarvam, now }: { data: SearchState; ranked: Ranked[]; holds: PublicExecution[]; finished: boolean; sarvam: boolean; now: number }) {
  const req = data.request
  const winner = ranked.find((r) => r.winner)
  const byId = new Map(data.executions.map((e) => [e.id, e]))
  const holdFor = (r: Ranked) => holds.find((h) => h.shop_id === byId.get(r.id)?.shop_id)
  const winnerHold = winner && holdFor(winner)
  const hold = winnerHold ? { shopName: winner!.shopName, outcome: holdOutcome(winnerHold) } : null
  const summary = searchSummary(data)
  const saved = finished ? timeSaved(data.executions) : null

  return (
    <section className="space-y-6" aria-labelledby="results">
      <h2 id="results" className="font-display text-3xl">
        {finished ? 'Results' : 'Results so far'}
      </h2>

      {winner ? (
        // keyed by shop: a half-confirmed "Hold it" must never carry over to a different winner
        <WinnerCard key={winner.id} data={data} r={winner} hold={winnerHold} why={winnerReason(ranked, hold?.outcome ?? null)} now={now} />
      ) : (
        finished && (
          <div className="rounded-2xl border-2 border-dashed border-line bg-card p-6">
            <p className="font-display text-2xl">
              No shop confirmed all {qtyLabel(req.quantity, req.unit)}
              {(req.max_budget_inr || req.need_within_minutes) && ' within your limits'}.
            </p>
            <p className="mt-1 text-muted">See the ledger below for partial stock and unconfirmed answers. Nothing here is guessed.</p>
          </div>
        )
      )}

      {saved && saved.calls > 1 && saved.sequentialSec > saved.parallelSec && <TimeSaved {...saved} />}
      {finished && <Cost data={data} />}

      <Ledger data={data} ranked={ranked} holdFor={holdFor} now={now} />

      <Summary searchId={req.id} text={summary} lang={req.language} sarvam={sarvam} />
    </section>
  )
}

function WinnerCard({ data, r, hold, why, now }: { data: SearchState; r: Ranked; hold?: PublicExecution; why: string | null; now: number }) {
  const req = data.request
  const e = data.executions.find((x) => x.id === r.id)!
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
      {/* availability first (has it, how soon, can they hold it), then the price */}
      <p className="mt-2 text-2xl font-semibold leading-snug tabular sm:text-3xl">{r.explanation}</p>
      <Proof e={e} now={now} className="mt-3 text-lg" />
      {why && <p className="mt-2 text-muted">Why: {why}</p>}
      {outcome && <p className={`mt-3 text-lg font-semibold ${OUTCOME[outcome][1]}`}>{OUTCOME[outcome][0]}</p>}
      <div className="mt-6 flex flex-wrap gap-3">
        {!hold && <HoldButton key={r.id} data={data} executionId={r.id} shopName={r.shopName} />}
        <a
          className="inline-flex items-center gap-2 rounded-xl bg-[#1f7a43] px-5 py-3 font-semibold text-white"
          href={`https://wa.me/?text=${encodeURIComponent(shareText(req, r, reserved, e.ended_at))}`}
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
            Yes, {live ? 'place a real call to' : data.request.mode === 'replay' ? 'replay the recorded call to' : 'simulate a call to'} {shopName}
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

function Ledger({ data, ranked, holdFor, now }: { data: SearchState; ranked: Ranked[]; holdFor: (r: Ranked) => PublicExecution | undefined; now: number }) {
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
            {['#', 'Shop', 'Stock', 'Unit price', `Total (${qtyLabel(req.quantity, req.unit)})`, 'Variant', 'Pickup', 'Ready', 'Hold', 'Confidence', 'Score', ''].map((h) => (
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
                  {answered && r.flags.some((f) => !r.explanation.startsWith(f)) && <span className="block text-sm text-chili">{r.flags.filter((f) => !r.explanation.startsWith(f)).join(' · ')}</span>}
                  {answered && <Proof e={e} now={now} className="text-sm" />}
                </td>
                <td className="px-3 py-3">{!answered ? muted('not reached') : r.stock === 'full' ? <span className="text-kirana">✓ all {req.quantity}</span> : r.stock === 'short' ? <span className="text-marigold-deep">{x?.qty_available !== null && x?.qty_available !== undefined ? `only ${x.qty_available}` : 'partial'}</span> : r.stock === 'none' ? <span className="text-chili">✕ none</span> : muted('unclear')}</td>
                <td className="px-3 py-3">{!x || r.stock === 'none' ? muted('—') : !r.comparable ? muted(`per ${x.price_unit}`) : r.unit !== null ? inr(r.unit) : x.unit_price_inr ? muted(`${inr(x.unit_price_inr)}, unit not stated`) : muted('not quoted')}</td>
                <td className="px-3 py-3 font-semibold">{r.total !== null ? inr(r.total) : muted(r.stock === 'short' ? 'n/a (short)' : '—')}</td>
                <td className="px-3 py-3">{x?.brand_or_variant ?? muted(x && r.stock !== 'none' ? 'not stated' : '—')}</td>
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
          Availability comes first: packaged goods and medicines carry a printed MRP, so prices barely differ between shops. Score = (stock up to {WEIGHTS.stock} + readiness up to{' '}
          {WEIGHTS.ready} + can-hold {WEIGHTS.hold} + price up to {WEIGHTS.price}) × confidence (high {CONFIDENCE.high}, medium {CONFIDENCE.med}, low {CONFIDENCE.low}). Readiness falls from{' '}
          {WEIGHTS.ready} (ready now) to 0 at two hours. The cheapest verified unit price gets the full price points and others get points in proportion. Only a shop with the full quantity,
          within your budget and deadline, can be the best match. Unknown prices score 0 and are never called cheapest. Prices quoted for a different unit are not compared. Ties go to the
          lower total, then faster readiness, higher confidence, then name.
        </p>
      </details>
    </div>
  )
}

function Bars({ f }: { f: Ranked['factors'] }) {
  const parts: [number, number, string, string][] = [
    [f.stock, WEIGHTS.stock, 'bg-kirana', 'stock'],
    [f.ready, WEIGHTS.ready, 'bg-indigo', 'ready'],
    [f.hold, WEIGHTS.hold, 'bg-plum', 'hold'],
    [f.price, WEIGHTS.price, 'bg-marigold', 'price'],
  ]
  return (
    <span className="mt-1 flex h-1.5 w-28 overflow-hidden rounded-full bg-line" title={parts.map(([v, , , n]) => `${n} ${v}`).join(' · ') + ` · ×${f.confidence}`}>
      {parts.map(([v, , c, n]) => (
        <span key={n} className={c} style={{ width: `${v}%` }} />
      ))}
    </span>
  )
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`

// Measured from this run's own call timestamps, not an estimate.
function TimeSaved({ calls, parallelSec, sequentialSec }: { calls: number; parallelSec: number; sequentialSec: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-2xl border border-line bg-card px-6 py-4">
      <p className="tabular">
        <span className="font-display text-4xl">{mmss(parallelSec)}</span>
        <span className="block text-sm text-muted">{calls} calls, all at once</span>
      </p>
      <p className="tabular text-muted">
        <span className="font-display text-4xl line-through decoration-chili/60">{mmss(sequentialSec)}</span>
        <span className="block text-sm">the same calls, one by one</span>
      </p>
      <p className="min-w-56 flex-1 text-lg">
        <strong className="text-kirana">{Math.round((1 - parallelSec / sequentialSec) * 100)}% faster</strong> than ringing each shop yourself, and you didn&apos;t have to make a single call.
      </p>
    </div>
  )
}

// What the calls cost: Bolna's per-call charge (US cents), shown in rupees. Simulated calls cost nothing.
function Cost({ data }: { data: SearchState }) {
  if (data.request.mode === 'simulated') return <p className="text-sm text-muted">Simulated calls: no call credits were used.</p>
  const costed = data.executions.filter((e) => e.cost_cents !== null)
  if (!costed.length) return null
  const cents = costed.reduce((sum, e) => sum + Number(e.cost_cents), 0)
  return (
    <p className="text-lg">
      <strong className="tabular">≈ {inr(centsToInr(cents))}</strong> {data.request.mode === 'replay' ? 'for the recorded search' : 'for this search'}
      <span className="text-sm text-muted">
        {' '}
        · {Math.round(cents * 10) / 10}¢ US in Bolna call charges, {costed.length} call{costed.length === 1 ? '' : 's'}
      </span>
    </p>
  )
}

const noop = () => () => {}
// The summary in the request's language; with Sarvam it can also be heard in 9 more Indian languages
// (machine-translated, labelled as such). Defaults to the language the user spoke in, if any.
function Summary({ searchId, text, lang, sarvam }: { searchId: string; text: string; lang: 'hi' | 'en'; sarvam: boolean }) {
  const spoken = useSyncExternalStore(noop, voiceLang.get, () => null)
  const [picked, setTo] = useState<VoiceLang | null>(null)
  const to = picked ?? spoken ?? (lang === 'en' ? 'en-IN' : 'hi-IN')
  const [out, setOut] = useState<Awaited<ReturnType<typeof speakText>> | null>(null)
  const [busy, setBusy] = useState(false)
  async function play() {
    setBusy(true)
    setOut(await speakText(searchId, text, sarvam ? to : lang === 'en' ? 'en-IN' : 'hi-IN'))
    setBusy(false)
  }
  return (
    <div className="space-y-3 rounded-2xl border border-line bg-card p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <p className="flex-1 text-lg leading-relaxed" lang={lang}>
          {text}
        </p>
        <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
          <div className="flex gap-2">
            {sarvam && (
              <select aria-label="Language to hear the summary in" className="rounded-xl border-2 border-ink bg-white px-2 py-3 font-semibold" value={to} onChange={(e) => setTo(e.target.value as VoiceLang)}>
                {(Object.keys(VOICE_LANGS) as VoiceLang[]).map((l) => (
                  <option key={l} value={l}>
                    {VOICE_LANGS[l]}
                  </option>
                ))}
              </select>
            )}
            <button className="rounded-xl border-2 border-ink px-5 py-3 font-semibold hover:bg-ink hover:text-paper disabled:opacity-50" onClick={play} disabled={busy}>
              {busy ? 'Preparing…' : '🔊 Hear the summary'}
            </button>
          </div>
          {out && <span className="text-xs text-muted">{out.via === 'sarvam' ? `Voice: Sarvam Bulbul${out.translated ? ' · translated by Sarvam' : ''}` : out.via === 'browser' ? "Voice: this browser's speech" : 'No speech available here; please read the text.'}</span>}
        </div>
      </div>
      {out?.translated && out.text && (
        <p className="border-t border-line pt-3 text-lg leading-relaxed" lang={to.slice(0, 2)}>
          <span className="mr-2 rounded bg-indigo-soft px-1.5 py-0.5 text-xs font-bold uppercase text-indigo">{VOICE_LANGS[to]} · machine-translated</span>
          {out.text}
        </p>
      )}
    </div>
  )
}
