// Medicine mode. When the prescribed brand is out of stock, Poochho may ask a chemist whether they have exactly the
// same composition (salt, strength and form) under another brand. It never names or recommends a medicine, and
// never asks at all for the medicines below, where a switch needs the doctor. Compositions come from the A-Z
// Medicine Dataset of India (Kaggle), loaded by scripts/seed-medicines.mjs; no dataset rows live in this repo.
// No imports: the seed script loads this file directly (Node strips the types).

export type Medicine = { id: number; name: string; composition: string; strength: string | null; form: string | null }

export const NO_ALTERNATIVES = "We don't look for alternatives for this medicine — ask your doctor."
export const SAME_COMPOSITION_NOTE = 'Same composition — not medical advice. If your prescription names a brand, ask your doctor before switching.'
export const MEDICINE_CREDIT = 'Compositions: A-Z Medicine Dataset of India (Kaggle, CC BY-SA 4.0), as of Nov 2022.'

// Never asked about: any composition or form containing one of these (lower case).
const NEVER = [
  // narrow therapeutic index: small differences between products matter
  'thyrox', 'phenytoin', 'carbamazepine', 'valpro', 'warfarin', 'acenocoumarol', 'lithium', 'digoxin', 'cyclosporin', 'ciclosporin', 'tacrolimus', 'theophylline', 'aminophylline',
  // insulins and other biologics
  'insulin', 'glargine', 'lispro', 'detemir', 'degludec', 'glulisine', 'epoetin', 'erythropoietin', 'grastim', 'interferon', 'somatropin', 'teriparatide', 'glutide', 'exenatide',
  'immunoglobulin', 'vaccine', 'toxoid', 'antiserum', 'venom', 'botulinum', 'parin', 'albumin', 'follitropin', 'gonadotrophin', 'gonadotropin', 'menotropin', 'hyaluronidase', 'kinase', 'teplase',
  // inhaled: the device matters as much as the drug
  'inhal', 'haler', 'rotacap', 'respule', 'transcap', 'nebul',
  // Schedule X (Drugs Rules, 1945), any salt or preparation
  'barbit', 'glutethimide', 'ketamine', 'amphetamine', 'meprobamate', 'phencyclidine', 'phenmetrazine', 'phenometrazine', 'methylphenidate', 'ethchlorvynol', 'ethclorvynol',
]

// Whether Poochho may ask for the same composition under another brand: one salt, with a known strength and form,
// and nothing from the list above (monoclonal antibodies "-mab", fusion proteins "-cept" and insulin aspart too).
export function alternativesAllowed(m: Pick<Medicine, 'composition' | 'strength' | 'form'>) {
  if (!m.strength || !m.form || /[+,&/]|\band\b|\bwith\b/i.test(m.composition)) return false
  const s = `${m.composition} ${m.form}`.toLowerCase()
  return !NEVER.some((w) => s.includes(w)) && !/\w(mab|cept)\b|\baspart\b/.test(s)
}

// "Paracetamol 650 mg tablet": what the agent asks for, and what a search stores.
export const compositionText = (m: Pick<Medicine, 'composition' | 'strength' | 'form'>) => [m.composition, m.strength, m.form].filter(Boolean).join(' ')

// ---------- loading the dataset (scripts/seed-medicines.mjs) ----------

// CSV text → rows of fields. A quoted field may hold commas, line breaks and "" for a quote.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c !== '"') field += c
      else if (text[i + 1] === '"') field += text[i++]
      else quoted = false
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      rows.push([...row, field.replace(/\r$/, '')])
      row = []
      field = ''
    } else field += c
  }
  if (field || row.length) rows.push([...row, field.replace(/\r$/, '')])
  return rows
}

const FORMS: Record<string, string> = {
  tablet: 'tablet', tablets: 'tablet', capsule: 'capsule', capsules: 'capsule', syrup: 'syrup', suspension: 'suspension', injection: 'injection', infusion: 'infusion',
  drop: 'drops', drops: 'drops', cream: 'cream', gel: 'gel', ointment: 'ointment', lotion: 'lotion', solution: 'solution', spray: 'spray', sachet: 'sachet', powder: 'powder',
  granules: 'granules', lozenges: 'lozenges', suppository: 'suppository', patch: 'patch', emulsion: 'emulsion', elixir: 'elixir', liquid: 'liquid', soap: 'soap', shampoo: 'shampoo',
  mouthwash: 'mouthwash', inhaler: 'inhaler', rotacap: 'rotacap', rotacaps: 'rotacap', respules: 'respules', respule: 'respules', transcaps: 'transcaps', transcap: 'transcaps',
}
const WHERE = ['eye', 'ear', 'eye/ear', 'nasal', 'oral', 'vaginal', 'topical', 'mouth']
const RELEASE = ['SR', 'ER', 'XR', 'MR', 'CR', 'PR', 'XL', 'DR', 'OD', 'DT', 'MD'] // sustained/extended/modified release, dispersible…

// The dosage form from a product name: "Fevrol 650 Tablet" → "tablet", "Glyco 500 SR Tablet" → "SR tablet",
// "Ciprol Eye/Ear Drops" → "eye/ear drops". Null when the name doesn't say.
export function formOf(name: string) {
  const words = name.split(/\s+/)
  const i = words.findLastIndex((w) => Object.hasOwn(FORMS, w.toLowerCase()))
  if (i < 0) return null
  const where = words[i - 1]?.toLowerCase()
  return [words.find((w) => RELEASE.includes(w)), where && WHERE.includes(where) ? where : null, FORMS[words[i].toLowerCase()]].filter(Boolean).join(' ')
}

// One dataset row → a medicines row, or null unless it's a single-salt product that isn't discontinued. The
// dataset cuts off three-salt combinations, so a row with a second salt is never trusted.
export function toMedicine(r: Record<string, string | undefined>): Medicine | null {
  const id = Number(r.id)
  const name = r.name?.trim().replace(/\s+/g, ' ')
  const salt = r.short_composition1?.trim().replace(/\s+/g, ' ') ?? ''
  if (!Number.isInteger(id) || id < 1 || !name || !salt || r.short_composition2?.trim() || /^true$/i.test(r.Is_discontinued?.trim() ?? '') || /[+,]/.test(salt)) return null
  const m = /^(.*?)\s*\(([^()]*)\)$/.exec(salt) // "Paracetamol (650mg)"
  const composition = m ? m[1] : salt
  const strength = m && !/^n\/?a$/i.test(m[2].trim()) ? m[2].trim().replace(/(\d)(?=[a-z])/gi, '$1 ') : null // "650 mg", "30 mg/5 ml"
  return composition ? { id, name, composition, strength, form: formOf(name) } : null
}
