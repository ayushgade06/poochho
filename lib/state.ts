import { isUsableQuote, parseExtraction } from './extraction'
import type { CallStatus, Execution, Extraction, ProviderEvent } from './types'

// Bolna execution statuses → internal model. Unknown statuses are ignored (data still merges).
const MAP: Record<string, CallStatus> = {
  scheduled: 'dispatching',
  prepared: 'dispatching',
  queued: 'dispatching',
  initiated: 'dispatching',
  ringing: 'ringing',
  'in-progress': 'talking',
  'call-disconnected': 'processing',
  completed: 'done',
  busy: 'failed',
  'no-answer': 'failed',
  failed: 'failed',
  canceled: 'failed',
  cancelled: 'failed',
  stopped: 'failed',
  error: 'failed',
  'balance-low': 'failed',
  rescheduled: 'failed', // provider guardrails pushed it outside the window: we never follow up a call later
  // Synthetic statuses raised by Poochho itself (never sent by the provider).
  __timeout: 'timeout',
  __failed: 'failed',
}
const RANK: Record<CallStatus, number> = { queued: 0, dispatching: 1, ringing: 2, talking: 3, processing: 4, timeout: 4, done: 5, failed: 5 }

export const mapStatus = (s: string): CallStatus | null => MAP[s?.toLowerCase?.()] ?? null
export const isTerminal = (s: CallStatus) => s === 'done' || s === 'failed'
export const ACTIVE: CallStatus[] = ['dispatching', 'ringing', 'talking', 'processing']

type State = Pick<Execution, 'status' | 'transcript' | 'extracted' | 'duration_seconds' | 'answered_at' | 'ended_at' | 'first_quote_at'>

// Pure merge of one provider event into the stored state. Returns null when nothing changes, which makes
// duplicate deliveries no-ops. Rules: status only moves forward; done/failed are final; our own "timeout"
// yields only to a real provider outcome; transcripts only grow; a final ("completed") extraction wins.
export function mergeEvent(cur: State, ev: ProviderEvent, now: string) {
  const patch: Partial<Execution> = {}
  // Bolna: "completed" with conversation_duration 0 means no conversation took place.
  const silent = mapStatus(ev.status) === 'done' && ev.duration === 0
  const mapped = ev.answered_by_voice_mail || silent ? 'failed' : mapStatus(ev.status)
  if (mapped && !isTerminal(cur.status)) {
    const moves =
      cur.status === 'timeout' ? isTerminal(mapped) || mapped === 'processing' : mapped === 'timeout' || RANK[mapped] > RANK[cur.status]
    if (moves && mapped !== cur.status) {
      patch.status = mapped
      if (!ev.status.startsWith('__')) patch.provider_status = ev.status
      if (mapped === 'talking' && !cur.answered_at) patch.answered_at = now
      if ((mapped === 'processing' || isTerminal(mapped)) && !cur.ended_at) patch.ended_at = now
      if (mapped === 'failed')
        patch.error = ev.answered_by_voice_mail ? 'voicemail'
          : silent ? 'call completed without a conversation'
          : ev.status === 'rescheduled' ? 'provider rescheduled it outside calling hours; not followed up'
          : ev.status === 'balance-low' ? 'Bolna wallet balance too low'
          : ev.error_message || ev.status
      if (mapped === 'timeout') patch.error = 'No provider update before the watchdog deadline'
      if (mapped === 'done') patch.error = null
    }
  }
  if (ev.transcript && ev.transcript !== cur.transcript && ev.transcript.length >= (cur.transcript?.length ?? 0)) patch.transcript = ev.transcript
  if (typeof ev.duration === 'number' && ev.duration > (cur.duration_seconds ?? -1)) patch.duration_seconds = ev.duration
  const x = parseExtraction(ev.extracted_data)
  // Field-by-field: Postgres jsonb reorders keys, so string comparison would call every duplicate a change.
  const same = x && cur.extracted && (Object.keys(x) as (keyof Extraction)[]).every((k) => x[k] === cur.extracted![k])
  if (x && !same && (!cur.extracted || mapStatus(ev.status) === 'done')) {
    patch.extracted = x
    patch.raw_extracted = ev.extracted_data
    if (!cur.first_quote_at && isUsableQuote(x)) patch.first_quote_at = now
  }
  return Object.keys(patch).length ? patch : null
}
