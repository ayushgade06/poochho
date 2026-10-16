import { describe, expect, it } from 'vitest'
import { sanitize, toEvent } from '@/lib/bolna'

// Shaped like a real Bolna execution (2026-10-16; numbers and ids changed): costs in US cents, phone numbers, and
// the recording behind a link that needs no auth.
const exec = {
  id: 'exec-1',
  status: 'completed',
  conversation_duration: 78,
  total_cost: 9,
  transcript: 'assistant: hi',
  cost_breakdown: { llm: 0.594, network: 0.75, platform: 3, synthesizer: 5.59, transcriber: 1.224, total_cost_to_deduct: 1.592 },
  telephony_data: { duration: '78', to_number: '+919999999999', from_number: '+918888888888', recording_url: 'https://api.bolna.ai/recordings/call/exec-1', hangup_by: 'Agent' },
  context_details: { recipient_data: { poochho_execution_id: 'ours' }, recipient_phone_number: '+919999999999' },
}

describe('toEvent', () => {
  it('reads the call cost in US cents from total_cost, the amount the wallet was charged', () => {
    expect(toEvent(exec)).toMatchObject({ id: 'exec-1', ourId: 'ours', status: 'completed', duration: 78, cost: 9 })
    expect(toEvent({ ...exec, total_cost: '6' })?.cost).toBe(6)
    expect(toEvent({ ...exec, total_cost: null })?.cost).toBeNull()
    expect(toEvent({ ...exec, total_cost: -1 })?.cost).toBeNull()
  })
})

describe('sanitize', () => {
  it('keeps the total cost but drops phone numbers, the recording link and the cost breakdown', () => {
    const s = sanitize(exec)!
    expect(s).toMatchObject({ id: 'exec-1', total_cost: 9, telephony_data: { duration: '78', hangup_by: 'Agent' } })
    expect(JSON.stringify(s)).not.toMatch(/recording|\+91|total_cost_to_deduct|recipient/)
  })
})
