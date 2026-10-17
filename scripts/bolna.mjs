// Bolna helper. Run with: npm run bolna -- <check | setup-extractions --yes | test-extraction>
//   check              read-only: key, wallet, concurrency, agent, languages, prompts, extractions, numbers
//   setup-extractions  creates the "Shop Quote" extractions (data/bolna-extractions.json) missing from your agent
//   test-extraction    runs the extractions on a sample transcript (POST .../dispositions/test, no call placed)
import { existsSync, readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

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
const data = (f) => readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8')
const spec = JSON.parse(data('bolna-extractions.json'))
const callLangs = JSON.parse(data('call-languages.json')) // the languages Poochho places calls in (lib/types.ts CALL_LANGS)
const ours = spec.dispositions.map((d) => d.name)
// Names of the extractions already on the agent. With agent_id the API answers { agent_dispositions,
// global_dispositions }, not the array its docs show.
async function existing() {
  const d = await api(`/dispositions/?agent_id=${AGENT}`)
  return (Array.isArray(d) ? d : [...(d.agent_dispositions ?? []), ...(d.global_dispositions ?? [])]).map((x) => x.name)
}

if (cmd === 'check') {
  const me = await api('/user/me')
  console.log(`Key OK. Wallet: ${me.wallet} · concurrency max ${me.concurrency?.max} (in use ${me.concurrency?.current})`)
  const agent = await api(`/v2/agent/${AGENT}`)
  const text = JSON.stringify(agent)
  console.log(`Agent: ${agent.agent_name} · status ${agent.agent_status}`)
  for (const v of ['shop_name', 'item', 'quantity', 'customer_area', 'alternative']) console.log(`  prompt uses {${v}}: ${text.includes(v) ? 'yes' : 'NO'}`)
  console.log(`  prompt uses {call_purpose}: ${text.includes('call_purpose') ? 'yes' : 'no (a "Hold it" call will sound like a quote call; see docs/bolna-setup.md §5)'}`)
  // The welcome message is {greeting}: Poochho sends each call's greeting in that call's language.
  const greetings = agent.agent_welcome_message?.includes('{greeting}') ? Object.values(callLangs).map((l) => l.greeting) : [agent.agent_welcome_message ?? '']
  console.log(`  welcome message says it is an AI and that the call is recorded: ${greetings.every((g) => /\bAI\b/.test(g) && /record/.test(g)) ? 'yes' : 'NO (required; see docs/bolna-setup.md §4)'}`)
  const tc = agent.tasks?.[0]?.task_config ?? {}
  console.log(`  total call timeout: ${tc.call_terminate ?? '?'} s${tc.call_terminate > 90 ? ' (spec: 90 s, Engine tab)' : ''} · voicemail detection: ${tc.voicemail ? 'on' : 'OFF (turn on, Calling tab)'} · auto-reschedule: ${tc.auto_reschedule ? 'ON (turn off)' : 'off'}`)
  // A multilingual agent runs each call on its per-language prompt, which only the dashboard editor changes
  // (it also rewrites the base prompt on every save). data/ holds the reference copy.
  const ml = agent.tasks?.[0]?.tools_config?.multilingual_config
  const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim()
  // Each language's reference copy: data/bolna-prompt-<lang>.md if there is one, else data/bolna-prompt.md.
  const promptFile = (l) => (existsSync(new URL(`../data/bolna-prompt-${l}.md`, import.meta.url)) ? `bolna-prompt-${l}.md` : 'bolna-prompt.md')
  const prompts = ml?.enabled ? Object.entries(ml.languages).map(([l, v]) => [l, v.system_prompt]) : [['base', agent.agent_prompts?.task_1?.system_prompt]]
  for (const [l, p] of prompts) console.log(`  prompt (${l}) matches data/${promptFile(l)}: ${norm(p) === norm(data(promptFile(l))) ? 'yes' : norm(p) ? 'NO (edited in the dashboard?)' : 'NO, EMPTY'}`)
  console.log(`  welcome message matches data/bolna-welcome.txt: ${norm(agent.agent_welcome_message) === norm(data('bolna-welcome.txt')) ? 'yes' : 'NO'}`)
  console.log(`  hangup prompt matches data/bolna-hangup-prompt.txt: ${norm(tc.call_cancellation_prompt) === norm(data('bolna-hangup-prompt.txt')) ? 'yes' : 'NO'} (hang up after silence: ${tc.hangup_after_silence}s)`)
  // Bolna refuses a call in a language the agent doesn't have, so every language Poochho calls in must be on it.
  const agentLangs = ml?.enabled ? Object.keys(ml.languages) : []
  const missingLangs = Object.keys(callLangs).filter((l) => !agentLangs.includes(l))
  console.log(`  languages on the agent: ${agentLangs.join(', ') || 'none (not multilingual)'}${missingLangs.length ? ` · MISSING ${missingLangs.join(', ')}: calls in them would be refused (add them in the dashboard, or remove them from data/call-languages.json)` : ' · all of data/call-languages.json present'}`)
  const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SECRET_KEY: secret } = process.env
  const shops = url && secret
    ? await createClient(url, secret, { auth: { persistSession: false } }).from('shops').select('id, language').eq('source', 'live').eq('consent_status', 'verified').is('opted_out_at', null).then((r) => r, (e) => ({ error: e }))
    : { error: { message: 'Supabase is not configured' } }
  const other = (shops.data ?? []).filter((x) => !Object.hasOwn(callLangs, x.language))
  console.log(`  callable shops in a language the agent doesn't speak: ${shops.error ? `could not check (${shops.error.message})` : other.length ? `${other.map((x) => `${x.id} (${x.language})`).join(', ')}: called in the request's language` : 'none'}`)
  if (ml?.enabled) console.log(`  language switching: ${ml.language_switch_trigger}${ml.language_switch_trigger === 'caller_requested' ? '' : ' (set "the caller requested for it", Languages tab)'}`)
  console.log(`  webhook URL set: ${agent.agent_config?.webhook_url ?? agent.webhook_url ? 'yes' : 'not visible via API (check the Extractions tab)'}`)
  const names = await existing().catch((e) => (console.log(`  extractions: ${e.message}`), null))
  if (names) console.log(`  extractions configured: ${names.length}; missing from Poochho's set: ${ours.filter((n) => !names.includes(n)).join(', ') || 'none'}`)
  const numbers = await api('/phone-numbers/all').catch(() => [])
  console.log(`Phone numbers on the account: ${Array.isArray(numbers) ? numbers.length : 'unknown'}`)
} else if (cmd === 'setup-extractions') {
  // Only the missing ones: creating an existing name again would give the agent a duplicate.
  const have = await existing()
  const missing = spec.dispositions.filter((d) => !have.includes(d.name))
  if (!missing.length) {
    console.log(`All ${ours.length} extractions already exist on agent ${AGENT}.`)
    process.exit(0)
  }
  if (flag !== '--yes') {
    console.log(`This will create ${missing.length} missing extraction(s) in category "${spec.category}" on agent ${AGENT}:\n  ${missing.map((d) => d.name).join(', ')}\nRe-run with --yes to proceed.`)
    process.exit(0)
  }
  const r = await api('/dispositions/bulk', { method: 'POST', body: JSON.stringify({ agent_id: AGENT, dispositions: missing.map((d) => ({ ...d, category: spec.category })) }) })
  console.log(`Created ${r.ids?.length ?? 0} extraction(s): ${missing.map((d) => d.name).join(', ')}.`)
} else if (cmd === 'test-extraction' && flag === 'pharmacy') {
  // Medicine mode: the brand is out of stock, the shop has the same composition under another brand.
  const transcript = [
    'assistant: नमस्ते, मैं पूछो की AI assistant हूँ, एक customer की तरफ से call कर रही हूँ. यह call record हो रही है.',
    'user: हाँ, बोलिए.',
    'assistant: Kothrud के एक customer को Dolo 650 चाहिए, 1 strip. क्या यह आपके पास stock में है?',
    'user: Dolo तो अभी खत्म है.',
    'assistant: क्या आपके पास इसी salt का कोई दूसरा brand है — Paracetamol 650 mg tablet?',
    'user: हाँ, Calpol 650 है.',
    'assistant: इसकी price क्या है?',
    'user: एक strip का तीस रुपये.',
    'assistant: यह कितने minute में ready हो जाएगा?',
    'user: अभी दे देंगे, ready है.',
  ].join('\n')
  const r = await api(`/v2/agent/${AGENT}/dispositions/test`, { method: 'POST', body: JSON.stringify({ transcript, call_date: new Date().toISOString().slice(0, 19) }) })
  console.log(JSON.stringify(r.extracted_data ?? r, null, 2))
  console.log('Expected: in_stock no, alt_available yes, alt_brand "Calpol 650", alt_price_inr 30, ready_in_minutes 0, stock_quote "Dolo तो अभी खत्म है".')
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
  console.log('Expected: in_stock yes, total_price_inr 540, ready_in_minutes 10, can_hold yes, stock_quote "हाँ है, दो packet मिल जाएगा". Compare with lib/extraction.ts parsing in tests/extraction.test.ts.')
} else {
  console.log('Usage: npm run bolna -- <check | setup-extractions [--yes] | test-extraction>')
}
