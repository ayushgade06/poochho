// Bolna helper. Run with: npm run bolna -- <check | setup-extractions --yes | test-extraction>
//   check              read-only: key, wallet, concurrency, agent, prompt variables, extractions, numbers
//   setup-extractions  creates the "Shop Quote" extractions (data/bolna-extractions.json) on your agent
//   test-extraction    runs the extractions on a sample transcript (POST .../dispositions/test, no call placed)
import { readFileSync } from 'node:fs'

const { BOLNA_API_KEY: KEY, BOLNA_AGENT_ID: AGENT } = process.env
const [cmd, flag] = process.argv.slice(2)
if (!KEY || !AGENT) {
  console.error('Set BOLNA_API_KEY and BOLNA_AGENT_ID in .env.local first.')
  process.exit(1)
}
async function api(path, init = {}) {
  const r = await fetch('https://api.bolna.ai' + path, { ...init, headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' } })
  const body = await r.json().catch(() => null)
  if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${r.status} ${body?.message ?? ''}`)
  return body
}
const spec = JSON.parse(readFileSync(new URL('../data/bolna-extractions.json', import.meta.url), 'utf8'))
const ours = spec.dispositions.map((d) => d.name)

if (cmd === 'check') {
  const me = await api('/user/me')
  console.log(`Key OK. Wallet: ${me.wallet} · concurrency max ${me.concurrency?.max} (in use ${me.concurrency?.current})`)
  const agent = await api(`/v2/agent/${AGENT}`)
  const text = JSON.stringify(agent)
  console.log(`Agent: ${agent.agent_name} · status ${agent.agent_status}`)
  for (const v of ['shop_name', 'item', 'quantity', 'customer_area']) console.log(`  prompt uses {${v}}: ${text.includes(v) ? 'yes' : 'NO'}`)
  console.log(`  webhook URL set: ${agent.agent_config?.webhook_url ?? agent.webhook_url ? 'yes' : 'not visible via API (check the Extractions tab)'}`)
  const dispositions = await api(`/dispositions/?agent_id=${AGENT}`).catch((e) => (console.log(`  extractions: ${e.message}`), null))
  if (dispositions) {
    const list = Array.isArray(dispositions) ? dispositions : (dispositions.data ?? [])
    const names = list.map((d) => d.name)
    console.log(`  extractions configured: ${names.length}; missing from Poochho's set: ${ours.filter((n) => !names.includes(n)).join(', ') || 'none'}`)
  }
  const numbers = await api('/phone-numbers/all').catch(() => [])
  console.log(`Phone numbers on the account: ${Array.isArray(numbers) ? numbers.length : 'unknown'}`)
} else if (cmd === 'setup-extractions') {
  if (flag !== '--yes') {
    console.log(`This will create ${ours.length} extractions in category "${spec.category}" on agent ${AGENT}:\n  ${ours.join(', ')}\nRe-run with --yes to proceed.`)
    process.exit(0)
  }
  const r = await api('/dispositions/bulk', { method: 'POST', body: JSON.stringify({ agent_id: AGENT, dispositions: spec.dispositions.map((d) => ({ ...d, category: spec.category })) }) })
  console.log(`Created ${r.ids?.length ?? 0} extractions.`)
} else if (cmd === 'test-extraction') {
  const transcript = [
    'assistant: नमस्ते, क्या आप Sharma Kirana Store से हैं? मैं Poochho की AI assistant हूँ, एक customer की तरफ से call कर रही हूँ जो Kothrud से हैं.',
    'user: हाँ, बोलिए.',
    'assistant: क्या आपके पास Amul Butter 500g है, 2 packet की quantity में?',
    'user: हाँ है, दो packet मिल जाएगा.',
    'assistant: इस Amul Butter की कीमत क्या है, रुपये में?',
    'user: दो packet का पाँच सौ चालीस रुपये.',
    'assistant: क्या आप इसे हमारे customer के लिए रख सकते हैं? कितनी जल्दी ready हो सकता है?',
    'user: हाँ रख देंगे, दस मिनट में ready.',
  ].join('\n')
  const r = await api(`/v2/agent/${AGENT}/dispositions/test`, { method: 'POST', body: JSON.stringify({ transcript, call_date: new Date().toISOString().slice(0, 19) }) })
  console.log(JSON.stringify(r.extracted_data ?? r, null, 2))
  console.log('Expected: in_stock yes, total_price_inr 540, ready_in_minutes 10, can_hold yes. Compare with lib/extraction.ts parsing in tests/extraction.test.ts.')
} else {
  console.log('Usage: npm run bolna -- <check | setup-extractions [--yes] | test-extraction>')
}
