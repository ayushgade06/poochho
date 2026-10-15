// Upserts consenting LIVE test shops from data/shops.local.json (gitignored) into Supabase.
// Run: npm run seed:shops. Copy data/shops.local.example.json to start. Never prints full phone numbers,
// and never clears an existing opt-out: opted_out_at is not part of the upsert.
import { existsSync, readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const file = new URL('../data/shops.local.json', import.meta.url)
if (!existsSync(file)) {
  console.error('data/shops.local.json not found. Copy data/shops.local.example.json and add consenting test numbers.')
  process.exit(1)
}
const shops = JSON.parse(readFileSync(file, 'utf8'))
const bad = []
const rows = shops.map((s, i) => {
  if (!/^[a-z0-9-]{1,64}$/.test(s.id ?? '')) bad.push(`#${i}: id must be lowercase letters, digits and dashes`)
  if (!/^\+[1-9]\d{9,14}$/.test(s.phone ?? '')) bad.push(`#${i} ${s.id}: phone must be E.164, e.g. +9198XXXXXXXX`)
  if (!s.name || !s.area) bad.push(`#${i} ${s.id}: name and area are required`)
  const verified = Boolean(s.consent_note && s.consent_verified_at && !Number.isNaN(Date.parse(s.consent_verified_at)))
  if (!verified) console.warn(`#${i} ${s.id}: no consent_note + consent_verified_at, so it is stored as NOT callable`)
  return {
    id: s.id,
    name: s.name,
    phone: s.phone,
    area: s.area,
    city: s.city ?? '',
    language: s.language ?? 'hi',
    source: 'live',
    consent_status: verified ? 'verified' : 'unverified',
    consent_note: s.consent_note ?? null,
    consent_verified_at: verified ? s.consent_verified_at : null,
  }
})
if (bad.length) {
  console.error(bad.join('\n'))
  process.exit(1)
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
const { error } = await db.from('shops').upsert(rows, { onConflict: 'id' })
if (error) {
  console.error(error.message)
  process.exit(1)
}
const { data } = await db.from('shops').select('id, phone, consent_status, opted_out_at').in('id', rows.map((r) => r.id))
for (const s of data) console.log(`${s.id}: …${s.phone.slice(-2)} · ${s.consent_status}${s.opted_out_at ? ' · OPTED OUT (kept)' : ''}`)
