// Deterministic, best-effort parse of a spoken request ("2 packet Amul butter", "मुझे दो पैकेट अमूल बटर चाहिए").
// It only fills what it is sure about; the user reviews every field before anything is called.
const ALWAYS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12,
  'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'पाँच': 5, 'छह': 6, 'छः': 6, 'सात': 7, 'आठ': 8, 'नौ': 9, 'दस': 10, 'बारह': 12,
}
// Romanised Hindi numbers collide with English words ("do"), so they only count right before a unit.
const BEFORE_UNIT: Record<string, number> = { ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, saat: 7, aath: 8, nau: 9, das: 10 }
const UNITS: Record<string, string> = {
  packet: 'packet', packets: 'packet', pack: 'packet', packs: 'packet', 'पैकेट': 'packet',
  kg: 'kg', kilo: 'kg', kilos: 'kg', 'किलो': 'kg', gram: 'g', grams: 'g', 'ग्राम': 'g',
  litre: 'litre', liter: 'litre', litres: 'litre', liters: 'litre', 'लीटर': 'litre', ml: 'ml',
  strip: 'strip', strips: 'strip', 'पत्ता': 'strip', 'स्ट्रिप': 'strip', bottle: 'bottle', bottles: 'bottle', 'बोतल': 'bottle',
  box: 'box', boxes: 'box', 'डिब्बा': 'box', 'डिब्बे': 'box', dozen: 'dozen', 'दर्जन': 'dozen',
  piece: 'piece', pieces: 'piece', 'पीस': 'piece', metre: 'metre', meter: 'metre', metres: 'metre', 'मीटर': 'metre',
}
const FILLER = new Set(['i', 'need', 'want', 'please', 'find', 'get', 'me', 'of', 'a', 'an', 'the', 'some', 'buy', 'for', 'mujhe', 'chahiye', 'ka', 'ki', 'ke', 'मुझे', 'चाहिए', 'चाहिये', 'का', 'की', 'के', 'ढूंढो'])

export function parseSpokenRequest(text: string): { product?: string; quantity?: number; unit?: string } {
  const tokens = text.replace(/[,.!?।]/g, ' ').split(/\s+/).filter(Boolean)
  let quantity: number | undefined
  let unit: string | undefined
  const rest: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i].toLowerCase()
    const nextUnit = UNITS[tokens[i + 1]?.toLowerCase() ?? '']
    // A bare number is a quantity before a unit, at the start, or as a small trailing number; "Dolo 650" is a name.
    const digit = /^\d+(\.\d+)?$/.test(w) && (nextUnit || i === 0 || (i === tokens.length - 1 && Number(w) <= 20))
    const n = digit ? Number(w) : (ALWAYS[w] ?? (nextUnit ? BEFORE_UNIT[w] : undefined))
    if (quantity === undefined && n !== undefined && n > 0) {
      quantity = n
      if (nextUnit) {
        unit = nextUnit
        i++
      }
    } else if (!unit && UNITS[w]) unit = UNITS[w]
    else if (!FILLER.has(w)) rest.push(tokens[i])
  }
  const product = rest.join(' ').trim()
  return { ...(product && { product }), ...(quantity !== undefined && { quantity }), ...(unit && { unit }) }
}
