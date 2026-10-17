'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { CALL_LANGS, callLanguage, CATEGORIES, LANGS, UNITS, VOICE_LANGS, type Lang, type VoiceLang } from '@/lib/types'
import { MEDICINE_CREDIT, NO_ALTERNATIVES, type Medicine } from '@/lib/medicine'
import { qtyLabel } from '@/lib/rank'
import { parseSentence } from '@/lib/voice'
import { field, label, ModeBanner, token } from './ui'

type Config = {
  live: { blockers: string[]; inWindow: boolean; window: string }
  speech: 'sarvam' | 'browser'
  maxCalls: number
  judge: boolean
  replays: { id: string; title: string; source: 'live' | 'simulated'; recorded_at: string }[]
}
type ShopOption = { id: string; name: string; area: string; language: string; callable: boolean; note: string }
type Med = Medicine & { allowed: boolean }
type Mode = 'simulated' | 'live' | 'replay' | 'judge'
// Judge mode's simulated shops: ones that don't settle the search before the judge answers.
const JUDGE_PICKS = ['demo-gupta-general', 'demo-patil-provision']

const EMPTY = { product: '', brand_or_variant: '', quantity: '1', unit: 'piece', category: '', city: '', area: '', language: 'hi' as Lang, max_budget_inr: '', need_within_minutes: '', constraints: '' }
const WITHIN = [['', 'Any time today'], ['30', 'Within 30 min'], ['60', 'Within 1 hour'], ['120', 'Within 2 hours'], ['240', 'Within 4 hours']]

export default function SearchForm() {
  const router = useRouter()
  const [config, setConfig] = useState<Config | null>(null)
  const [mode, setMode] = useState<Mode>('simulated')
  const [f, setF] = useState(EMPTY)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [step, setStep] = useState<'form' | 'review'>('form')
  const [shops, setShops] = useState<ShopOption[] | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [replayId, setReplayId] = useState('')
  const [op, setOp] = useState(() => token.get())
  const [consent, setConsent] = useState(false)
  const [stopWhenFound, setStopWhenFound] = useState(true)
  const [busy, setBusy] = useState(false)
  const [fail, setFail] = useState<string | null>(null)
  const [heard, setHeard] = useState<{ text: string; filled: string[]; lang?: VoiceLang | null } | null>(null)
  const [sentence, setSentence] = useState('') // "2 packet Amul Butter, Kothrud, Pune": the one box on the home page
  const [understood, setUnderstood] = useState('') // the sentence the fields were last filled from
  const [details, setDetails] = useState(false)
  const [parsing, setParsing] = useState(false)
  // Pharmacy: the medicine's composition, looked up on the server, for the user to confirm.
  const [meds, setMeds] = useState<{ q: string; list: Med[] } | null>(null)
  const [medPick, setMedPick] = useState<number | 'none' | null>(null)
  const [askAlt, setAskAlt] = useState(false)
  const medQ = f.category === 'pharmacy' && mode !== 'replay' ? f.product.trim() : ''
  const medList = meds?.q === medQ ? meds.list : null
  const med = medPick === 'none' ? null : (medList?.find((m) => m.id === medPick) ?? medList?.[0] ?? null)

  useEffect(() => {
    if (medQ.length < 3) return
    const ctl = new AbortController() // a slower, older lookup must never overwrite a newer one
    const t = setTimeout(() => {
      fetch(`/api/medicines?q=${encodeURIComponent(medQ)}`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : { medicines: [] }))
        .then((d) => setMeds({ q: medQ, list: d.medicines ?? [] }))
        .catch(() => !ctl.signal.aborted && setMeds({ q: medQ, list: [] }))
    }, 300)
    return () => {
      clearTimeout(t)
      ctl.abort()
    }
  }, [medQ])

  useEffect(() => {
    fetch('/api/config').then((r) => r.json()).then(setConfig).catch(() => setFail('Could not load settings.'))
  }, [])

  useEffect(() => {
    if (mode === 'replay') return
    let cancelled = false
    fetch(`/api/shops?mode=${mode === 'judge' ? 'simulated' : mode}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        const list: ShopOption[] = d.shops ?? []
        setShops(list)
        setPicked(mode === 'judge' ? JUDGE_PICKS.filter((id) => list.some((s) => s.id === id)) : list.filter((s) => s.callable).slice(0, config?.maxCalls ?? 5).map((s) => s.id))
      })
      .catch(() => !cancelled && setFail('Could not load shops.'))
    return () => {
      cancelled = true
    }
  }, [mode, config?.maxCalls])

  const set = (k: keyof typeof EMPTY, v: string) => {
    setF((p) => ({ ...p, [k]: v }))
    setErrors((e) => ({ ...e, [k]: '' }))
    setUnderstood(sentence.trim()) // a hand edit wins: "Find for me" won't re-read the sentence over it
  }
  const liveBlocked = !!config && (config.live.blockers.length > 0 || !config.live.inWindow)

  function check() {
    const e: Record<string, string> = {}
    if (!f.product.trim()) e.product = 'What should we ask for?'
    const q = Number(f.quantity)
    if (!(q > 0 && q <= 1000)) e.quantity = 'Enter a quantity between 0.01 and 1000'
    if (!f.city.trim()) e.city = 'Which city?'
    if (!f.area.trim()) e.area = 'Which area or neighbourhood?'
    if (f.max_budget_inr && !(Number(f.max_budget_inr) > 0)) e.max_budget_inr = 'Enter a positive amount'
    setErrors(e)
    return !Object.keys(e).length
  }

  async function start() {
    setBusy(true)
    setFail(null)
    const body =
      mode === 'replay'
        ? { mode, replay_id: replayId }
        : { ...f, mode, shop_ids: picked, confirm_live: mode === 'live' ? consent : undefined, max_budget_inr: f.max_budget_inr || null, need_within_minutes: f.need_within_minutes || null, asked_in: heard?.lang ?? null, stop_when_found: stopWhenFound, medicine_id: med?.id ?? null, ask_alternative: !!(med?.allowed && askAlt) }
    if (mode === 'live') token.set(op)
    try {
      const r = await fetch('/api/searches', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(mode === 'live' ? { 'x-admin-token': op } : {}) }, body: JSON.stringify(body) })
      const d = await r.json()
      if (!r.ok) {
        setErrors(d.errors ?? {})
        if (d.errors) setStep('form')
        throw new Error(d.error ?? 'Could not start the search.')
      }
      router.push(`/search/${d.id}`)
    } catch (e) {
      setFail((e as Error).message)
      setBusy(false)
    }
  }

  // Sarvam returns the detected language and fields understood from the whole sentence; otherwise the local
  // parser picks out product, quantity, unit and place. Either way the user reviews every field before any call.
  function onHeard(text: string, sarvam?: Heard, spoken = true) {
    if (spoken) setSentence(text)
    setUnderstood(text)
    const p: Record<string, string | number> = sarvam?.fields && Object.keys(sarvam.fields).length ? sarvam.fields : parseSentence(text)
    const filled = (Object.keys(EMPTY) as (keyof typeof EMPTY)[]).filter((k) => p[k] !== undefined && k !== 'language')
    const lang = sarvam?.language
    // A new sentence describes a new request: what the last one filled is cleared; budget, deadline and notes stay.
    const cleared = { product: '', brand_or_variant: '', quantity: '1', unit: 'piece', category: '', city: '', area: '' }
    setF((prev) => ({ ...prev, ...cleared, ...Object.fromEntries(filled.map((k) => [k, String(p[k])])), ...(lang === 'en-IN' ? { language: 'en' as Lang } : lang === 'hi-IN' ? { language: 'hi' as Lang } : {}) }))
    setErrors({})
    setHeard(spoken ? { text, filled: filled.map((k) => k.replace(/_/g, ' ')), lang } : null)
  }

  // A typed sentence goes through the same Sarvam step as a spoken one (capped; the local parser if unavailable).
  async function understandTyped() {
    const text = sentence.trim()
    setParsing(true)
    const r = await fetch('/api/understand', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': token.get() }, body: JSON.stringify({ text }) }).catch(() => null)
    const d = r?.ok ? await r.json().catch(() => null) : null
    onHeard(text, d?.fields ? { language: null, fields: d.fields } : undefined, false)
    setParsing(false)
  }
  const fresh = sentence.trim() !== '' && sentence.trim() !== understood // typed, not yet turned into fields
  // What was understood, as chips; tapping one opens the details. Required ones that are missing say so.
  const chips: [string, string, boolean][] = [
    ['product', f.product, true],
    ['variant', f.brand_or_variant, false],
    ['quantity', f.quantity && `${f.quantity} ${f.unit}`, true],
    ['area', f.area, true],
    ['city', f.city, true],
    ['category', f.category, false],
    ['budget', f.max_budget_inr && `up to ₹${f.max_budget_inr}`, false],
    ['ready', f.need_within_minutes && `within ${f.need_within_minutes} min`, false],
  ]

  if (mode === 'replay' || step === 'form')
    return (
      <div className="rise rounded-2xl border border-line bg-card p-5 shadow-[0_1px_0_#e3d8c4,0_18px_40px_-24px_rgb(28_25_21/0.35)] sm:p-7">
        <ModeSwitch
          mode={mode}
          setMode={(m) => {
            setMode(m)
            setStep('form')
            setFail(null)
          }}
          config={config}
          liveBlocked={liveBlocked}
        />
        {liveBlocked && config && (
          <p className="mt-2 text-xs text-muted">
            Live is locked: {config.live.blockers.length ? config.live.blockers.join('; ') : `calls are only placed ${config.live.window} IST`}.
          </p>
        )}

        {mode === 'replay' ? (
          <div className="mt-6 space-y-3">
            <p className="text-muted">Replays play back a saved, sanitised run through the same screens. No calls are made.</p>
            {config?.replays.length ? (
              config.replays.map((r) => (
                <label key={r.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${replayId === r.id ? 'border-indigo bg-indigo-soft' : 'border-line bg-white'}`}>
                  <input type="radio" name="replay" className="mt-1.5 accent-indigo" checked={replayId === r.id} onChange={() => setReplayId(r.id)} />
                  <span>
                    <span className="block font-semibold">{r.title}</span>
                    <span className="text-sm text-muted">
                      Recorded {new Date(r.recorded_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} · from a {r.source === 'live' ? 'real (LIVE)' : 'SIMULATED'} run
                    </span>
                  </span>
                </label>
              ))
            ) : (
              <p className="rounded-xl border border-dashed border-line p-4 text-muted">No replays saved yet. Record one from a finished run with <code className="font-mono text-sm">npm run replay:export</code>.</p>
            )}
            <button className="w-full rounded-xl bg-indigo px-5 py-3.5 text-lg font-semibold text-white disabled:opacity-40" disabled={!replayId || busy} onClick={start}>
              {busy ? 'Starting…' : 'Play replay'}
            </button>
          </div>
        ) : (
          <form
            className="mt-6 grid grid-cols-6 gap-x-4 gap-y-4"
            noValidate
            onSubmit={async (e) => {
              e.preventDefault()
              if (fresh) return void (await understandTyped()) // first turn the sentence into fields to check
              if (check()) setStep('review')
              else setDetails(true) // show the fields that need fixing
            }}
          >
            <div className="col-span-6">
              <div className="flex items-end justify-between gap-3">
                <label htmlFor="sentence" className={label}>
                  What do you need, and where?
                </label>
                <VoiceButton lang={f.language} speech={config?.speech ?? 'browser'} onText={onHeard} />
              </div>
              <input id="sentence" className={`${field} text-lg`} placeholder="2 packet Amul Butter, Kothrud, Pune" value={sentence} onChange={(e) => setSentence(e.target.value)} autoComplete="off" />
              <p className="mt-1 text-sm text-muted">Type or say it, in any of 11 Indian languages: &ldquo;Dolo 650, 1 strip, Kothrud, Pune&rdquo;. You check every detail before anything is called.</p>
              {heard && (
                <p className="mt-2 rounded-lg bg-marigold-soft px-3 py-2 text-sm">
                  Heard{heard.lang ? ` (${VOICE_LANGS[heard.lang]})` : ''}: <q>{heard.text}</q>.{' '}
                  {heard.filled.length ? `Filled ${heard.filled.join(', ')} from your voice. Please check them.` : 'Could not pick out the fields, so please type them.'}
                </p>
              )}
            </div>
            {understood && (
              <ul className="col-span-6 flex flex-wrap gap-2" aria-label="What we understood: tap to change">
                {chips.map(([k, v, needed]) =>
                  v || needed ? (
                    <li key={k}>
                      <button type="button" onClick={() => setDetails(true)} className={`rounded-full border px-3 py-1.5 text-sm ${v ? 'border-ink bg-white font-semibold' : 'border-dashed border-chili text-chili'}`}>
                        <span className="mr-1 font-normal text-muted">{k}</span>
                        {v || 'add'}
                      </button>
                    </li>
                  ) : null,
                )}
                <li className="self-center text-sm text-muted">· calls in {CALL_LANGS[f.language].name} unless a shop speaks another language</li>
              </ul>
            )}
            {medList && medQ.length >= 3 && (
              <div className="col-span-6 rounded-xl border border-line bg-white p-3 text-sm">
                {!medList.length ? (
                  <p className="text-muted">No composition found for &ldquo;{medQ}&rdquo;, so the shops are asked for this name only.</p>
                ) : (
                  <>
                    <label htmlFor="med" className="font-semibold">
                      Which medicine?
                    </label>
                    <select id="med" className={`${field} mt-1`} value={med?.id ?? 'none'} onChange={(e) => setMedPick(e.target.value === 'none' ? 'none' : Number(e.target.value))}>
                      {medList.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                      <option value="none">None of these</option>
                    </select>
                    {med && (
                      <>
                        <p className="mt-2">
                          Composition: <strong>{[med.composition, med.strength].filter(Boolean).join(' ')}{med.form && ` · ${med.form}`}</strong>
                        </p>
                        {med.allowed ? (
                          <label className="mt-2 flex items-start gap-2">
                            <input type="checkbox" className="mt-0.5 size-4 accent-ink" checked={askAlt} onChange={(e) => setAskAlt(e.target.checked)} />
                            <span>If they don&apos;t have this brand, ask for the same composition</span>
                          </label>
                        ) : (
                          <p className="mt-2 font-semibold text-chili">{NO_ALTERNATIVES}</p>
                        )}
                      </>
                    )}
                    <p className="mt-2 text-xs text-muted">{MEDICINE_CREDIT}</p>
                  </>
                )}
              </div>
            )}
            <button type="button" className="col-span-6 justify-self-start text-left text-sm font-semibold text-indigo underline-offset-2 hover:underline" onClick={() => setDetails(!details)} aria-expanded={details}>
              {details ? 'Hide details' : 'Edit details: product, quantity, place, budget, deadline, notes'}
            </button>
            {details && (
              <>
            <Field className="col-span-6" id="product" lbl="Product" err={errors.product}>
              <input id="product" className={field} placeholder="e.g. Amul Butter" value={f.product} onChange={(e) => set('product', e.target.value)} aria-invalid={!!errors.product} autoComplete="off" />
            </Field>
            <Field className="col-span-6 sm:col-span-3" id="brand" lbl="Brand / variant (optional)">
              <input id="brand" className={field} placeholder="500g" value={f.brand_or_variant} onChange={(e) => set('brand_or_variant', e.target.value)} />
            </Field>
            <Field className="col-span-6 sm:col-span-3" id="category" lbl="Category">
              <select id="category" className={field} value={f.category} onChange={(e) => set('category', e.target.value)}>
                <option value="">Choose…</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c[0].toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </select>
            </Field>
            <Field className="col-span-6 sm:col-span-3" id="qty" lbl="Quantity" err={errors.quantity}>
              <input id="qty" type="number" inputMode="decimal" min="0.01" max="1000" step="any" className={`${field} tabular`} value={f.quantity} onChange={(e) => set('quantity', e.target.value)} aria-invalid={!!errors.quantity} />
            </Field>
            <Field className="col-span-6 sm:col-span-3" id="unit" lbl="Unit">
              <select id="unit" className={field} value={f.unit} onChange={(e) => set('unit', e.target.value)}>
                {UNITS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </Field>
            <Field className="col-span-6 sm:col-span-3" id="city" lbl="City" err={errors.city}>
              <input id="city" className={field} placeholder="Pune" value={f.city} onChange={(e) => set('city', e.target.value)} aria-invalid={!!errors.city} />
            </Field>
            <Field className="col-span-6 sm:col-span-3" id="area" lbl="Area / neighbourhood" err={errors.area}>
              <input id="area" className={field} placeholder="Kothrud" value={f.area} onChange={(e) => set('area', e.target.value)} aria-invalid={!!errors.area} />
            </Field>
            <Field className="col-span-6 sm:col-span-3" id="budget" lbl="Max budget, ₹ (optional)" err={errors.max_budget_inr}>
              <input id="budget" type="number" inputMode="numeric" min="1" className={`${field} tabular`} placeholder="No limit" value={f.max_budget_inr} onChange={(e) => set('max_budget_inr', e.target.value)} />
            </Field>
            <Field className="col-span-6 sm:col-span-3" id="within" lbl="Need it ready">
              <select id="within" className={field} value={f.need_within_minutes} onChange={(e) => set('need_within_minutes', e.target.value)}>
                {WITHIN.map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <fieldset className="col-span-6">
              <legend className={label}>Call the shops in (each shop is called in its own language when the assistant speaks it)</legend>
              <div className="inline-flex rounded-xl border border-line bg-white p-1">
                {(Object.keys(LANGS) as Lang[]).map((l) => (
                  <label key={l} className={`cursor-pointer rounded-lg px-5 py-2 font-semibold ${f.language === l ? 'bg-ink text-paper' : 'text-muted'}`}>
                    <input type="radio" name="language" className="sr-only" checked={f.language === l} onChange={() => set('language', l)} />
                    <span lang={l}>{l === 'hi' ? 'हिन्दी' : 'English'}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <Field className="col-span-6" id="constraints" lbl="Anything else? (optional, saved with the request; the call itself asks about stock, price and holding)">
              <textarea id="constraints" rows={2} maxLength={300} className={field} placeholder="e.g. sealed pack only" value={f.constraints} onChange={(e) => set('constraints', e.target.value)} />
            </Field>
              </>
            )}
            {fail && <p className="col-span-6 rounded-lg bg-chili-soft px-3 py-2 text-chili" role="alert">{fail}</p>}
            <button type="submit" className="col-span-6 rounded-xl bg-ink px-5 py-4 text-lg font-semibold text-paper transition hover:bg-ink/90 disabled:opacity-40" disabled={!config || parsing || (!fresh && !understood && !details)}>
              {fresh ? 'Next: check the details →' : 'Find for me →'}
            </button>
          </form>
        )}
      </div>
    )

  // ---------- review: exactly which shops will be called ----------
  const n = picked.length
  const judge = mode === 'judge'
  const max = judge ? 2 : (config?.maxCalls ?? 5) // judge mode: up to 2 simulated shops besides the judge's own
  const canStart = n > 0 && !busy && (mode !== 'live' || (consent && op.length >= 12 && !liveBlocked))
  return (
    <div className="rise space-y-5 rounded-2xl border border-line bg-card p-5 shadow-[0_18px_40px_-24px_rgb(28_25_21/0.35)] sm:p-7">
      <ModeBanner mode={mode} />
      <div>
        <p className="text-sm font-semibold uppercase tracking-widest text-muted">Review before we call</p>
        <h2 className="mt-1 font-display text-3xl leading-tight">
          {qtyLabel(Number(f.quantity), f.unit)} · {f.product}
          {f.brand_or_variant && <span className="text-muted"> ({f.brand_or_variant})</span>}
        </h2>
        <p className="mt-1 text-muted">
          Near {f.area}, {f.city}
          {f.need_within_minutes && ` · ready within ${f.need_within_minutes} min`}
          {f.max_budget_inr && ` · up to ₹${f.max_budget_inr}`}
        </p>
        {med && (
          <p className="mt-1 text-sm text-muted">
            Composition: {[med.composition, med.strength, med.form].filter(Boolean).join(' ')}
            {med.allowed && askAlt ? ' · if out of stock, they are asked for the same composition under another brand' : ''}
          </p>
        )}
      </div>
      <fieldset>
        <legend className="mb-2 font-semibold">
          {judge ? 'Simulated shops called alongside yours' : 'Shops to call'} <span className="font-normal text-muted">(up to {max})</span>
        </legend>
        {!shops ? (
          <p className="text-muted">Loading shops…</p>
        ) : !shops.length ? (
          <p className="rounded-xl border border-dashed border-line p-4 text-muted">
            {mode === 'live' ? 'No live test shops yet. Add consenting test numbers to data/shops.local.json and run npm run seed:shops.' : 'No demo shops found.'}
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {shops.map((s) => {
              const on = picked.includes(s.id)
              const full = !on && n >= max
              return (
                <li key={s.id}>
                  <label className={`flex h-full items-start gap-3 rounded-xl border p-3 ${!s.callable ? 'cursor-not-allowed border-line bg-paper/60 opacity-60' : on ? 'cursor-pointer border-ink bg-white' : 'cursor-pointer border-line bg-white/60'}`}>
                    <input type="checkbox" className="mt-1 size-4 accent-ink" disabled={!s.callable || full} checked={on} onChange={() => setPicked((p) => (on ? p.filter((x) => x !== s.id) : [...p, s.id]))} />
                    <span>
                      <span className="block font-semibold">{s.name}</span>
                      <span className="text-sm text-muted">
                        {s.area} · {s.note} · called in {CALL_LANGS[callLanguage(s.language, f.language)].name}
                      </span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
        {judge && (
          <p className="mt-2 rounded-xl border-2 border-plum bg-plum/10 p-3">
            <span className="block font-semibold">Your shop</span>
            <span className="text-sm text-muted">You answer this call in your browser (microphone needed) · called in {CALL_LANGS[f.language].name}</span>
          </p>
        )}
      </fieldset>
      {judge ? (
        <p className="text-sm text-muted">
          After you start, tap <strong>Answer the call</strong> on your card. The assistant asks Your shop about {f.product}: answer the way a shopkeeper would. Your answers are ranked
          against the simulated shops&apos;. The transcript is visible to anyone with this search&apos;s link; no recording is played back. Calls are capped per visitor per day.
        </p>
      ) : (
      <label className="flex items-start gap-3 rounded-xl border border-line bg-white p-3">
        <input type="checkbox" className="mt-1 size-4 accent-ink" checked={stopWhenFound} onChange={(e) => setStopWhenFound(e.target.checked)} />
        <span>
          Stop calling once a shop confirms it has all of it and will hold it <span className="text-muted">— saves shopkeepers&apos; time and credits</span>
        </span>
      </label>
      )}
      <p className="text-sm text-muted">
        All selected shops are called at the same time, as many as there are free lines. Each call takes about 45 seconds. The assistant says it is an AI first, asks about stock, price and holding, and never shares your
        number. Failed calls are not retried automatically.
      </p>
      {mode === 'live' && (
        <div className="space-y-3 rounded-xl border-2 border-chili/40 bg-chili-soft/50 p-4">
          {!config?.live.inWindow && <p className="font-semibold text-chili">Live calls are only placed between {config?.live.window} IST.</p>}
          <div>
            <label htmlFor="op" className={label}>
              Operator token
            </label>
            <input id="op" type="password" autoComplete="off" className={field} value={op} onChange={(e) => setOp(e.target.value)} placeholder="POOCHHO_ADMIN_TOKEN from .env.local" />
          </div>
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1 size-5 accent-chili" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              I confirm these {n} shop{n === 1 ? '' : 's'} agreed to receive an AI call for this test, and I authorise <strong>{n} real call{n === 1 ? '' : 's'}</strong>, which use Bolna credits.
            </span>
          </label>
        </div>
      )}
      {fail && <p className="rounded-lg bg-chili-soft px-3 py-2 text-chili" role="alert">{fail}</p>}
      <div className="flex gap-3">
        <button className="rounded-xl border border-line bg-white px-5 py-3.5 font-semibold" onClick={() => setStep('form')} disabled={busy}>
          ← Edit
        </button>
        <button className={`flex-1 rounded-xl px-5 py-3.5 text-lg font-semibold text-white disabled:opacity-40 ${mode === 'live' ? 'bg-chili' : judge ? 'bg-plum' : 'bg-kirana'}`} disabled={!canStart} onClick={start}>
          {busy ? 'Starting calls…' : judge ? `Start: ${n} simulated call${n === 1 ? '' : 's'} + yours` : `${mode === 'live' ? 'Place' : 'Simulate'} ${n} call${n === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  )
}

function ModeSwitch({ mode, setMode, config, liveBlocked }: { mode: Mode; setMode: (m: Mode) => void; config: Config | null; liveBlocked: boolean }) {
  const opts: { m: Mode; title: string; sub: string; off?: string }[] = [
    { m: 'simulated', title: 'Simulated', sub: 'Scripted demo, no phones ring' },
    { m: 'live', title: 'Live', sub: 'Real calls to test shops', off: liveBlocked ? (config?.live.blockers.length ? `Not configured: ${config.live.blockers.join('; ')}` : `Only ${config?.live.window} IST`) : undefined },
    { m: 'replay', title: 'Replay', sub: 'Play back a recorded run' },
    ...(config?.judge ? [{ m: 'judge' as const, title: 'Judge', sub: 'You be the shopkeeper' }] : []),
  ]
  return (
    <fieldset>
      <legend className="sr-only">Mode</legend>
      <div className={`grid gap-2 ${opts.length === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
        {opts.map((o) => (
          <label key={o.m} className={`rounded-xl border-2 px-3 py-2.5 ${mode === o.m ? (o.m === 'live' ? 'border-chili bg-chili-soft' : o.m === 'replay' ? 'border-indigo bg-indigo-soft' : o.m === 'judge' ? 'border-plum bg-plum/10' : 'hatch border-marigold bg-marigold-soft') : 'border-line bg-white'} ${o.off ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
            <input type="radio" name="mode" className="sr-only" checked={mode === o.m} disabled={!!o.off && o.m === 'live'} onChange={() => setMode(o.m)} />
            <span className="block font-semibold">{o.title}</span>
            <span className="block text-xs leading-snug text-muted">{o.off && o.m === 'live' ? 'Locked (see below)' : o.sub}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function Field({ id, lbl, err, className, children }: { id: string; lbl: string; err?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={id} className={label}>
        {lbl}
      </label>
      {children}
      <Err id={`${id}-err`} msg={err} />
    </div>
  )
}

const Err = ({ id, msg }: { id: string; msg?: string }) =>
  msg ? (
    <p id={id} className="mt-1 text-sm text-chili" role="alert">
      {msg}
    </p>
  ) : null

// Voice input: Sarvam STT (server) when configured, otherwise the browser's speech recognition.
const noop = () => () => {}
type Heard = { language: VoiceLang | null; fields: Record<string, string | number> | null }
type Recognition = { lang: string; interimResults: boolean; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; onerror: () => void; onend: () => void; start: () => void }
function VoiceButton({ lang, speech, onText }: { lang: Lang; speech: 'sarvam' | 'browser'; onText: (t: string, sarvam?: Heard) => void }) {
  const [state, setState] = useState<'idle' | 'listening' | 'working' | 'error'>('idle')
  const [why, setWhy] = useState<string | null>(null) // the server's reason, e.g. today's voice inputs are used up
  const rec = useRef<MediaRecorder | null>(null)
  // Browser-only capabilities ('' on the server): s = Sarvam (open to everyone within daily caps; the operator is
  // not capped), b = the browser's own speech recognition, used when Sarvam isn't configured or is capped for today.
  const caps = useSyncExternalStore(
    noop,
    () => {
      const w = window as unknown as Record<string, unknown>
      return (speech === 'sarvam' && typeof navigator.mediaDevices?.getUserMedia === 'function' ? 's' : '') + (w.SpeechRecognition || w.webkitSpeechRecognition ? 'b' : '')
    },
    () => '',
  )
  const [sarvamOff, setSarvamOff] = useState(false)
  const how = caps.includes('s') && !sarvamOff ? 'sarvam' : caps.includes('b') ? 'browser' : null
  if (!how) return null

  async function go() {
    if (state === 'listening' && rec.current) return rec.current.stop()
    if (how === 'browser') {
      const w = window as unknown as Record<string, new () => Recognition>
      const r = new (w.SpeechRecognition || w.webkitSpeechRecognition)()
      r.lang = lang === 'hi' ? 'hi-IN' : 'en-IN'
      r.interimResults = false
      r.onresult = (e) => onText(e.results[0][0].transcript)
      r.onerror = () => setState('error')
      r.onend = () => setState((s) => (s === 'error' ? s : 'idle'))
      setState('listening')
      return r.start()
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const chunks: Blob[] = []
      const mr = new MediaRecorder(stream)
      rec.current = mr
      mr.ondataavailable = (e) => chunks.push(e.data)
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        setState('working')
        const fd = new FormData()
        fd.append('audio', new Blob(chunks, { type: mr.mimeType || 'audio/webm' }))
        const r = await fetch('/api/stt', { method: 'POST', body: fd, headers: { 'x-admin-token': token.get() } }).catch(() => null)
        const d = r && (await r.json().catch(() => null))
        if (r?.status === 429 || r?.status === 501) setSarvamOff(true) // capped for today: fall back to the browser
        setWhy(r && !r.ok ? `${d?.error ?? 'Voice input failed.'} ${caps.includes('b') ? "Tap again to use this browser's speech." : 'Please type your request.'}` : null)
        if (r?.ok && d?.transcript) {
          onText(d.transcript, d)
          setState('idle')
        } else setState('error')
      }
      mr.start()
      setState('listening')
      setTimeout(() => mr.state === 'recording' && mr.stop(), 15_000)
    } catch {
      setState('error')
    }
  }
  return (
    <button type="button" onClick={go} className={`mb-1.5 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold ${state === 'listening' ? 'border-chili bg-chili text-white' : 'border-line bg-white text-ink'}`} aria-live="polite">
      <span aria-hidden>{state === 'listening' ? '■' : '🎙'}</span>
      {state === 'listening' ? 'Listening… tap to stop' : state === 'working' ? 'Transcribing…' : state === 'error' ? (why ?? "Didn't catch that, try again") : how === 'sarvam' ? 'Speak in any Indian language' : 'Speak (browser)'}
    </button>
  )
}
