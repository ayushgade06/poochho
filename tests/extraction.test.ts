import { describe, expect, it } from 'vitest'
import { isUsableQuote, parseExtraction, parseLive, quoteHeard } from '@/lib/extraction'

describe('parseExtraction', () => {
  it('accepts objects, JSON strings, { value } wrappers and one level of grouping', () => {
    expect(parseExtraction({ in_stock: 'yes', unit_price_inr: 40 })?.unit_price_inr).toBe(40)
    expect(parseExtraction('{"in_stock":"no"}')?.in_stock).toBe('no')
    expect(parseExtraction({ in_stock: { value: 'partial' }, qty_available: { value: '3' } })).toMatchObject({ in_stock: 'partial', qty_available: 3 })
    expect(parseExtraction({ shop_quote: { in_stock: 'yes', total_price_inr: '₹1,250' } })?.total_price_inr).toBe(1250)
  })

  it('reads Bolna dispositions (Category → name → objective/subjective) and derives confidence from provider labels', () => {
    const d = (objective: string | null, subjective: string, confidence_label = 'High') => ({ objective, subjective, confidence_label, confidence: 0.9 })
    const x = parseExtraction({
      'Shop Quote': {
        'In Stock': d('yes', ''),
        total_price_inr: d(null, '540'),
        unit_price_inr: d(null, 'null', 'Medium'), // "null" = not applicable
        ready_in_minutes: d(null, '10', 'Medium'),
        can_hold: d('yes', ''),
        opt_out: d('no', ''),
        brand_or_variant: d(null, ''), // "" = not found
      },
      General: { 'Call Summary': { subjective: 'Shop has butter.' } },
    })!
    expect(x).toMatchObject({ in_stock: 'yes', total_price_inr: 540, unit_price_inr: null, ready_in_minutes: 10, can_hold: 'yes', opt_out: 'no', brand_or_variant: null, confidence: 'high' })
    const low = parseExtraction({ Q: { in_stock: d('yes', '', 'Low'), unit_price_inr: d(null, '20') } })!
    expect(low.confidence).toBe('low')
    const med = parseExtraction({ Q: { in_stock: d('yes', ''), unit_price_inr: d(null, '20', 'Medium') } })!
    expect(med.confidence).toBe('med')
  })

  it('returns null for empty or unrelated payloads', () => {
    for (const v of [null, undefined, '', 'not json', [], {}, { foo: 1 }]) expect(parseExtraction(v)).toBeNull()
  })

  it('keeps unclear numbers unknown instead of guessing', () => {
    const x = parseExtraction({ in_stock: 'yes', unit_price_inr: '500-600', total_price_inr: -5, qty_available: 'a few', ready_in_minutes: 'soon' })!
    expect([x.unit_price_inr, x.total_price_inr, x.qty_available, x.ready_in_minutes]).toEqual([null, null, null, null])
    expect(parseExtraction({ in_stock: 'yes', unit_price_inr: 'Rs. 45.5' })!.unit_price_inr).toBe(45.5)
    // A price of 0 is not a price; a quantity or readiness of 0 is meaningful.
    expect(parseExtraction({ in_stock: 'yes', unit_price_inr: '0', total_price_inr: 0, qty_available: 0, ready_in_minutes: '0' })).toMatchObject({ unit_price_inr: null, total_price_inr: null, qty_available: 0, ready_in_minutes: 0 })
    expect(isUsableQuote(parseExtraction({ in_stock: 'yes', total_price_inr: '0' }))).toBe(false)
  })

  it('maps only exact enum values and defaults conservatively', () => {
    const x = parseExtraction({ in_stock: 'maybe', can_hold: 'sure', pickup_or_delivery: 'both', confidence: 'constructor', opt_out: 'perhaps' })!
    expect(x).toMatchObject({ in_stock: 'unsure', can_hold: 'unknown', pickup_or_delivery: 'unknown', confidence: 'low', opt_out: 'no' })
    expect(parseExtraction({ in_stock: true, can_hold: false, confidence: 'Medium', opt_out: 'YES' })).toMatchObject({ in_stock: 'yes', can_hold: 'no', confidence: 'med', opt_out: 'yes' })
  })

  it('preserves uncertainty when the answer contradicts itself', () => {
    expect(parseExtraction({ in_stock: 'no', qty_available: 4 })!.in_stock).toBe('unsure')
  })

  it('treats placeholder strings as missing', () => {
    expect(parseExtraction({ in_stock: 'yes', brand_or_variant: 'unknown', notes: ' N/A ', stock_quote: 'null' })).toMatchObject({ brand_or_variant: null, notes: null, stock_quote: null })
    expect(parseExtraction({ Q: { in_stock: { objective: 'yes' }, stock_quote: { objective: null, subjective: ' हाँ है ' } } })?.stock_quote).toBe('हाँ है')
  })
})

describe('quoteHeard: a quote is shown only if the shopkeeper really said it', () => {
  const t = [
    'assistant: नमस्ते, क्या आपके पास Amul Butter है, 2 packet?',
    'user: हाँ है,  दो Packet मिल जाएगा।',
    'assistant: इसकी price क्या है?',
    'user: दो packet का',
    'user: पाँच सौ चालीस रुपये.', // the transcriber split one answer on a pause
  ].join('\n')

  it('accepts the exact words, ignoring case, punctuation and spacing', () => {
    expect(quoteHeard('हाँ है, दो packet मिल जाएगा', t)).toBe(true)
    expect(quoteHeard('"हाँ है दो packet मिल जाएगा!"', t)).toBe(true)
    expect(quoteHeard('दो packet का पाँच सौ चालीस रुपये', t)).toBe(true)
  })

  it('rejects paraphrases, translations, the AI’s own words, partial words and stitched turns', () => {
    expect(quoteHeard('हाँ, दो packet है', t)).toBe(false) // reworded
    expect(quoteHeard('Yes, we have 2 packets', t)).toBe(false) // translated
    expect(quoteHeard('क्या आपके पास Amul Butter है', t)).toBe(false) // the assistant said it
    expect(quoteHeard('हाँ है दो Pack', t)).toBe(false) // not a whole word
    expect(quoteHeard('मिल जाएगा दो packet का', t)).toBe(false) // across two separate answers
    expect(quoteHeard('', t)).toBe(false)
    expect(quoteHeard('...', t)).toBe(false)
    expect(quoteHeard('हाँ है', null)).toBe(false)
  })

  it('compares composed and decomposed Unicode alike', () => {
    expect(quoteHeard('Café'.normalize('NFD'), 'user: café ready'.normalize('NFC'))).toBe(true)
  })
})

describe('parseLive: the agent\'s mid-call report, as Bolna substitutes it (strings)', () => {
  it('reads string values and keeps only what was said', () => {
    expect(parseLive({ execution_id: 'x', in_stock: 'yes', qty_available: 'None', price_inr: '540.0', ready_in_minutes: '10', can_hold: 'True' })).toEqual({ in_stock: 'yes', price_inr: 540, ready_in_minutes: 10, can_hold: 'yes' })
    expect(parseLive({ in_stock: 'False', can_hold: 'unknown', price_inr: '' })).toEqual({ in_stock: 'no' })
    expect(parseLive({ in_stock: 'partial', qty_available: '1' })).toEqual({ in_stock: 'partial', qty_available: 1 })
  })

  it('returns null when nothing usable was reported', () => {
    for (const v of [null, 'yes', [], {}, { in_stock: 'maybe', price_inr: '500-600', can_hold: 'None' }, { in_stock: 'constructor' }]) expect(parseLive(v)).toBeNull()
  })
})

describe('isUsableQuote', () => {
  it('needs availability plus a price, or a clear "not in stock"', () => {
    expect(isUsableQuote(parseExtraction({ in_stock: 'no' }))).toBe(true)
    expect(isUsableQuote(parseExtraction({ in_stock: 'yes' }))).toBe(false)
    expect(isUsableQuote(parseExtraction({ in_stock: 'yes', total_price_inr: 90 }))).toBe(true)
    expect(isUsableQuote(parseExtraction({ in_stock: 'unsure', unit_price_inr: 90 }))).toBe(false)
    expect(isUsableQuote(null)).toBe(false)
  })
})

// REAL provider output: Bolna's POST /v2/agent/{id}/dispositions/test response (2026-10-16) for the sample
// transcript in scripts/bolna.mjs. Note the model back-calculated unit_price_inr from the stated total.
import real from './fixtures/bolna-dispositions-test.json'

describe('parseExtraction on a real Bolna response', () => {
  it('reads every Shop Quote answer and the provider confidence', () => {
    expect(parseExtraction(real)).toEqual({
      in_stock: 'yes', unit_price_inr: 270, total_price_inr: 540, price_unit: 'packet', qty_available: 2, brand_or_variant: 'Amul Butter 500g',
      pickup_or_delivery: 'pickup', ready_in_minutes: 10, can_hold: 'yes', opt_out: 'no', confidence: 'high', notes: null, stock_quote: 'हाँ है, दो packet मिल जाएगा',
      alt_available: 'unknown', alt_brand: null, alt_price_inr: null, // recorded before medicine mode
    })
  })

  it('reads another brand with the same composition only when the shop said it has one', () => {
    const alt = (available: string) => parseExtraction({ 'Shop Quote': { in_stock: { objective: 'no' }, alt_available: { objective: available }, alt_brand: { subjective: 'Sanjivani' }, alt_price_inr: { subjective: '25.0' } } })
    expect(alt('yes')).toMatchObject({ in_stock: 'no', alt_available: 'yes', alt_brand: 'Sanjivani', alt_price_inr: 25 })
    expect(alt('no')).toMatchObject({ alt_available: 'no', alt_brand: null, alt_price_inr: null })
    expect(alt('maybe')).toMatchObject({ alt_available: 'unknown', alt_brand: null, alt_price_inr: null })
  })

  it("returns a quote that passes the transcript check: the shopkeeper's line in the sample was copied verbatim", () => {
    expect(quoteHeard(parseExtraction(real)!.stock_quote, 'assistant: क्या आपके पास Amul Butter 500g है, 2 packet की quantity में?\nuser: हाँ है, दो packet मिल जाएगा.')).toBe(true)
  })
})
