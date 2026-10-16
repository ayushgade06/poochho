'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { inr } from '@/lib/rank'
import type { PublicExecution } from '@/lib/types'
import { Lamp, Proof, reason, STATUS, token } from './ui'

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`

const noop = () => () => {}

export default function CallCard({ e, now, quantity }: { e: PublicExecution; now: number; quantity: number }) {
  const s = STATUS[e.status]
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
        <Lamp status={e.status} />
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-2xl leading-tight break-words">{e.shop.name}</h3>
          <p className="text-sm text-muted">
            {e.shop.area}
            {e.kind === 'hold' ? ' · Reservation call' : e.shop.source === 'demo' ? ' · Simulated shop' : e.shop.source === 'replay' ? ' · Replayed' : ''}
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
      {e.kind === 'quote' && <Proof e={e} now={now} className="mt-1" />}

      {x && e.status === 'done' && (
        <dl className="mt-3 flex flex-wrap gap-2 text-sm">
          <Chip k="Stock" v={x.in_stock === 'yes' ? (x.qty_available !== null && x.qty_available < quantity ? `only ${x.qty_available}` : 'yes') : x.in_stock === 'partial' ? (x.qty_available !== null ? `only ${x.qty_available}` : 'partial') : x.in_stock === 'no' ? 'no' : 'unclear'} tone={x.in_stock === 'yes' ? 'good' : x.in_stock === 'no' ? 'bad' : 'warn'} />
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
