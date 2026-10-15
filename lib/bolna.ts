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

// Variables match the "Poochho Assistant" prompt in Agent Studio: {shop_name} {item} {quantity} {customer_area}.
// No retry_config is sent, so Bolna never retries on its own (retries need explicit user action).
export async function startCall(to: string, vars: Record<string, string>, language: string, agentId = process.env.BOLNA_AGENT_ID) {
  const body = {
    agent_id: agentId,
    recipient_phone_number: to,
    ...(process.env.BOLNA_FROM_NUMBER ? { from_phone_number: process.env.BOLNA_FROM_NUMBER } : {}),
    // agent_language picks the starting language on multilingual agents; Hindi is the agent default.
    user_data: { ...vars, timezone: 'Asia/Kolkata', ...(language !== 'hi' ? { agent_language: language } : {}) },
  }
  const r = await bolna('/call', { method: 'POST', body: JSON.stringify(body) })
  if (typeof r?.execution_id !== 'string') throw new Error('Bolna accepted the call but returned no execution_id')
  return r.execution_id as string
}

export const getExecution = (id: string) => bolna(`/executions/${encodeURIComponent(id)}`)
export const stopCall = (id: string) => bolna(`/call/${encodeURIComponent(id)}/stop`, { method: 'POST' })

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
  const raw = o.conversation_duration ?? tel.duration // seconds; documented as number or numeric string
  const dur = raw === null || raw === undefined || raw === '' ? NaN : Number(raw)
  return {
    id: o.id,
    ourId,
    status: o.status,
    transcript: typeof o.transcript === 'string' ? o.transcript : null,
    extracted_data: o.extracted_data && typeof o.extracted_data === 'object' ? o.extracted_data : null,
    duration: Number.isFinite(dur) ? dur : null,
    error_message: typeof o.error_message === 'string' ? o.error_message : null,
    answered_by_voice_mail: o.answered_by_voice_mail === true,
  }
}

// What we keep in call_events: no phone numbers, recording links, costs or provider internals.
export function sanitize(p: unknown) {
  if (!p || typeof p !== 'object') return null
  const o = p as Record<string, unknown>
  const tel = (o.telephony_data ?? {}) as Record<string, unknown>
  const keep = (obj: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]))
  return {
    ...keep(o, ['id', 'status', 'smart_status', 'error_message', 'conversation_duration', 'answered_by_voice_mail', 'transcript', 'extracted_data', 'created_at', 'initiated_at', 'updated_at']),
    telephony_data: keep(tel, ['duration', 'hangup_by', 'hangup_reason', 'hangup_provider_code', 'provider', 'call_type']),
  }
}
