'use client'

import { useState } from 'react'
import { LABEL_FIELDS } from '@/lib/metrics'
import type { Extraction } from '@/lib/types'
import { field, token } from './ui'

type Call = {
  id: string
  transcript: string | null
  extracted: Extraction | null
  created_at: string
  shops: { name: string } | null
  search_requests: { product: string; quantity: number; unit: string } | null
  result_labels: { field: string; is_correct: boolean; correct_value: string | null }[]
}

// Operator tool: mark each extracted field right or wrong against the transcript. Feeds "extraction accuracy".
export default function Labeler({ mode }: { mode: string }) {
  const [op, setOp] = useState(() => token.get())
  const [calls, setCalls] = useState<Call[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const headers = () => ({ 'x-admin-token': op, 'Content-Type': 'application/json' })

  async function load() {
    setErr(null)
    token.set(op)
    const r = await fetch(`/api/labels?mode=${mode}`, { headers: headers() })
    const d = await r.json().catch(() => ({}))
    if (r.ok) setCalls(d.calls)
    else setErr(d.error ?? 'Could not load calls.')
  }

  async function exportCsv() {
    setErr(null)
    token.set(op)
    const r = await fetch(`/api/metrics/export?mode=${mode}`, { headers: headers() })
    if (!r.ok) return setErr((await r.json().catch(() => ({}))).error ?? 'Export failed.')
    const url = URL.createObjectURL(await r.blob())
    const a = Object.assign(document.createElement('a'), { href: url, download: `poochho-${mode}-calls.csv` })
    a.click()
    URL.revokeObjectURL(url)
  }

  async function mark(c: Call, f: string, isCorrect: boolean, correct: string | null = null) {
    const r = await fetch('/api/labels', { method: 'POST', headers: headers(), body: JSON.stringify({ execution_id: c.id, field: f, is_correct: isCorrect, correct_value: correct }) })
    if (!r.ok) return setErr((await r.json().catch(() => ({}))).error ?? 'Could not save the label.')
    setCalls((cs) => cs?.map((x) => (x.id === c.id ? { ...x, result_labels: [...x.result_labels.filter((l) => l.field !== f), { field: f, is_correct: isCorrect, correct_value: correct }] } : x)) ?? null)
  }

  return (
    <section className="space-y-4 rounded-2xl border border-line bg-card p-5" aria-labelledby="labels">
      <h2 id="labels" className="font-display text-3xl">
        Label extractions
      </h2>
      <p className="text-muted">Operator only: shows transcripts. Compare each extracted value with what the shop actually said.</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <label htmlFor="op-label" className="mb-1.5 block text-sm font-semibold text-muted">
            Operator token
          </label>
          <input id="op-label" type="password" autoComplete="off" className={field} value={op} onChange={(e) => setOp(e.target.value)} />
        </div>
        <button className="rounded-xl bg-ink px-5 py-3 font-semibold text-paper" onClick={load}>
          Load {mode} calls
        </button>
        <button className="rounded-xl border-2 border-ink px-5 py-3 font-semibold" onClick={exportCsv}>
          Export CSV
        </button>
      </div>
      {err && (
        <p className="rounded-lg bg-chili-soft px-3 py-2 text-chili" role="alert">
          {err}
        </p>
      )}
      {calls && !calls.length && <p className="text-muted">No finished {mode} calls to label yet.</p>}
      {calls?.map((c) => (
        <article key={c.id} className="grid gap-4 rounded-xl border border-line bg-white p-4 lg:grid-cols-2">
          <div>
            <h3 className="font-semibold">
              {c.shops?.name} · {c.search_requests?.quantity} {c.search_requests?.unit} {c.search_requests?.product}
            </h3>
            <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-paper p-3 font-sans text-sm leading-relaxed">{c.transcript || 'No transcript stored.'}</pre>
          </div>
          <ul className="space-y-1.5">
            {LABEL_FIELDS.map((f) => {
              const l = c.result_labels.find((x) => x.field === f)
              const v = c.extracted?.[f as keyof Extraction]
              return (
                <li key={f} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="w-36 font-mono text-xs text-muted">{f}</span>
                  <span className="min-w-20 font-semibold">{v === null || v === undefined ? 'null' : String(v)}</span>
                  <button aria-pressed={l?.is_correct === true} className={`rounded-md border px-2 py-0.5 ${l?.is_correct === true ? 'border-kirana bg-kirana text-white' : 'border-line'}`} onClick={() => mark(c, f, true)}>
                    ✓ right
                  </button>
                  <button aria-pressed={l?.is_correct === false} className={`rounded-md border px-2 py-0.5 ${l?.is_correct === false ? 'border-chili bg-chili text-white' : 'border-line'}`} onClick={() => mark(c, f, false, l?.correct_value ?? null)}>
                    ✕ wrong
                  </button>
                  {l?.is_correct === false && (
                    <input aria-label={`Correct value for ${f}`} className="rounded-md border border-line px-2 py-0.5" placeholder="correct value" defaultValue={l.correct_value ?? ''} onBlur={(e) => mark(c, f, false, e.target.value || null)} />
                  )}
                </li>
              )
            })}
          </ul>
        </article>
      ))}
    </section>
  )
}
