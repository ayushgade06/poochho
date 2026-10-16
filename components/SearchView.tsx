'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { qtyLabel, rankResults } from '@/lib/rank'
import { calledIn } from '@/lib/summary'
import { VOICE_LANGS, type SearchState } from '@/lib/types'
import CallCard from './CallCard'
import Results from './Results'
import { browserSupabase, ModeBanner, token } from './ui'

type ReplayMeta = { id: string; source: 'live' | 'simulated'; recorded_at: string }
// The operator token (if this tab has one) unlocks transcripts of LIVE calls.
const authHeaders = (): Record<string, string> => (token.get() ? { 'x-admin-token': token.get() } : {})

export default function SearchView({ id }: { id: string }) {
  const [data, setData] = useState<SearchState | null>(null)
  const [missing, setMissing] = useState(false)
  const [rt, setRt] = useState<'connecting' | 'live' | 'off'>('connecting')
  const [now, setNow] = useState(0)
  const [replays, setReplays] = useState<ReplayMeta[]>([])
  const [sarvam, setSarvam] = useState(false)

  // Supabase Realtime: the DB pings `search:<id>` on every call change; we refetch through the API.
  useEffect(() => {
    let alive = true
    let t: ReturnType<typeof setTimeout> | undefined
    const refetch = () => {
      clearTimeout(t)
      t = setTimeout(() => {
        fetch(`/api/searches/${id}`, { cache: 'no-store', headers: authHeaders() })
          .then(async (r) => {
            if (!alive) return
            if (r.ok) setData(await r.json())
            else if (r.status === 404) setMissing(true)
          })
          .catch(() => {})
      }, 150)
    }
    refetch()
    const sb = browserSupabase()
    const ch = sb?.channel(`search:${id}`).on('broadcast', { event: 'call_changed' }, refetch).subscribe((s) => alive && setRt(s === 'SUBSCRIBED' ? 'live' : 'off'))
    if (!sb) setTimeout(() => alive && setRt('off'), 0)
    return () => {
      alive = false
      clearTimeout(t)
      if (ch) sb?.removeChannel(ch)
    }
  }, [id])

  const mode = data?.request.mode
  // A timed-out call is still polled for 30 minutes in case a late result lands; after that, stop ticking.
  const active = !data || data.executions.some((e) => e.status !== 'done' && e.status !== 'failed' && !(e.status === 'timeout' && now && e.dispatched_at && now - Date.parse(e.dispatched_at) > 1_800_000))

  // The tick advances scripted steps, live dispatch, provider polling and the watchdog. It also returns the
  // fresh state, so the page keeps working even if Realtime is unavailable.
  useEffect(() => {
    if (!active || !mode) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const step = async () => {
      try {
        const r = await fetch(`/api/searches/${id}/tick`, { method: 'POST', headers: authHeaders() })
        if (alive && r.ok) setData(await r.json())
      } catch {}
      if (alive) timer = setTimeout(step, mode === 'live' ? 3000 : 1000)
    }
    timer = setTimeout(step, 200)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [id, active, mode])

  // Call timers tick every second; afterwards "confirmed 6 min ago" only needs a slow tick.
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const first = setTimeout(tick, 0)
    const t = setInterval(tick, active ? 1000 : 30_000)
    return () => {
      clearTimeout(first)
      clearInterval(t)
    }
  }, [active])

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((c) => {
        setReplays(c.replays ?? [])
        setSarvam(c.speech === 'sarvam')
      })
      .catch(() => {})
  }, [])

  if (missing)
    return (
      <div className="py-20 text-center">
        <p className="font-display text-3xl">This search does not exist.</p>
        <Link href="/" className="mt-4 inline-block font-semibold text-indigo underline">
          Start a new one
        </Link>
      </div>
    )
  if (!data) return <p className="py-20 text-center text-muted">Loading the switchboard…</p>

  const req = data.request
  const quotes = data.executions.filter((e) => e.kind === 'quote').sort((a, b) => a.shop.name.localeCompare(b.shop.name))
  const holds = data.executions.filter((e) => e.kind === 'hold')
  const finishedN = quotes.filter((e) => ['done', 'failed', 'timeout'].includes(e.status)).length
  const ranked = rankResults(req, quotes.map((e) => ({ id: e.id, shopName: e.shop.name, status: e.status, error: e.error, extracted: e.extracted })))
  const replay = replays.find((r) => r.id === req.replay_of)
  const progress = `${finishedN} of ${quotes.length} calls finished`

  return (
    <div className="space-y-8">
      <ModeBanner mode={req.mode} replaySource={replay?.source} recordedAt={replay?.recorded_at} />

      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-muted">Asking {quotes.length} shops</p>
          <h1 className="mt-1 font-display text-4xl leading-tight sm:text-5xl">
            {qtyLabel(req.quantity, req.unit)} · {req.product}
            {req.brand_or_variant && <span className="text-muted"> ({req.brand_or_variant})</span>}
          </h1>
          <p className="mt-1 text-lg text-muted">
            Near {req.area}, {req.city}
            {req.asked_in && ` · asked in ${VOICE_LANGS[req.asked_in]}`} · called in {calledIn(data)}
            {req.need_within_minutes ? ` · needed within ${req.need_within_minutes} min` : ''}
            {req.max_budget_inr ? ` · budget ₹${req.max_budget_inr}` : ''}
          </p>
        </div>
        <div className="sm:text-right">
          <p className="font-display text-5xl tabular leading-none">
            {finishedN}
            <span className="text-muted">/{quotes.length}</span>
          </p>
          <p className="mt-1 text-sm text-muted">calls finished</p>
          <p className="mt-1 text-xs text-muted">{rt === 'live' ? '● Realtime connected' : rt === 'connecting' ? '○ Connecting…' : '○ Polling for updates'}</p>
        </div>
      </header>

      <div className="h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={quotes.length} aria-valuenow={finishedN} aria-label={progress}>
        <div className="h-full rounded-full bg-kirana transition-[width] duration-700" style={{ width: `${quotes.length ? (finishedN / quotes.length) * 100 : 0}%` }} />
      </div>
      {data.redacted && <p className="text-sm text-muted">Transcripts of real calls are shown to the operator only (enter the operator token on the home page in this tab).</p>}
      <p className="sr-only" aria-live="polite">
        {progress}
      </p>

      <section aria-label="Calls" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[...quotes, ...holds].map((e) => (
          <CallCard key={e.id} e={e} now={now} quantity={req.quantity} />
        ))}
      </section>

      {finishedN > 0 && <Results data={data} ranked={ranked} holds={holds} finished={finishedN === quotes.length} sarvam={sarvam} now={now} />}
    </div>
  )
}
