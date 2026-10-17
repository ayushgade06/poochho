// Loads the A-Z Medicine Dataset of India (Kaggle, CC BY-SA 4.0, as of Nov 2022) into the medicines table:
// single-salt products that aren't discontinued, with strength and form (lib/medicine.ts toMedicine).
// Download the CSV from https://www.kaggle.com/datasets/shudhanshusingh/az-medicine-dataset-of-india into data/raw/
// (gitignored), then run: npm run seed:medicines. Safe to re-run: rows are upserted by the dataset's id.
import { readdirSync, readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { parseCsv, toMedicine } from '../lib/medicine.ts'

const dir = new URL('../data/raw/', import.meta.url)
const file = readdirSync(dir).find((f) => /\.csv$/i.test(f))
if (!file) {
  console.error('No CSV in data/raw/. Download the A-Z Medicine Dataset of India from Kaggle into data/raw/ first.')
  process.exit(1)
}
const [header, ...rows] = parseCsv(readFileSync(new URL(file, dir), 'utf8').replace(/^﻿/, ''))
const cols = header.map((h) => h.trim())
const missing = ['id', 'name', 'Is_discontinued', 'short_composition1', 'short_composition2'].filter((c) => !cols.includes(c))
if (missing.length) {
  console.error(`${file} is missing the column(s) ${missing.join(', ')}: is it the A-Z Medicine Dataset of India?`)
  process.exit(1)
}
const meds = rows.map((r) => toMedicine(Object.fromEntries(cols.map((c, i) => [c, r[i]])))).filter(Boolean)
const formless = meds.filter((m) => !m.form).length
console.log(`${file}: ${rows.length} rows, ${meds.length} single-salt products on sale (${formless} without a recognised form: never asked about under another brand).`)

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
for (let i = 0; i < meds.length; i += 1000) {
  const { error } = await db.from('medicines').upsert(meds.slice(i, i + 1000))
  if (error) throw new Error(`upsert failed at row ${i}: ${error.message}`)
  process.stdout.write(`\rUpserted ${Math.min(i + 1000, meds.length)} / ${meds.length}`)
}
console.log('\nDone.')
