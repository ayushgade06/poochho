import { describe, expect, it } from 'vitest'
import { mergeEvent } from '@/lib/state'
import type { Execution } from '@/lib/types'

type S = Pick<Execution, 'status' | 'transcript' | 'extracted' | 'duration_seconds' | 'answered_at' | 'ended_at' | 'first_quote_at'>
const fresh = (o: Partial<S> = {}): S => ({ status: 'dispatching', transcript: null, extracted: null, duration_seconds: null, answered_at: null, ended_at: null, first_quote_at: null, ...o })
const T = '2026-10-16T10:00:00.000Z'
const apply = (s: S, ev: Parameters<typeof mergeEvent>[1]) => ({ ...s, ...(mergeEvent(s, ev, T) ?? {}) }) as S
const quote = { in_stock: 'yes', unit_price_inr: 270, confidence: 'high' }

describe('mergeEvent', () => {
  it('walks the normal lifecycle and stamps timestamps once', () => {
    let s = fresh()
    s = apply(s, { status: 'ringing' })
    expect(s.status).toBe('ringing')
    s = apply(s, { status: 'in-progress' })
    expect(s.status).toBe('talking')
    expect(s.answered_at).toBe(T)
    s = apply(s, { status: 'call-disconnected', transcript: 'assistant: hi' })
    expect(s.status).toBe('processing')
    s = apply(s, { status: 'completed', transcript: 'assistant: hi\nuser: haan', extracted_data: quote, duration: 31 })
    expect(s).toMatchObject({ status: 'done', duration_seconds: 31, ended_at: T, first_quote_at: T })
    expect(s.extracted?.unit_price_inr).toBe(270)
  })

  it('treats duplicate deliveries as no-ops', () => {
    const s = apply(fresh(), { status: 'completed', transcript: 'x', extracted_data: quote, duration: 5 })
    expect(mergeEvent(s, { status: 'completed', transcript: 'x', extracted_data: quote, duration: 5 }, T)).toBeNull()
    expect(mergeEvent(s, { status: 'completed', transcript: 'x', extracted_data: JSON.stringify(quote), duration: 5 }, T)).toBeNull()
    // Same extraction with keys reordered (as Postgres jsonb returns it) is still a duplicate.
    const reordered = Object.fromEntries(Object.entries(s.extracted!).reverse())
    expect(mergeEvent({ ...s, extracted: reordered as typeof s.extracted }, { status: 'completed', extracted_data: s.extracted }, T)).toBeNull()
  })

  it('ignores stale out-of-order events and keeps terminal states final', () => {
    let s = apply(fresh(), { status: 'completed', extracted_data: quote })
    expect(mergeEvent(s, { status: 'ringing' }, T)).toBeNull()
    s = apply(fresh(), { status: 'no-answer' })
    expect(s.status).toBe('failed')
    s = apply(s, { status: 'completed' })
    expect(s.status).toBe('failed')
  })

  it('lets a real provider outcome replace our watchdog timeout, but not a stale non-terminal event', () => {
    let s = apply(fresh({ status: 'talking' }), { status: '__timeout' })
    expect(s.status).toBe('timeout')
    expect(mergeEvent(s, { status: 'ringing' }, T)).toBeNull()
    expect(mergeEvent(s, { status: 'call-disconnected' }, T)).toBeNull() // no processing ↔ timeout flip-flop
    s = apply(s, { status: 'completed', extracted_data: quote })
    expect(s.status).toBe('done')
    expect(mergeEvent(fresh(), { status: '__timeout', error_message: 'Bolna did not confirm the call in time' }, T)?.error).toBe('Bolna did not confirm the call in time')
  })

  it('never shrinks a transcript and records voicemail as a failure', () => {
    const s = apply(fresh(), { status: 'in-progress', transcript: 'assistant: long transcript here' })
    expect(mergeEvent(s, { status: 'in-progress', transcript: 'assistant: short' }, T)).toBeNull()
    const v = apply(fresh(), { status: 'completed', answered_by_voice_mail: true })
    expect(v.status).toBe('failed')
    expect(mergeEvent(fresh(), { status: 'completed', answered_by_voice_mail: true }, T)?.error).toBe('voicemail')
  })

  it('keeps the first extraction unless the final payload brings a different one', () => {
    let s = apply(fresh(), { status: 'call-disconnected', extracted_data: { ...quote, unit_price_inr: 250 } })
    expect(mergeEvent(s, { status: 'in-progress', extracted_data: { ...quote, unit_price_inr: 999 } }, T)).toBeNull()
    s = apply(s, { status: 'completed', extracted_data: quote })
    expect(s.extracted?.unit_price_inr).toBe(270)
  })

  it('applies Bolna semantics: silent "completed", provider reschedules, and non-shrinking durations', () => {
    expect(mergeEvent(fresh({ status: 'processing' }), { status: 'completed', duration: 0 }, T)).toMatchObject({ status: 'failed', error: 'call completed without a conversation' })
    expect(mergeEvent(fresh(), { status: 'rescheduled' }, T)).toMatchObject({ status: 'failed', error: expect.stringContaining('not followed up') })
    expect(mergeEvent(fresh(), { status: 'balance-low' }, T)?.error).toBe('Bolna wallet balance too low')
    const s = apply(fresh(), { status: 'completed', duration: 28, extracted_data: quote })
    expect(mergeEvent(s, { status: 'call-disconnected', duration: 0 }, T)).toBeNull() // late duplicate must not reset it
  })

  it('ignores unknown provider statuses but still merges data', () => {
    const p = mergeEvent(fresh(), { status: 'something-new', transcript: 'assistant: hello' }, T)
    expect(p).toEqual({ transcript: 'assistant: hello' })
  })
})
