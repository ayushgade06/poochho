import type { ProviderEvent } from './types'

// Documented at https://www.bolna.ai/docs/api-reference (base URL, Bearer auth, POST /call, GET /executions/{id}).
const BASE = 'https://api.bolna.ai'

// Bolna answered with an error status: the request was definitely refused. (A timeout or network error is
// different: the call may or may not have been placed.)
export class BolnaHttpError extends Error {}

async function bolna(path: string, init: RequestInit = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.BOLNA_API_KEY}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new BolnaHttpError(`Bolna ${res.status}: ${typeof body?.message === 'string' ? body.message : res.statusText}`)
  return body
}

// Variables match the "Poochho Assistant" prompt in Agent Studio: {greeting} (the welcome message), {shop_name},
// {item}, {quantity}, {customer_area}, {call_purpose}. No retry_config is sent, so Bolna never retries on its own.
export async function startCall(to: string, vars: Record<string, string>, language: string) {
  const body = {
    agent_id: process.env.BOLNA_AGENT_ID,
    recipient_phone_number: to,
    ...(process.env.BOLNA_FROM_NUMBER ? { from_phone_number: process.env.BOLNA_FROM_NUMBER } : {}),
    // Starts the multilingual agent in this language: its transcriber, voice and prompt together. Bolna refuses (400)
    // a language the agent isn't configured for, so only CALL_LANGS keys are ever sent.
    agent_data: { language },
    user_data: { ...vars, timezone: 'Asia/Kolkata' },
  }
  const r = await bolna('/call', { method: 'POST', body: JSON.stringify(body) })
  if (typeof r?.execution_id !== 'string') throw new Error('Bolna accepted the call but returned no execution_id')
  return r.execution_id as string
}

export const getExecution = (id: string) => bolna(`/executions/${encodeURIComponent(id)}`)
export const stopCall = (id: string) => bolna(`/call/${encodeURIComponent(id)}/stop`, { method: 'POST' })

// Call audio. /recordings/call/{id} redirects to a pre-signed S3 link that expires after ~24 h; verified
// 2026-10-16 that it answers without auth too, so Bolna's call id is never sent to the browser. Fetched at play
// time and streamed through; the link itself is never stored. null = no recording (or the call never connected).
export async function getRecording(id: string) {
  // The deadline covers only the wait for Bolna and S3 to answer, not the streaming to a slow phone afterwards.
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 15_000)
  const res = await fetch(`${BASE}/recordings/call/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${process.env.BOLNA_API_KEY}` }, // dropped by fetch on the cross-origin redirect
    signal: ctl.signal,
    cache: 'no-store',
  }).finally(() => clearTimeout(timer))
  if (res.status === 404 || res.status === 403) return null
  if (!res.ok || !res.body) throw new BolnaHttpError(`Bolna recording ${res.status}`)
  return res
}

// Bolna execution object (webhook body == GET /executions/{id}) → normalised event. null if malformed.
// `ourId` is our execution id echoed back in context_details.recipient_data (we send it in user_data), used to
// match a webhook for a call whose provider id we failed to store.
export function toEvent(p: unknown): (ProviderEvent & { id: string; ourId: string | null }) | null {
  if (!p || typeof p !== 'object') return null
  const o = p as Record<string, unknown>
  if (typeof o.id !== 'string' || !o.id || typeof o.status !== 'string') return null
  const tel = (o.telephony_data ?? {}) as Record<string, unknown>
  const ctx = ((o.context_details ?? {}) as Record<string, unknown>).recipient_data as Record<string, unknown> | undefined
  const ourId = typeof ctx?.poochho_execution_id === 'string' ? ctx.poochho_execution_id : null
  const num = (v: unknown) => (v === null || v === undefined || v === '' ? NaN : Number(v)) // number or numeric string
  const dur = num(o.conversation_duration ?? tel.duration) // seconds
  // US cents. total_cost, not cost_breakdown.total_cost_to_deduct as Bolna's docs suggest: on our first two real
  // calls (2026-10-16) the wallet dropped by exactly 9 + 6 = 15 = Σ total_cost, while Σ total_cost_to_deduct was 5.5.
  const cost = num(o.total_cost)
  return {
    id: o.id,
    ourId,
    status: o.status,
    transcript: typeof o.transcript === 'string' ? o.transcript : null,
    extracted_data: o.extracted_data && typeof o.extracted_data === 'object' ? o.extracted_data : null,
    duration: Number.isFinite(dur) ? dur : null,
    error_message: typeof o.error_message === 'string' ? o.error_message : null,
    answered_by_voice_mail: o.answered_by_voice_mail === true,
    cost: Number.isFinite(cost) && cost >= 0 ? cost : null,
  }
}

// What we keep in call_events: no phone numbers, recording links, cost breakdowns or provider internals. The
// call's total cost stays, so a replay of a real run can show what it cost.
export function sanitize(p: unknown) {
  if (!p || typeof p !== 'object') return null
  const o = p as Record<string, unknown>
  const tel = (o.telephony_data ?? {}) as Record<string, unknown>
  const keep = (obj: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]))
  return {
    ...keep(o, ['id', 'status', 'smart_status', 'error_message', 'conversation_duration', 'answered_by_voice_mail', 'transcript', 'extracted_data', 'total_cost', 'created_at', 'initiated_at', 'updated_at']),
    telephony_data: keep(tel, ['duration', 'hangup_by', 'hangup_reason', 'hangup_provider_code', 'provider', 'call_type']),
  }
}
