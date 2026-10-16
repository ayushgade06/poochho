'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { inr } from '@/lib/rank'
import { notNeeded } from '@/lib/state'
import { CALL_LANGS, type LiveAnswer, type PublicExecution } from '@/lib/types'
import { Lamp, Proof, reason, STATUS, token } from './ui'

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`

const noop = () => () => {}
const stock = (inStock: LiveAnswer['in_stock'], qty: number | null | undefined, quantity: number) =>
  inStock === 'yes' ? (qty != null && qty < quantity ? `only ${qty}` : 'yes') : inStock === 'partial' ? (qty != null ? `only ${qty}` : 'partial') : inStock === 'no' ? 'no' : 'unclear'
const tone = (v: string | undefined) => (v === 'yes' ? 'good' : v === 'no' ? 'bad' : 'warn')

export default function CallCard({ e, now, quantity }: { e: PublicExecution; now: number; quantity: number }) {
  const skipped = e.status === 'failed' && notNeeded(e.error) // never dialled: another shop already had it all
  const s = skipped ? { label: 'Not called', tone: 'text-muted' } : e.mode === 'judge' && e.status === 'queued' ? { label: 'Waiting for you to answer', tone: 'text-plum' } : STATUS[e.status]
  const operator = useSyncExternalStore(noop, () => Boolean(token.get()), () => false)
  const live = !['done', 'failed', 'timeout'].includes(e.status)
  const x = e.extracted
  const lines = (e.transcript ?? '')
    .split('\n')
    .map((l) => /^(assistant|user|agent|bot):\s*(.*)$/i.exec(l.trim()))
    .filter((m): m is RegExpExecArray => !!m && !!m[2])
    .map((m) => ({ ai: !/^user$/i.test(m[1]), text: m[2] }))

  return (
    <article className={`rise flex flex-col rounded-2xl border bg-card p-5 ${e.kind === 'hold' ? 'border-indigo/50' : 'border-line'}`} aria-label={`${e.shop.name}: ${s.label}`}>
      <div className="flex items-start gap-3">
        <Lamp status={skipped ? 'queued' : e.status} />
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-2xl leading-tight break-words">{e.shop.name}</h3>
          <p className="text-sm text-muted">
            {e.shop.area}
            {e.kind === 'hold' ? ' · Reservation call' : e.shop.source === 'demo' ? ' · Simulated shop' : e.shop.source === 'replay' ? ' · Replayed' : ''}
            {e.language && CALL_LANGS[e.language] && ` · called in ${CALL_LANGS[e.language].name}`}
          </p>
        </div>
        <span className="tabular rounded-md bg-ink/5 px-2 py-1 font-mono text-sm text-muted" aria-label="Elapsed time">
          {live && e.dispatched_at && now ? clock(Math.max(0, now - Date.parse(e.dispatched_at))) : e.duration_seconds ? `${Math.round(e.duration_seconds)}s talk` : '—'}
        </span>
      </div>

      <p className={`mt-3 font-semibold ${s.tone}`}>
        {s.label}
        {(e.status === 'failed' || e.status === 'timeout') && reason(e.error) && <span className="font-normal text-muted"> · {reason(e.error)}</span>}
      </p>
      {e.mode === 'judge' && !['done', 'failed', 'timeout'].includes(e.status) && <JudgeCall key={e.id} id={e.id} waiting={e.status === 'queued'} />}
      {e.kind === 'quote' && <Proof e={e} now={now} className="mt-1" />}
      {e.live_answer && !(x && e.status === 'done') && <Live a={e.live_answer} quantity={quantity} />}

      {x && e.status === 'done' && (
        <dl className="mt-3 flex flex-wrap gap-2 text-sm">
          <Chip k="Stock" v={stock(x.in_stock, x.qty_available, quantity)} tone={tone(x.in_stock)} />
          {x.in_stock !== 'no' && (
            <Chip k="Price" v={x.total_price_inr !== null ? `${inr(x.total_price_inr)} total` : x.unit_price_inr !== null ? (x.price_unit ? `${inr(x.unit_price_inr)} / ${x.price_unit}` : `${inr(x.unit_price_inr)} (unit not stated)`) : 'not quoted'} tone={x.total_price_inr ?? x.unit_price_inr ? 'good' : 'warn'} />
          )}
          {x.in_stock !== 'no' && <Chip k="Ready" v={x.ready_in_minutes === null ? 'not confirmed' : x.ready_in_minutes === 0 ? 'now' : `~${x.ready_in_minutes} min`} tone={x.ready_in_minutes === null ? 'warn' : 'good'} />}
          {e.kind === 'hold' ? (
            <Chip k="Reserved" v={x.can_hold === 'yes' ? 'confirmed' : x.can_hold === 'no' ? 'declined' : 'unclear'} tone={x.can_hold === 'yes' ? 'good' : x.can_hold === 'no' ? 'bad' : 'warn'} />
          ) : (
            x.in_stock !== 'no' && <Chip k="Can hold" v={x.can_hold} tone={x.can_hold === 'yes' ? 'good' : x.can_hold === 'no' ? 'bad' : 'warn'} />
          )}
          <Chip k="Confidence" v={x.confidence === 'med' ? 'medium' : x.confidence} tone={x.confidence === 'high' ? 'good' : x.confidence === 'low' ? 'bad' : 'warn'} />
          {x.opt_out === 'yes' && <Chip k="Opt-out" v="recorded, never called again" tone="bad" />}
        </dl>
      )}
      {!x && e.status === 'done' && <p className="mt-2 text-sm text-muted">The call ended, but no usable answers were extracted.</p>}

      {lines.length > 0 && <Transcript lines={lines} />}
      {e.answered_at && e.ended_at && (e.mode === 'live' ? operator && <Recording id={e.id} /> : <p className="mt-3 text-xs text-muted">{e.mode === 'simulated' ? 'Simulated call — no audio' : 'Replayed call — no audio'}</p>)}
    </article>
  )
}

// Judge mode: the judge answers the agent in this browser through Bolna's Web Call SDK (loaded only on click). The
// session comes from our server; the answers then flow through the same webhooks, extraction and ranking as a phone
// call. Two minutes at most, on top of the agent's own call timeout.
const JUDGE_MAX_MS = 120_000
function JudgeCall({ id, waiting }: { id: string; waiting: boolean }) {
  const [state, setState] = useState<'idle' | 'connecting' | 'ringing' | 'active' | 'ended'>('idle')
  const [err, setErr] = useState<string | null>(null)
  const call = useRef<{ stop: () => Promise<void> } | null>(null)
  useEffect(() => () => void call.current?.stop(), [])
  async function answer() {
    setErr(null)
    setState('connecting')
    try {
      // The microphone first: the SDK mints the session (one Bolna call, one cap slot) before asking for it.
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null)
      if (!mic) throw new Error('Allow the microphone to play the shopkeeper.')
      mic.getTracks().forEach((t) => t.stop())
      const { BolnaWebCall } = await import('@bolna/web-call')
      const c = new BolnaWebCall({
        getSession: async () => {
          const r = await fetch(`/api/executions/${id}/web-call`, { method: 'POST' })
          const d = await r.json().catch(() => ({}))
          if (!r.ok) throw new Error(d.error ?? 'Could not start the call.')
          return d
        },
      })
      call.current = c
      c.on('state-change', setState)
      c.on('error', (x) => setErr(x.code === 'microphone_denied' ? 'Allow the microphone to play the shopkeeper.' : x.message))
      setTimeout(() => void c.stop(), JUDGE_MAX_MS)
      await c.start()
    } catch (x) {
      setErr((x as Error).message)
      setState('idle')
    }
  }
  const on = state === 'connecting' || state === 'ringing' || state === 'active'
  return (
    <div className="mt-3 space-y-2">
      {waiting && !on && state !== 'ended' && (
        <button className="rounded-xl bg-plum px-4 py-2.5 font-semibold text-white" onClick={answer}>
          📞 Answer the call
        </button>
      )}
      {on && (
        <p className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-semibold text-plum">{state === 'active' ? 'You are on the call: answer as the shopkeeper' : 'Connecting…'}</span>
          <button className="rounded-lg border border-line bg-white px-3 py-1 font-semibold" onClick={() => void call.current?.stop()}>
            Hang up
          </button>
        </p>
      )}
      {err && (
        <p className="text-sm text-chili" role="alert">
          {err}
        </p>
      )}
    </div>
  )
}

// What the agent reported mid-call (its report_availability tool), before the call's final answers replace it.
function Live({ a, quantity }: { a: LiveAnswer; quantity: number }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
      <span className="rounded-full bg-indigo-soft px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-indigo">
        <span className="blink" aria-hidden>
          ●
        </span>{' '}
        Heard live · provisional
      </span>
      <dl className="contents">
        {a.in_stock && <Chip k="Stock" v={stock(a.in_stock, a.qty_available, quantity)} tone={tone(a.in_stock)} />}
        {a.price_inr != null && <Chip k="Price" v={`${inr(a.price_inr)} total`} tone="good" />}
        {a.ready_in_minutes != null && <Chip k="Ready" v={a.ready_in_minutes === 0 ? 'now' : `~${a.ready_in_minutes} min`} tone="good" />}
        {a.can_hold && <Chip k="Can hold" v={a.can_hold} tone={tone(a.can_hold)} />}
      </dl>
    </div>
  )
}

// The operator can listen to a LIVE call. Our server fetches it from Bolna at play time; the link is never stored.
function Recording({ id }: { id: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  useEffect(() => () => void (src && URL.revokeObjectURL(src)), [src])
  async function load() {
    setState('loading')
    const r = await fetch(`/api/executions/${id}/recording`, { headers: { 'x-admin-token': token.get() } }).catch(() => null)
    const audio = r?.ok ? await r.blob().catch(() => null) : null
    if (audio) setSrc(URL.createObjectURL(audio))
    else setState('error')
  }
  if (src) return <audio className="mt-3 w-full" controls autoPlay src={src} aria-label="Call recording" />
  return (
    <button className="mt-3 inline-flex items-center gap-2 self-start rounded-full border border-line bg-white px-3 py-1 text-sm font-semibold disabled:opacity-50" onClick={load} disabled={state === 'loading'}>
      <span aria-hidden>▶</span>
      {state === 'loading' ? 'Loading the recording…' : state === 'error' ? 'Recording unavailable, try again' : 'Play the call recording'}
    </button>
  )
}

function Chip({ k, v, tone }: { k: string; v: string; tone: 'good' | 'warn' | 'bad' }) {
  const c = { good: 'bg-kirana-soft text-kirana', warn: 'bg-marigold-soft text-marigold-deep', bad: 'bg-chili-soft text-chili' }[tone]
  return (
    <div className={`rounded-full px-3 py-1 ${c}`}>
      <dt className="inline font-medium opacity-80">{k}: </dt>
      <dd className="inline font-semibold">{v}</dd>
    </div>
  )
}

function Transcript({ lines }: { lines: { ai: boolean; text: string }[] }) {
  const [open, setOpen] = useState(false)
  const shown = open ? lines : lines.slice(-2)
  return (
    <div className="mt-4 border-t border-line pt-3">
      <ol className="space-y-1.5 text-[15px] leading-snug" aria-label="Transcript">
        {shown.map((l, i) => (
          <li key={i} className={`flex gap-2 ${l.ai ? '' : 'justify-end'}`}>
            <span className={`max-w-[85%] rounded-xl px-3 py-1.5 ${l.ai ? 'bg-marigold-soft' : 'bg-white ring-1 ring-line'}`}>
              <span className="mr-1 text-xs font-bold uppercase tracking-wide text-muted">{l.ai ? 'AI' : 'Shop'}</span>
              {l.text}
            </span>
          </li>
        ))}
      </ol>
      {lines.length > 2 && (
        <button className="mt-2 text-sm font-semibold text-indigo underline-offset-2 hover:underline" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Show less' : `Show full transcript (${lines.length} lines)`}
        </button>
      )}
    </div>
  )
}
