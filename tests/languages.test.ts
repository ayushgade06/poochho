import { describe, expect, it } from 'vitest'
import { parseExtraction, quoteHeard } from '@/lib/extraction'
import { DEMO_SHOPS, quoteScript } from '@/lib/sim'
import { CALL_LANGS, callLanguage } from '@/lib/types'
import { readFileSync } from 'node:fs'

describe('callLanguage', () => {
  it("calls a shop in its own language when the agent speaks it, otherwise in the request's", () => {
    expect(callLanguage('mr', 'hi')).toBe('mr')
    expect(callLanguage('en', 'hi')).toBe('en')
    expect(callLanguage('ta', 'hi')).toBe('hi') // not on the agent yet: Bolna would refuse it
    expect(callLanguage('ta', 'en')).toBe('en')
    expect(callLanguage('toString', 'hi')).toBe('hi') // only real keys count
  })
})

describe('greetings (the agent welcome message is {greeting})', () => {
  it('says it is an AI and that the call is recorded, in every call language', () => {
    expect(readFileSync('data/bolna-welcome.txt', 'utf8').trim()).toBe('{greeting}')
    for (const [lang, { greeting }] of Object.entries(CALL_LANGS)) {
      expect(greeting, lang).toMatch(/\bAI\b/)
      expect(greeting, lang).toMatch(/record/)
    }
  })
})

describe('a simulated call to a Marathi-speaking shop', () => {
  it('is scripted in Marathi, and its quoted words pass the transcript check', () => {
    const patil = DEMO_SHOPS.find((s) => s.language === 'mr')!
    const done = quoteScript(patil, { product: 'Amul Butter', brand_or_variant: '500g', category: 'grocery', quantity: 2, unit: 'packet', area: 'Kothrud' }, 'mr', 'sim-1').at(-1)!.payload
    const transcript = String(done.transcript)
    expect(transcript.startsWith(`assistant: ${CALL_LANGS.mr.greeting}`)).toBe(true)
    const x = parseExtraction(done.extracted_data)!
    expect(x.stock_quote).toBe('आत्ता फक्त 1 packet आहे.')
    expect(quoteHeard(x.stock_quote, transcript)).toBe(true)
  })
})
