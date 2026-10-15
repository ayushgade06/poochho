// Fails if a server-only secret value appears in the browser bundle (.next/static) or in git-tracked files.
// Run after `npm run build`: npm run check:secrets. Prints only variable names, never values.
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SECRET = ['SUPABASE_SECRET_KEY', 'BOLNA_API_KEY', 'BOLNA_WEBHOOK_SECRET', 'POOCHHO_ADMIN_TOKEN', 'SARVAM_API_KEY']
const values = SECRET.map((k) => [k, process.env[k]]).filter(([, v]) => v && v.length >= 12)
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]))
let leaks = 0
const leak = (msg) => {
  leaks++
  console.error(msg)
}

if (existsSync('.next/static')) {
  const files = walk('.next/static')
  for (const f of files) {
    const text = readFileSync(f, 'utf8')
    for (const [k, v] of values) if (text.includes(v)) leak(`LEAK: ${k} found in ${f}`)
  }
  console.log(`Scanned ${files.length} browser bundle files for ${values.length} secret values.`)
} else console.log('No .next/static yet; run npm run build first to scan the bundle.')

const tracked = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter((f) => f && existsSync(f) && statSync(f).size < 2_000_000)
const PATTERNS = [/sb_secret_[A-Za-z0-9_-]{10,}/, /bn-[a-f0-9]{24,}/, /eyJhbGciOi[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/]
for (const f of tracked) {
  const text = readFileSync(f, 'utf8')
  for (const [k, v] of values) if (text.includes(v)) leak(`LEAK: ${k} value committed in ${f}`)
  for (const p of PATTERNS) if (p.test(text)) leak(`LEAK: key-shaped string in ${f}`)
}
console.log(`Scanned ${tracked.length} tracked files.`)
if (leaks) process.exit(1)
console.log('No secrets found.')
