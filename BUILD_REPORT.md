# Poochho: build report (autonomous session, night of 2026-10-16)

**Short version.**

- SIMULATED and REPLAY work end to end on the real Supabase database and were checked in a browser.
- Metrics, manual labelling, CSV export and all docs are done.
- LIVE calling works end to end. On 2026-10-16 you placed the first real call (one consenting test number,
  electronics). It went through dispatch, polling, extraction and ranking, and the follow-up "Hold it" call was placed
  too. The agent problems it revealed are fixed in the prompt and settings (§6a); a second live call should confirm them.
- Buildathon milestones (§9): **M1 done** (availability first; the shopkeeper's own words, freshness, recordings and
  cost behind every answer). **M3 done** apart from a real Marathi call (each shop called in its own language; the
  agent now speaks Marathi). **M4 done locally** (answers mid-call, stop once found); the Bolna tool gets connected
after deployment. **M5 built** (judge mode; voice input for everyone within caps): its migration and the first
browser call wait for you (see §9). **M2 waits for the Kaggle dataset.**

## 1. Features implemented

| Feature | Status | How it was verified |
|---|---|---|
| Structured request form + validation | Done | Unit tests; browser (empty-form errors, full flow) |
| Review step: exactly which shops will be called; LIVE needs operator token + consent checkbox | Done | Browser (simulated and LIVE review screens) |
| SIMULATED mode: scripted calls in Bolna's payload shape through the real pipeline | Done | Integration tests (real Supabase); browser |
| REPLAY mode: sanitised recordings played on their timeline, incl. hold calls | Done | Browser; one sample replay shipped, **recorded from a SIMULATED run** and labelled so |
| LIVE mode: `POST /call`, webhook, polling fallback, watchdog, concurrency, calling window, daily cap, consent/opt-out re-checked at dial time, no auto-retry | Done; **one real call** so far | Integration tests against a mocked Bolna + real Supabase; first real call 2026-10-16 (§6a) |
| Webhook `/api/bolna/webhook`: shared-secret header, optional IP allowlist, idempotent, out-of-order safe | Done | Unit tests (mocked engine) + integration tests |
| Post-call extraction parser for Bolna dispositions | Done | Unit tests on the documented shape **and on a real Bolna response** (`dispositions/test`, no call). The 11 extractions exist on your agent |
| Deterministic ranking + explanations | Done | Unit tests (missing prices, unit mismatch, partial stock, low confidence, budget, deadline, ties) |
| "Hold it" reservation call (separate, explicit, confirmed only by the shop) | Done | Integration test; browser (simulated + replay) |
| Live dashboard: switchboard cards, transcripts, ledger, best-match card | Done | Browser at 1568 px and 375 px |
| Supabase Realtime updates (broadcast ping, no data in payload) + polling fallback | Done | Integration test receives the broadcast; browser shows "Realtime connected" |
| Spoken summary (Hindi/English) | Done | Unit tests for text. Browser speech fallback implemented; Sarvam TTS verified live 2026-10-16, in 11 languages (translated summaries labelled) |
| Voice input | Done | Parser unit tests. Sarvam STT + form filling verified live with Marathi audio (route returns language and fields in ~3 s); **no microphone test run** |
| WhatsApp share (verified facts only; SIMULATED/REPLAY labelled) | Done | Unit test; browser (link text checked) |
| `/metrics` (rates with denominators, median time to first quote, accuracy, by language, insufficient-data flags) | Done | Unit tests; browser |
| Manual labelling + CSV export (operator-only, formula-injection safe) | Done | Unit tests; HTTP tests with/without token |
| Opt-out suppression (permanent, by phone number) | Done | Integration test |
| Google Places discovery | **Not built** | Optional in the spec; only consenting test shops can be called |

## 2. Important files

- **`lib/`**
  - `engine.ts`: orchestration and DB
  - `state.ts`: call state machine
  - `extraction.ts`: Bolna extraction parser
  - `rank.ts`: scoring
  - `summary.ts`, `sim.ts`, `bolna.ts`, `sarvam.ts`, `config.ts`, `validate.ts`, `voice.ts`, `metrics.ts`, `types.ts`
- **`app/`**
  - Pages: `page.tsx`, `search/[id]/page.tsx`, `metrics/page.tsx`
  - Route handlers under `api/`: `searches`, `tick`, `hold`, `bolna/webhook`, `shops`, `config`, `stt`, `tts`, `labels`, `metrics/export`
- **`components/`**: `SearchForm`, `SearchView`, `CallCard`, `Results`, `Labeler`, `ui`
- **`supabase/migrations/`**
  - `20261016000000_init.sql`: tables, RLS, grants, triggers, Realtime ping
  - `20261016010000_claim_live_calls.sql`: atomic, concurrency-safe dispatch
- **`data/`**
  - `shops.json`: 7 fictional demo shops, no phone numbers
  - `replays.json`: 1 sample, simulated source
  - `bolna-extractions.json`
  - `shops.local.example.json`
- **`scripts/`**: `bolna.mjs`, `seed-shops.mjs`, `export-replay.mjs`, `check-secrets.mjs`
- **Docs:** `README.md`, `docs/bolna-setup.md`, `DEMO.md`, `PITCH.md`, `.env.example`, `vercel.json`

Application code is about 2,900 lines (`lib` 1.2k, `components` 1.1k, `app` 0.45k), above the ~2,000 target. Most of
the excess is UI and safety checks, which I kept rather than cut.

## 3. Commands actually run, with results

| Command | Result |
|---|---|
| `npm test` (Vitest, 12 files) | **84 passed** (after M4) |
| `npm run test:integration` (real Supabase; Bolna mocked in one file) | **19 passed** (after M4) |
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 problems |
| `npm run build` | **Succeeds** (Next.js 16.4.1, Turbopack): `/` static; API routes dynamic; `/metrics` and `/search/[id]` partial prerender |
| `npm run check:secrets` (after build) | No secrets in 29 bundle files or the tracked files |
| `next start` + HTTP smoke test | Simulated pharmacy search ran to completion (busy, out-of-stock, partial and full-stock outcomes) |
| HTTP checks | 422 on invalid input; 403 for LIVE while not configured; 401 for webhook without secret; 401 for labels/export without token; 200 with token |
| Supabase checks | Publishable key gets `42501 permission denied` on every table and on `claim_live_calls`; secret key reads/writes |
| `npm run replay:export` | Saved the sample replay (6 calls incl. hold) |
| `npm run bolna -- check` (read-only) | Key OK. Trial account: concurrency 2, wallet 500, 0 phone numbers. Prompt uses all four variables, but not `{call_purpose}`. Welcome message says it's an AI. **Total call timeout 300 s, voicemail detection off** (see §6) |
| `npm run bolna -- setup-extractions --yes` | Created 11 extractions in "Shop Quote"; `check` lists 11, none missing |
| `npm run bolna -- test-extraction` (no call) | All 11 answers returned for the sample transcript and parsed correctly (test added). Wallet unchanged at 500 |

Bugs the tests caught and that are fixed:

- **Dispatch race.** Two concurrent dispatchers placed 4 calls with a limit of 2. Fixed with `claim_live_calls()`
  and an advisory lock.
- **Duplicate webhooks counted as changes.** Postgres `jsonb` key reordering made duplicates look new. Fixed with a
  field-by-field comparison.
- **Out-of-stock shops earned points.** They scored readiness and hold points; now they don't.
- **"Dolo 650" parsed as quantity 650.** Product-name numbers are now kept in the name.
- **Back-calculated unit prices (seen in Bolna's real response).** Bolna's model filled `unit_price_inr` 270 from a
  stated 540 total, despite the prompt. A stated total now sets the unit price.
- **`check` counted 0 extractions.** The list endpoint returns `{agent_dispositions, global_dispositions}`, not the
  array its docs show.

An independent code review (read-only subagent) then reported 15 findings. All were verified and fixed, with tests:

| # | Finding | Fix |
|---|---|---|
| 1 | Turning LIVE off didn't stop already-queued calls | The dispatcher re-checks the LIVE settings and fails queued calls; the cleanup only touches rows still queued |
| 2 | A dispatch error after saving returned 500, inviting a duplicate search; queued calls never expired | Dispatch errors no longer fail the request; queued calls expire after 10 min inside `claim_live_calls` |
| 3 | An opt-out was recorded in a separate write that was never retried | A database trigger records it atomically with the call update |
| 4 | A call Bolna accepted could be marked "could not start", losing its result | Only a Bolna HTTP refusal marks failure; timeouts stay open; our id goes in `user_data` and late webhooks are adopted by it |
| 5 | Live transcripts were readable by anyone with the URL | Transcripts, notes and raw errors for LIVE need the operator token |
| 6 | A unit price with no stated unit was multiplied into a fabricated total | Unit prices are multiplied only when the shop stated the unit |
| 7 | An unknown price or readiness passed a budget or deadline | It now makes the shop ineligible, with an explicit flag |
| 8 | A price of 0 counted as a quote | Prices must be > 0 |
| 9 | The watchdog was anchored on dialling and flip-flopped processing ↔ timeout | Anchored on the last milestone; timeout yields only to a final outcome; recent timeouts count in concurrency; ticking stops after 30 min |
| 10 | A scripted step could be lost on a transient error | Steps are claimed one by one and rolled back on failure |
| 11 | The "Hold it" confirmation could carry over to a new winner | Components are keyed by shop |
| 12 | Quantities like 1.1 were rejected; fractional minutes caused a 500 | Tolerant decimal check; whole minutes only |
| 13 | The webhook secret was accepted in the URL | Header only |
| 14 | TTS/STT were open proxies on a paid key | TTS speaks only a search's server-computed summary; STT needs the operator token |
| 15 | Replay export masked transcripts only | Masks every string; drops free-text notes from real-call replays |

## 4. Production build

`npm run build` succeeds and `next start` serves the app (smoke-tested). No deployment was made, per your
instructions. `vercel.json` pins functions to `icn1`, next to the Seoul database.

## 5. What works in SIMULATED mode (no credentials beyond Supabase)

1. Request entry and review.
2. Five parallel scripted calls with live status: dialling, ringing, talking, reading answers, done/failed.
3. Transcripts and extracted answers on each card.
4. The ledger and best-match card.
5. "Hold it" with a scripted reservation call.
6. WhatsApp share and the spoken summary (browser voice).
7. `/metrics` with simulated data, clearly labelled as not real-world.

The scripted shops cover:

- full stock with a hold
- full stock with an unconfirmed hold
- partial stock
- no answer
- price not quoted
- out of stock
- busy

REPLAY plays the sample run the same way.

## 6. What still needs you (credentials, manual setup, verification)

1. **Credentials (done 2026-10-16).** Your `api_keys.txt` was read but not modified. It was untracked in this
   public repo, so it is now gitignored.
   - The Bolna key went into `BOLNA_API_KEY`. The file has no agent ID, so it was looked up via the API (one agent,
     "Poochho Assistant") and saved as `BOLNA_AGENT_ID`. `MAX_CONCURRENCY=2` matches the trial limit.
   - The Supabase URL and publishable key in the file match `.env.local` (the secret key came from the dashboard).
   - The database password was not copied: the app doesn't use it.
   - The file has no Sarvam key, so Sarvam stays untested.
2. **Migrations** (all three) were applied through the Supabase SQL editor (no DB password or access token was
   available). They are therefore not recorded in `supabase_migrations.schema_migrations`; don't `db push` them
   again.
3. **Bolna agent setup:** follow `docs/bolna-setup.md`.
   - Extractions: **done** (created and tested). That is the only change made to your Bolna account.
   - **Change in the dashboard before live calls:** Total Call Timeout 300 → **90 s** (Engine tab); **Voicemail
     Detection on** (Calling tab). The API can only change these by rewriting the whole agent, which I didn't risk.
   - Already right: auto-reschedule off; the welcome message says it's an AI.
   - Webhook URL plus the `x-poochho-secret` header, once deployed (the value is `BOLNA_WEBHOOK_SECRET` in
     `.env.local`). Locally, polling covers it.
   - Optional: use `{call_purpose}` in the prompt so a "Hold it" call asks to reserve (§5 of the guide).
4. **Consenting test numbers** go in `data/shops.local.json` with consent notes, then run `npm run seed:shops`. On a
   Bolna trial, those numbers must be verified in Bolna (`MAX_CONCURRENCY=2` is already set).
5. **First live calls (M1/M2/M4)** need you present, 09:00–20:00 IST, `LIVE_CALLS_ENABLED=true`, and the operator
   token (`POOCHHO_ADMIN_TOKEN` in `.env.local`). Verify against the real webhook and extraction shape, then record a
   replay of a real run for the stage fallback.
6. ~~Sarvam~~: key added and verified 2026-10-16.
7. **Hindi review:** the prompt suggestions in `docs/bolna-setup.md` and the Hindi summary and simulated lines should be
   checked by a native speaker.

## 6a. First live call (2026-10-16)

One quote call (78 s, completed) and one "Hold it" call to the consenting test number. Nothing failed in Poochho itself:
the call was dialled, tracked by polling (no webhook locally), extracted and ranked. In stock, ready in 10 min and
can hold were all right. The problems were in the agent:

| What you heard | Cause | Fix |
|---|---|---|
| "bol raha/rahi hoon" | Literally in the welcome message | New welcome message (`data/bolna-welcome.txt`) |
| Unclear pronunciation, "ek tukda", "Samajh gaya" | Roman-letter Hindi, no gender or wording rules | Prompt: Devanagari, feminine forms, everyday shop English; voice speed 0.9 |
| Product name hard to follow | `{item}` was "boAt Airdopes 141 (Black)" | Sent as "boAt Airdopes 141, Black"; prompt says model numbers digit by digit |
| ₹1,299 recorded as ₹1,200 | Turn ended after a 200 ms pause mid-number; the price was not confirmed | Endpointing 500 ms; the agent now asks "बारह सौ निन्यानवे रुपये, सही?" |
| "Namaste" at the end | Final Call Message in Roman letters with "Namaste!"; open-ended closing | Devanagari final message; short scripted closings |
| Hold call went off-script in English | "Already" auto-switched the call to English, whose prompt was **empty**; no hold section | English prompt filled; switch only on request; Section 4A for `{call_purpose}` = hold |

Details: `docs/bolna-setup.md` §4–5. Cost of both calls: 15 wallet units (500 → 485).

## 7. Start it locally

```bash
cd D:\poochho
npm install          # already done
npm run dev          # http://localhost:3000, SIMULATED and REPLAY work right away
npm test             # unit tests
npm run test:integration
```

## 8. Next steps when you're back (in order)

1. ~~Bolna key, agent ID, extractions~~ (done 2026-10-16).
2. In the Bolna dashboard: Total Call Timeout **90 s**, Voicemail Detection **on**. Then `npm run bolna -- check`
   should show no warnings.
3. Add yourself (and one consenting friend) to `data/shops.local.json`, run `npm run seed:shops`, set
   `LIVE_CALLS_ENABLED=true`, and restart.
4. **M1:** one live call to your own phone. Watch the card update. Then check `call_events` in Supabase for the raw
   (sanitised) payloads.
5. **M2/M4:** five consenting numbers. Then `npm run replay:export -- <search id> "Real run"` for the stage fallback.
6. Deploy to Vercel (env vars from `.env.example`), set the Bolna webhook URL, and rehearse `DEMO.md`.

The buildathon milestones that followed are in §9.

## 9. Buildathon milestones

### M1: availability first, and every answer has proof (2026-10-16, done)

| Change | Where | How it was verified |
|---|---|---|
| Ranking weights are now stock 50, ready 20, hold 15, price 15 (were 50/15/10/25): MRP keeps price gaps small. The best-match card, ledger explanations, spoken summary and WhatsApp text say has it / ready in / can hold first and the price last. **To revert, change `WEIGHTS` in `lib/rank.ts`.** | `lib/rank.ts`, `lib/summary.ts`, `components/Results.tsx` | Unit tests (a shop ready now that can hold beats one a few rupees cheaper; exact wording); browser |
| `stock_quote` extraction: the shopkeeper's exact words about availability. `setup-extractions` now creates only the extractions missing from the agent. A quote is shown only if it appears word for word in one of the shopkeeper's own turns of the transcript | `data/bolna-extractions.json`, `scripts/bolna.mjs`, `lib/extraction.ts` (`quoteHeard`), `lib/engine.ts` (`getSearch`) | Created on the agent (12 extractions, no duplicates; a re-run creates nothing). A real `test-extraction` returned the sample line verbatim (fixture saved). Unit tests reject paraphrases, translations, the AI's words, partial words and stitched turns. An integration test drops an invented quote |
| Freshness: "confirmed 6 min ago" on cards, the ledger and the best-match card; the WhatsApp text says "as of HH:MM IST" (not for replays, whose clock is the playback's) | `components/ui.tsx` (`Proof`), `lib/summary.ts` | Unit tests; browser ("confirmed 13 h ago" on the real call) |
| Recordings: `GET /api/executions/[id]/recording`, operator only. It fetches the audio from Bolna at play time and streams it; the link is never stored. LIVE cards get a play button for the operator; other cards say "Simulated call — no audio" or "Replayed call — no audio" | the route, `lib/bolna.ts` (`getRecording`), `components/CallCard.tsx` | Route unit test. The real first call's recording (313 KB MP3) streamed with the operator token; 401 without it; 404 for a simulated call |
| Cost per call in a new column `cost_cents` (migration applied in the SQL editor, then checked: numeric, RLS on, `anon`/`authenticated` can't read). The results page shows "≈ ₹X for this search"; `/metrics` (LIVE) shows cost per answered call and per successful search | `supabase/migrations/20261016030000_call_cost.sql`, `lib/bolna.ts`, `lib/state.ts`, `lib/metrics.ts`, `app/metrics/page.tsx` | Unit tests (cost only grows; metric definitions); integration test (a webhook's cost lands in the column). The two real calls were backfilled from Bolna: `/metrics?mode=live` shows ≈ ₹8.28 per answered call and ≈ ₹13.8 per successful search (n = 1, flagged as insufficient) |
| Recording notice in the welcome message: "यह call record हो रही है" (DPDP expects a notice) | Bolna agent (API PATCH of `agent_config.agent_welcome_message`), `data/bolna-welcome.txt`, `lib/sim.ts` | `npm run bolna -- check`: welcome message and both prompt tabs match the files; 12 extractions, none missing. The dashboard shows the new text |

Checks run: `npm run typecheck`, `npm run lint`, `npm test` (70), `npm run test:integration` (16), `npm run build`, then
`next start` on port 3100 for the browser check at desktop width and 390 px (the running dev server's render worker
had crashed with "Jest worker encountered 2 child process exceptions"; it was left alone), `npm run check:secrets`.

**Findings worth knowing.**

- **Cost units and which field.** Bolna reports costs in US cents: the wallet's 500 is the $5 trial credit (the
  dashboard shows $4.85 now). On the two real calls the wallet dropped by exactly Σ `total_cost` = 9 + 6 = 15¢, while
  Σ `cost_breakdown.total_cost_to_deduct` was 5.5¢ (both executions say `billing_settled: false`). Bolna's docs say to
  reconcile against `total_cost_to_deduct`; the wallet says otherwise, so Poochho stores `total_cost`. Rupees use ₹92
  per dollar, the rate on Bolna's own pricing page (6.00¢ = ₹5.52 a minute). Re-check once billing settles.
- **Recordings need no authentication.** `GET https://api.bolna.ai/recordings/call/{id}` answers with a 307 to a
  pre-signed S3 link (`audio/mpeg`, valid about 24 h) whether or not the API key is sent. So Bolna's call id is a key
  to the recording, and the search API used to return it to anyone holding a LIVE search's URL. It is now
  operator-only, like transcripts.
- **The welcome message is one agent-level field**, not one per language tab: English-language calls also open with
  it, in Hindi. M3 (Marathi) has to account for this.
- The prompt has no FAQ for "why is this call recorded?"; the agent would give its "I don't have that information"
  line. It will be added with the M2 prompt edit, which touches both tabs anyway.

### M3: call each shop in its own language (2026-10-16, done except a real Marathi call)

Goal: you ask in Tamil → a Pune shop is called in Marathi → you hear the answer in Tamil.

| Change | Where | How it was verified |
|---|---|---|
| Bolna's docs (read 2026-10-16): `agent_data.language` starts a multilingual agent in a language (its transcriber, voice and prompt together); `/call` answers **400** for a language the agent doesn't have; the welcome text is one string for all languages, and Bolna suggests a variable for localized greetings. There are no per-call transcriber keywords, so the product name isn't passed | `lib/bolna.ts` (`startCall` sends `agent_data.language`) | Mocked-Bolna integration test checks the request body |
| One language list, `data/call-languages.json` (hi, en, mr), with each language's opening line. The agent's welcome message is now `{greeting}`, and Poochho sends the greeting in the call's language: it says it is an AI and that the call is recorded. This also fixes English calls opening in Hindi | `data/call-languages.json`, `lib/types.ts` (`CALL_LANGS`, `callLanguage`), `lib/engine.ts` (`dial`) | Unit test: every greeting discloses AI and recording, and the welcome file is `{greeting}`. `npm run bolna -- check` |
| Each call's language is decided when the search is created (the shop's language if the agent speaks it, else the request's) and stored on the call; hold calls reuse it. The request stores the language the user spoke (`asked_in`) | `lib/engine.ts`, migration `20261016040000_call_language.sql` (applied in the SQL editor and checked: text columns, RLS on, `anon` can't read) | Unit test for the choice and fallback; integration test: a Marathi shop gets `mr`, a Tamil shop falls back to `hi`, each with its greeting |
| Bolna agent: Marathi added (Sarvam `bulbul:v4-flash` "Ishita (Conversational)", Sarvam `saaras:v4` with a shop-call context and keywords). Marathi prompt tab = `data/bolna-prompt-mr.md`: the Hindi prompt with every spoken line and keyword list in Marathi, feminine forms, Devanagari, shop English kept. Both prompts gained an FAQ for "why is this call recorded?" | Bolna dashboard (pasted with Ctrl+V), `data/bolna-prompt*.md` | `bolna check`: all three prompts match their files, languages en/hi/mr present. The API shows Marathi on Sarvam. Bolna's `dispositions/test` on a Marathi transcript (no call; wallet unchanged at 485) returned every answer right, including the quote "हो आहे, दोन packet मिळतील." verbatim |
| `npm run bolna -- check` now reports the agent's languages against `data/call-languages.json`, each language's prompt against `data/bolna-prompt-<lang>.md` (or `bolna-prompt.md`), and callable shops whose language the agent doesn't speak | `scripts/bolna.mjs` | Run against the live agent |
| SIMULATED: Patil Provision (Shivaji Nagar) speaks Marathi, with Marathi scripted lines. Simulated calls open with the real greeting. "called in मराठी" on the review step and every card; the results page shows "Asked in தமிழ் → shops called in हिन्दी, मराठी → summary in தமிழ்", and the summary picker defaults to the language the user spoke | `data/shops.json`, `lib/sim.ts`, `components/*` | Browser (production build, desktop and 390 px); the Tamil summary came back translated through Sarvam. The sample replay was re-recorded and keeps each call's language |

**Needs a native speaker's review:** the Marathi prompt, the Marathi greeting and the Marathi simulated lines
(also the Hindi ones, as before). **A real Marathi call waits for you.** Tamil gets added only once Marathi works end
to end.

### M4: answers appear mid-call, and calling stops once found (2026-10-17, done locally; tool connects after deploy)

| Change | Where | How it was verified |
|---|---|---|
| `POST /api/bolna/tool` for the agent's `report_availability` tool: the same shared-secret header and optional IP allowlist as the webhook (now one function, `bolnaDenied`); values parsed defensively (Bolna turns everything into strings: "True", "None", "540.0"); matched by Bolna's `execution_id`, falling back to our id (adopting the call if needed); answers `{"ok":true}` only, never other shops' data | `app/api/bolna/tool/route.ts`, `lib/config.ts`, `lib/extraction.ts` (`parseLive`) | `tests/tool.test.ts`: auth, IP allowlist, string parsing, unknown call → 202, stale or repeated reports → 200 unchanged, nothing usable → 400 |
| A provisional "heard live" answer in the normalised event (`ProviderEvent.live`, synthetic status `__live` → talking). `mergeEvent` merges reports field by field into `live_answer` until the post-call extraction exists, which replaces it; it can move ringing → talking but never backwards | `lib/state.ts`, migration `20261017000000_live_answers.sql` (applied and checked; `tool` added to the `call_events` source check) | State unit tests; integration test logs a real `tool` event |
| Stop calling once found (`search_requests.stop_when_found`, default on; a checkbox on the review step). Right before dialling a queued call, `dial()` checks whether another call in the search already has the full quantity and a "yes" to holding it, from its final extraction or a live answer, and marks the call `not needed: already found at <shop>` instead. A call in progress is never stopped. Skipped calls count as not dialled in the summary ("2 more shops were not called"), the time-saved strip and `/metrics` | `lib/engine.ts` (`foundElsewhere`, `dial`), `lib/rank.ts` (`hasAndHolds`, `skipped`), `lib/summary.ts`, `lib/metrics.ts`, `components/*` | Integration test with mocked Bolna: a live answer on one call makes the queued third call skip without dialling, while the first call keeps talking |
| SIMULATED: calls run 3 at a time (`SIM_LINES`, like a real account's concurrency limit) and queued ones start as lines free, with the same stop-once-found check. Scripted calls send two `__live` reports mid-call through the same merge path. Replays keep both: the export now includes skipped calls and tool reports, and the sample replay was re-recorded | `lib/sim.ts`, `lib/engine.ts` (`startSimulated`), `scripts/export-replay.mjs` | Integration test on the real database; browser (production build): cards show "Heard live · provisional" mid-call, then "Not called · Not needed: already found at Sharma Kirana Store" for the two queued shops; summary "सामान मिल गया था, इसलिए 2 और दुकानों को call नहीं किया।"; 390 px |

**Waits for deployment:** adding the custom function in Agent → Tools and the two prompt lines that tell the agent
to call it (exact JSON and text in `docs/bolna-setup.md` §6). Until then LIVE calls still stop once found, using
the final answers.

### M5: judge mode, where the judge plays the shopkeeper in their browser (2026-10-17, built; migration and first call pending)

**The Web Call SDK is already enabled on this account**: `POST https://api.bolna.ai/web-call/session` returned a session
(`run_id`, SIP credentials, `expires_in: 120`), with `agent_data.language` accepted. No message to Bolna is needed.
Minting a session creates an "in-progress" web-call execution on Bolna's side (its `run_id` is the execution id, so
webhooks and polling work as for a phone call); unused sessions took no concurrency slot and no money (concurrency
0/2, wallet unchanged at 485).

| Change | Where | How it was verified |
|---|---|---|
| A `judge` mode (`MODES`, DB constraints): a search with up to 2 simulated shops plus "Your shop", whose call waits until the judge clicks **Answer the call**. That click mints a single-use session with the same variables and language a phone call gets, claimed once (a second click is refused). The call is then polled, webhooked, extracted and ranked like a phone call. Its own banner (plum): "JUDGE MODE — you play Your shop in this browser… No phones ring." Transcripts are visible through the search's URL, like simulated runs; no recordings. Behind `WEB_CALL_ENABLED` | `lib/engine.ts` (`startWebCall`), `lib/bolna.ts` (`createWebSession`), `app/api/executions/[id]/web-call`, `components/CallCard.tsx` (`JudgeCall`, `@bolna/web-call` loaded only on click), `components/SearchForm.tsx`, `components/ui.tsx` | Route unit tests (flag, caps, operator bypass, no-store); integration test with mocked Bolna written (session minted only on request, once, with the right variables; the judge's answers win the ranking) |
| Daily caps per visitor (HMAC of the IP, never the IP) and overall, counted atomically in `usage_counters` by `bump_usage()`; a hard two-minute limit on the browser call on top of the agent's 90 s timeout; an explicit start click | migration `20261017010000_judge_mode.sql`, `lib/engine.ts` (`withinDailyCap`), `lib/config.ts` | Integration test of the counter written |
| Sarvam voice input open to everyone within the same kind of caps (it was operator-only), so judges can speak in any Indian language on the public link; the button shows the server's reason when the caps are used up | `app/api/stt/route.ts`, `components/SearchForm.tsx` | Route unit tests (allowed, capped, operator never capped) |
| Fallback, if the browser call can't be used: add the judge's phone as a consenting test shop (verified in Bolna first on a trial) | `DEMO.md` | — |

**Status.** The migration `20261017010000_judge_mode.sql` was applied in the SQL editor (pasted from the file) and
checked from the server: the counter stops at its limit (`[true, true, null]`), the `judge` mode and shop source are
accepted, and the publishable key gets `42501` on `usage_counters` and `bump_usage`. 90 unit and 21 integration tests
pass. A code review found 6 issues, all fixed: the visitor's own counter is checked first so one visitor can't use
up everyone's day; a judge call is claimed before the cap is spent (only a real start counts, and the claim is given
back if the cap is used up); the microphone is asked for before a session is minted; an unanswered judge call
expires after 15 minutes; voice input falls back to the browser's own recognition once Sarvam is capped; judge mode
needs at least one simulated shop.

**Build and browser check:** the first attempts ran out of commit memory (other projects' dev servers held most
of it); once memory freed up the production build succeeded and judge mode was checked in the browser (see M6).
**The first judge-mode browser call waits for your OK** (it needs a microphone, so it's yours to make).

### M2: medicine mode, same composition under another brand (2026-10-17, built; the dataset is yours to download)

| Item | Where | Verified |
|---|---|---|
| Exclusion list: narrow-therapeutic-index drugs (the ten in the brief plus acenocoumarol, aminophylline, Indian spellings such as thyroxine), insulins and biologics (incl. "-mab", "-cept", "-parin", "-grastim"), inhalers (inhaler, rotacap, respules, transcaps), Schedule X (checked against CDSCO's 2016 compilation: 16 drugs incl. ketamine), multi-salt, unknown strength or form | `lib/medicine.ts` | Unit tests for every group |
| Dataset loader: single-salt rows not discontinued; strength ("650 mg", "30 mg/5 ml") and form with release and route ("SR tablet", "eye/ear drops") | `lib/medicine.ts`, `scripts/seed-medicines.mjs` (`npm run seed:medicines`) | Unit tests; a 3-row made-up CSV seeded end to end (1 kept), then removed. **The real CSV is not downloaded yet** |
| `medicines` table, `pg_trgm` index, `search_medicines()`, `search_requests.composition` / `ask_alternative` with a check constraint | migration `20261017020000_medicines.sql` | Applied in the SQL editor; from the server: search finds "650 fevrol" and "fevrl 650", `%`/`_` are escaped, anon gets 42501 on table and function, the constraint refuses `ask_alternative` without a composition |
| `GET /api/medicines?q=` (≥ 3 characters, ≤ 10 results, with `allowed`); the form shows "Composition: … · tablet", the checkbox, the exclusion message and the dataset credit | `app/api/medicines/route.ts`, `components/SearchForm.tsx` | Browser (production build) |
| The composition is read from the table by id on the server, never taken from the browser; `ask_alternative` is stored only if allowed; `{alternative}` is sent only on quote calls | `lib/validate.ts`, `lib/engine.ts` | Integration test written (mocked Bolna): allowed, excluded and not-asked cases, unknown id refused. Passed (22/22 integration tests, 2026-10-17) |
| Agent: Section 3 Question 2 (asked once, never names a brand, no medical advice, no hold), guardrail exception, `{alternative}` in the variables | `data/bolna-prompt.md`, `data/bolna-prompt-mr.md`; pasted into the Hindi, English and Marathi tabs | `bolna check`: all three tabs match, `{alternative}` used |
| Extractions `alt_available`, `alt_brand`, `alt_price_inr` | `data/bolna-extractions.json`, `lib/extraction.ts` | Created with `setup-extractions --yes` (15 total). `test-extraction pharmacy` (no call, wallet unchanged): in_stock **no**, alt_available yes, alt_brand "Calpol 650", ready 0, the quote verbatim; `alt_price_inr` came back in 1 of 2 runs (shown as "price not quoted" when missing) |
| Results: separate **Same composition available** block (shop, brand, price, ready time, disclaimer, credit), only when the user asked; never ranked; the summary names the shop neutrally and adds "ask your doctor" | `components/Results.tsx`, `lib/summary.ts` | Unit tests; browser: Gupta best match, Sharma in the block, Hindi summary sentence, no overflow at 390 px |
| Simulated pharmacy run: Sharma has only the same composition ("Sanjivani", made up), Patil (Marathi) is out of stock, Gupta and Mehta have it | `data/shops.json` (`pharmacy` overrides), `lib/sim.ts` (Hindi, English, Marathi lines; Marathi needs a native speaker) | Unit tests; browser run with a made-up medicine row, removed afterwards |

**Waiting for you:** download the CSV from <https://www.kaggle.com/datasets/shudhanshusingh/az-medicine-dataset-of-india>
into `data/raw/` (it's gitignored) and run `npm run seed:medicines`. Until then the lookup finds nothing and pharmacy
searches ask for the brand only.

### M6: getting ready to submit (in progress)

| Item | Status |
|---|---|
| Home page as one sentence box with the mic ("2 packet Amul Butter, Kothrud, Pune"); what was understood shows as chips; **Edit details** opens the full form (budget, deadline, notes). A typed sentence goes through the same Sarvam sentence-to-fields step as speech (`POST /api/understand`, sharing the voice caps), with a local parser (`parseSentence`) when Sarvam is unavailable | Done. Unit tests for the parser; browser check on a production build at desktop and 390 px (Sarvam turned "2 packet Amul Butter 500g, Kothrud, Pune" into product, variant, quantity, area, city and category chips) |
| README top: one-paragraph pitch and how to try it | Done; the live link and the video link get added after deployment |
| Deploy to Vercel, set the webhook and tool URLs, smoke test | Waits for your OK |
| Record a real LIVE run and export its replay | Waits for you (you press the buttons) |
| PITCH.md with re-checked facts and real `/metrics?mode=live` numbers | Done: all 16 sources re-checked on 2026-10-17 (11 supported as worded, 5 partly; every page reachable). Corrections applied: Medfinder is $17.50–$35 per search, not ~$50; Awign sells store audits and telecalling as separate services; "Have AI check pricing" covers service businesses, so the pitch cites "Let Google Call" for stock; AIOCD's 12.4 lakh is its own membership figure; DPDP core duties start 13 May 2027. Real numbers: early pilot, n = 1 |
| Submission checklist | Done (DEMO.md) |

The production build and the M5 browser check also ran once memory freed up (2026-10-17 ~01:00): judge mode shows its
plum banner, the "Your shop" card with **Answer the call** (not pressed: the first browser call is yours), and the
two simulated shops calling.

