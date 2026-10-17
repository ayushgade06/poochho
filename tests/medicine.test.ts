import { describe, expect, it } from 'vitest'
import { parseExtraction } from '@/lib/extraction'
import { alternativesAllowed, compositionText, formOf, parseCsv, toMedicine } from '@/lib/medicine'
import { rankResults } from '@/lib/rank'
import { DEMO_SHOPS, quoteScript } from '@/lib/sim'
import { alternatives, summarize } from '@/lib/summary'
import type { SearchState } from '@/lib/types'

// Brand names here are made up; no dataset rows live in this repo.
const med = (composition: string, strength: string | null = '10 mg', form: string | null = 'tablet') => ({ composition, strength, form })

describe('alternativesAllowed', () => {
  it('allows a single salt with a known strength and form', () => {
    expect(alternativesAllowed(med('Paracetamol', '650 mg'))).toBe(true)
    expect(alternativesAllowed(med('Cetirizine', '10 mg'))).toBe(true)
    expect(alternativesAllowed(med('Salbutamol', '4 mg', 'tablet'))).toBe(true) // the tablet, not the inhaler
  })

  it('never for narrow-therapeutic-index drugs', () => {
    for (const c of ['Levothyroxine', 'Thyroxine', 'Phenytoin', 'Carbamazepine', 'Sodium Valproate', 'Divalproex', 'Valproic Acid', 'Warfarin', 'Lithium Carbonate', 'Digoxin', 'Cyclosporine', 'Ciclosporin', 'Tacrolimus', 'Theophylline'])
      expect(alternativesAllowed(med(c)), c).toBe(false)
  })

  it('never for insulins and other biologics', () => {
    for (const c of ['Insulin Glargine', 'Human Insulin', 'Insulin Aspart', 'Adalimumab', 'Trastuzumab', 'Etanercept', 'Erythropoietin', 'Darbepoetin Alfa', 'Pegfilgrastim', 'Enoxaparin', 'Liraglutide', 'Teriparatide', 'Tetanus Toxoid'])
      expect(alternativesAllowed(med(c, '40 mg', 'injection')), c).toBe(false)
  })

  it('never for inhalers', () => {
    expect(alternativesAllowed(med('Salbutamol', '100 mcg', 'inhaler'))).toBe(false)
    expect(alternativesAllowed(med('Budesonide', '0.5 mg', 'respules'))).toBe(false)
    expect(alternativesAllowed(med('Tiotropium', '18 mcg', 'rotacap'))).toBe(false)
    expect(alternativesAllowed(med('Formoterol', '12 mcg', 'transcaps'))).toBe(false)
  })

  it('never for Schedule X drugs', () => {
    for (const c of ['Methylphenidate', 'Ketamine', 'Amobarbital', 'Phenobarbitone', 'Meprobamate', 'Dexamphetamine', 'Glutethimide'])
      expect(alternativesAllowed(med(c)), c).toBe(false)
  })

  it('never for a multi-salt product, or when the strength or form is unknown', () => {
    expect(alternativesAllowed(med('Amoxycillin + Clavulanic Acid'))).toBe(false)
    expect(alternativesAllowed(med('Amoxycillin, Clavulanic Acid'))).toBe(false)
    expect(alternativesAllowed(med('Paracetamol and Caffeine'))).toBe(false)
    expect(alternativesAllowed(med('Paracetamol', null))).toBe(false)
    expect(alternativesAllowed(med('Paracetamol', '650 mg', null))).toBe(false)
  })
})

describe('reading the dataset', () => {
  it('parses CSV with quoted commas, quotes and CRLF line ends', () => {
    expect(parseCsv('id,name\r\n1,"Fevrol, ""650"" Tablet"\r\n2,Calmo Syrup')).toEqual([['id', 'name'], ['1', 'Fevrol, "650" Tablet'], ['2', 'Calmo Syrup']])
  })

  const row = (name: string, c1: string, extra: Record<string, string> = {}) => ({ id: '7', name, Is_discontinued: 'FALSE', short_composition1: c1, short_composition2: '', ...extra })

  it('keeps single-salt products on sale, with strength and form', () => {
    expect(toMedicine(row('Fevrol  650 Tablet', 'Paracetamol (650mg)'))).toEqual({ id: 7, name: 'Fevrol 650 Tablet', composition: 'Paracetamol', strength: '650 mg', form: 'tablet' })
    expect(toMedicine(row('Coffex Syrup', 'Ambroxol (30mg/5ml) '))).toMatchObject({ composition: 'Ambroxol', strength: '30 mg/5 ml', form: 'syrup' })
    expect(toMedicine(row('Glyco 500 SR Tablet', 'Metformin (500mg)'))?.form).toBe('SR tablet')
    expect(toMedicine(row('Ciprol Eye/Ear Drops', 'Ciprofloxacin (0.3% w/v)'))).toMatchObject({ strength: '0.3% w/v', form: 'eye/ear drops' })
    expect(toMedicine(row('Calamo Lotion', 'Calamine (NA)'))?.strength).toBeNull()
    expect(toMedicine(row('Vitex Kit', 'Vitamin D3 (Cholecalciferol) (60000IU)'))).toMatchObject({ composition: 'Vitamin D3 (Cholecalciferol)', strength: '60000 IU', form: null })
  })

  it('drops discontinued products and anything with a second salt', () => {
    expect(toMedicine(row('Fevrol 650 Tablet', 'Paracetamol (650mg)', { Is_discontinued: 'TRUE' }))).toBeNull()
    expect(toMedicine(row('Amoxo 625 Tablet', 'Amoxycillin  (500mg) ', { short_composition2: '  Clavulanic Acid (125mg)' }))).toBeNull()
    expect(toMedicine(row('Mixo Tablet', 'Paracetamol (325mg) + Ibuprofen (400mg)'))).toBeNull()
    expect(toMedicine(row('', 'Paracetamol (650mg)'))).toBeNull()
    expect(toMedicine({ ...row('Fevrol 650 Tablet', 'Paracetamol (650mg)'), id: 'x' })).toBeNull()
  })

  it('names the form from the last form word, with release and where it goes', () => {
    expect(formOf('Asthol 100mcg Inhaler')).toBe('inhaler')
    expect(formOf('Pyro 40 Tablet DT')).toBe('DT tablet')
    expect(formOf('Nasoclear Nasal Spray')).toBe('nasal spray')
    expect(formOf('Glycimet -SR 500 Tablet')).toBe('SR tablet')
    expect(formOf('Something Kit')).toBeNull()
  })

  it('writes the composition the agent asks for', () => {
    expect(compositionText({ composition: 'Paracetamol', strength: '650 mg', form: 'tablet' })).toBe('Paracetamol 650 mg tablet')
  })
})

describe('the simulated pharmacy run', () => {
  const req = { product: 'Dolo 650', brand_or_variant: null, category: 'pharmacy', quantity: 1, unit: 'strip', area: 'Kothrud', composition: 'Paracetamol 650 mg tablet', ask_alternative: true }
  const call = (id: string, r: Parameters<typeof quoteScript>[1] = req) => {
    const shop = DEMO_SHOPS.find((s) => s.id === id)!
    const end = quoteScript(shop, r, shop.language, 'p').at(-1)!.payload as { transcript?: string; extracted_data?: unknown }
    return { transcript: end.transcript ?? '', x: parseExtraction(end.extracted_data) }
  }

  it("asks once for the same composition when the brand is out of stock, in the shop's language", () => {
    const sharma = call('demo-sharma-kirana')
    expect(sharma.transcript).toContain('क्या आपके पास इसी salt का कोई दूसरा brand है — Paracetamol 650 mg tablet?')
    expect(sharma.x).toMatchObject({ in_stock: 'no', alt_available: 'yes', alt_brand: 'Sanjivani', ready_in_minutes: 10 })
    expect(sharma.x!.alt_price_inr).toBeGreaterThan(0)
    const patil = call('demo-patil-provision') // Marathi
    expect(patil.transcript).toContain('तुमच्याकडे याच salt चा दुसरा कोणता brand आहे का — Paracetamol 650 mg tablet?')
    expect(patil.x).toMatchObject({ in_stock: 'no', alt_available: 'no' })
    expect(call('demo-gupta-general').x).toMatchObject({ in_stock: 'yes', alt_available: 'unknown' })
    const notAsked = call('demo-sharma-kirana', { ...req, ask_alternative: false })
    expect(notAsked.transcript).not.toContain('salt')
    expect(notAsked.x).toMatchObject({ in_stock: 'no', alt_available: 'unknown' })
    expect(call('demo-sharma-kirana', { ...req, category: 'grocery', composition: null, ask_alternative: false }).x).toMatchObject({ in_stock: 'yes' }) // its usual answer
  })

  it('keeps the alternative out of the ranking and mentions it neutrally', () => {
    const executions = ['demo-sharma-kirana', 'demo-gupta-general', 'demo-patil-provision', 'demo-mehta-general'].map((id) => ({ id, status: 'done' as const, error: null, extracted: call(id).x, shop: { name: DEMO_SHOPS.find((s) => s.id === id)!.name } }))
    const ranked = rankResults({ ...req, max_budget_inr: null, need_within_minutes: null }, executions.map((e) => ({ id: e.id, shopName: e.shop.name, status: e.status, error: null, extracted: e.extracted })))
    expect(ranked.find((r) => r.winner)?.shopName).toBe('Gupta General Stores')
    expect(ranked.find((r) => r.id === 'demo-sharma-kirana')).toMatchObject({ stock: 'none', eligible: false, score: 0 })
    // The other brand's price and ready time never count for the requested one.
    const priced = rankResults({ ...req, max_budget_inr: null, need_within_minutes: 5 }, [{ id: 'a', shopName: 'A', status: 'done', error: null, extracted: { ...call('demo-sharma-kirana').x!, unit_price_inr: 1, price_unit: 'strip' } }])
    expect(priced[0]).toMatchObject({ unit: null, total: null })
    expect(priced[0].flags.join()).not.toContain('Needs ~')
    const s = { request: req, executions } as unknown as SearchState
    const names = alternatives(s, ranked).map((a) => a.r.shopName)
    expect(names).toEqual(['Sharma Kirana Store'])
    expect(alternatives({ ...s, request: { ...s.request, ask_alternative: false } }, ranked)).toEqual([]) // only when asked for
    expect(summarize(req, ranked, 'en', null, names)).toContain('Sharma Kirana Store has another brand with the same composition; ask your doctor before switching.')
    expect(summarize(req, ranked, 'hi', null, names)).toContain('Sharma Kirana Store के पास इसी composition का दूसरा brand है; बदलने से पहले अपने doctor से पूछें।')
  })
})
