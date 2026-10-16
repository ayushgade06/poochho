'use client'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ago } from '@/lib/summary'
import { VOICE_LANGS, type CallStatus, type Mode, type PublicExecution, type VoiceLang } from '@/lib/types'

// ---------- mode banners: SIMULATED, REPLAY and LIVE never look alike ----------
export function ModeBanner({ mode, replaySource, recordedAt }: { mode: Mode; replaySource?: 'live' | 'simulated'; recordedAt?: string }) {
  if (mode === 'live')
    return (
      <div role="status" className="flex items-center gap-3 rounded-xl border-2 border-chili bg-chili-soft px-4 py-3 text-chili">
        <span className="blink inline-block size-3 rounded-full bg-chili" aria-hidden />
        <strong className="tracking-wide">LIVE</strong>
        <span className="text-ink">Real phone calls to consenting test shops.</span>
      </div>
    )
  if (mode === 'replay')
    return (
      <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-indigo bg-indigo-soft px-4 py-3 text-indigo">
        <span aria-hidden>⟲</span>
        <strong className="tracking-wide">REPLAY</strong>
        <span className="text-ink">
          Playback of a {replaySource === 'live' ? 'real' : 'SIMULATED'} run{recordedAt ? ` recorded ${new Date(recordedAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}` : ''}. No calls are being made.
        </span>
      </div>
    )
  return (
    <div role="status" className="hatch flex flex-wrap items-center gap-3 rounded-xl border-2 border-marigold bg-marigold-soft px-4 py-3 text-marigold-deep">
      <strong className="tracking-wide">SIMULATED</strong>
      <span className="text-ink">Scripted demo calls to fictional shops. No phones ring and no credits are used.</span>
    </div>
  )
}

// ---------- call status ----------
export const STATUS: Record<CallStatus, { label: string; tone: string }> = {
  queued: { label: 'Waiting for a free line', tone: 'text-muted' },
  dispatching: { label: 'Dialling', tone: 'text-muted' },
  ringing: { label: 'Ringing', tone: 'text-marigold-deep' },
  talking: { label: 'On the call', tone: 'text-indigo' },
  processing: { label: 'Reading the answers', tone: 'text-plum' },
  done: { label: 'Answered', tone: 'text-kirana' },
  failed: { label: 'Not reached', tone: 'text-chili' },
  timeout: { label: 'No update in time', tone: 'text-chili' },
}

export function Lamp({ status }: { status: CallStatus }) {
  if (status === 'talking')
    return (
      <span className="wave flex h-9 w-9 items-center justify-center gap-[3px] rounded-full bg-indigo text-white" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="h-4 w-[3px] rounded-full bg-white" />
        ))}
      </span>
    )
  const color = { queued: 'bg-muted/30', dispatching: 'bg-muted/60', ringing: 'bg-marigold text-marigold', processing: 'bg-plum', done: 'bg-kirana', failed: 'bg-chili', timeout: 'bg-chili/60' }[status]
  return (
    <span className={`relative flex size-9 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white ${color} ${status === 'ringing' ? 'lamp-ring' : ''}`} aria-hidden>
      {status === 'done' ? '✓' : status === 'failed' || status === 'timeout' ? '✕' : status === 'processing' ? <span className="blink">…</span> : ''}
    </span>
  )
}

const REASONS: [RegExp, string][] = [
  [/^no-answer/, 'No answer'],
  [/^busy/, 'Line busy'],
  [/^voicemail/, 'Went to voicemail'],
  [/without a conversation/, 'Picked up, but no conversation'],
  [/wallet balance/, 'Bolna wallet balance too low'],
  [/rescheduled/, 'Provider pushed it outside calling hours; not followed up'],
  [/^not placed: /, ''],
  [/^could not start the call/, 'Could not start the call'],
  [/watchdog/, 'No result from the provider in time'],
]
export function reason(error: string | null) {
  if (!error) return null
  for (const [re, text] of REASONS) if (re.test(error)) return text || error.replace(/^not placed: /, 'Not placed: ')
  return error.charAt(0).toUpperCase() + error.slice(1)
}

// ---------- proof behind an answer: the shopkeeper's own words and how fresh they are ----------
// The server sends a quote only if the transcript contains it word for word. A replay's timestamps are from the
// playback, not from when the shop answered, so it shows no age (its banner carries the recording date).
export function Proof({ e, now, className = '' }: { e: PublicExecution; now: number; className?: string }) {
  const quote = e.status === 'done' ? e.extracted?.stock_quote : null
  const at = e.status === 'done' && e.mode !== 'replay' && now > 0 ? (e.ended_at ?? e.first_quote_at) : null
  if (!quote && !at) return null
  return (
    <p className={className}>
      {quote && (
        <q lang={e.shop.language} className="italic">
          {quote}
        </q>
      )}
      {quote && at && <span className="text-muted"> · </span>}
      {at && <span className="whitespace-nowrap text-muted">confirmed {ago(at, now)}</span>}
    </p>
  )
}

// ---------- operator token (privileged actions); kept for this browser tab only ----------
export const token = {
  get: () => {
    try {
      return sessionStorage.getItem('poochho-operator') ?? ''
    } catch {
      return ''
    }
  },
  set: (v: string) => {
    try {
      sessionStorage.setItem('poochho-operator', v)
    } catch {}
  },
}

// The language the user last spoke in (Sarvam-detected); the results page offers the summary in it.
export const voiceLang = {
  get: (): VoiceLang | null => {
    try {
      const v = sessionStorage.getItem('poochho-voice-lang')
      return v && v in VOICE_LANGS ? (v as VoiceLang) : null
    } catch {
      return null
    }
  },
  set: (v: VoiceLang) => {
    try {
      sessionStorage.setItem('poochho-voice-lang', v)
    } catch {}
  },
}

// ---------- speech out: Sarvam TTS when configured (server speaks its own summary of the search, translated
// when needed), else the browser's voice reading the same Hindi/English text ----------
export async function speakText(searchId: string, text: string, lang: VoiceLang): Promise<{ via: 'sarvam' | 'browser' | 'none'; text?: string; translated?: boolean }> {
  try {
    const r = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ search_id: searchId, lang }) })
    if (r.ok) {
      const d = await r.json()
      await new Audio(`data:audio/wav;base64,${d.audio}`).play()
      return { via: 'sarvam', text: d.text, translated: d.translated }
    }
  } catch {}
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = lang === 'en-IN' ? 'en-IN' : 'hi-IN'
    const voice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(u.lang.slice(0, 2)))
    if (voice) u.voice = voice
    speechSynthesis.cancel()
    speechSynthesis.speak(u)
    return { via: 'browser' }
  }
  return { via: 'none' }
}

// ---------- browser Supabase client: Realtime pings only (the tables are closed to this key) ----------
let sb: SupabaseClient | null | undefined
export function browserSupabase() {
  if (sb === undefined) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    sb = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null
  }
  return sb
}

export const field = 'w-full rounded-lg border border-line bg-white px-3 py-2.5 text-[17px] outline-none transition focus:border-indigo focus:ring-2 focus:ring-indigo/20'
export const label = 'mb-1.5 block text-sm font-semibold text-muted'
