# Poochho: build report (autonomous session, night of 2026-10-16)

**Short version.**

- SIMULATED and REPLAY work end to end on the real Supabase database and were checked in a browser.
- Metrics, manual labelling, CSV export and all docs are done.
- LIVE calling is fully implemented to Bolna's documented API, but **no real call was placed**. Your instruction
  ruled that out, and two things are needed from you first: the Bolna API key and consenting test numbers.

## 1. Features implemented

| Feature | Status | How it was verified |
|---|---|---|
| Structured request form + validation | Done | Unit tests; browser (empty-form errors, full flow) |
| Review step: exactly which shops will be called; LIVE needs operator token + consent checkbox | Done | Browser (simulated and LIVE review screens) |
| SIMULATED mode: scripted calls in Bolna's payload shape through the real pipeline | Done | Integration tests (real Supabase); browser |
| REPLAY mode: sanitised recordings played on their timeline, incl. hold calls | Done | Browser; one sample replay shipped, **recorded from a SIMULATED run** and labelled so |
| LIVE mode: `POST /call`, webhook, polling fallback, watchdog, concurrency, calling window, daily cap, consent/opt-out re-checked at dial time, no auto-retry | Implemented, **not live-tested** | Integration tests against a **mocked** Bolna + real Supabase; route guards via HTTP |
| Webhook `/api/bolna/webhook`: shared-secret header, optional IP allowlist, idempotent, out-of-order safe | Done | Unit tests (mocked engine) + integration tests |
| Post-call extraction parser for Bolna dispositions | Done | Unit tests on the documented shape; definitions in `data/bolna-extractions.json` |
| Deterministic ranking + explanations | Done | Unit tests (missing prices, unit mismatch, partial stock, low confidence, budget, deadline, ties) |
| "Hold it" reservation call (separate, explicit, confirmed only by the shop) | Done | Integration test; browser (simulated + replay) |
| Live dashboard: switchboard cards, transcripts, ledger, best-match card | Done | Browser at 1568 px and 375 px |
| Supabase Realtime updates (broadcast ping, no data in payload) + polling fallback | Done | Integration test receives the broadcast; browser shows "Realtime connected" |
| Spoken summary (Hindi/English) | Done | Unit tests for text. Browser speech fallback implemented; Sarvam TTS implemented, **untested (no key)** |
| Voice input | Done | Parser unit tests. Browser speech recognition and Sarvam STT implemented; **no microphone test run** |
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
| `npm test` (Vitest, 8 files) | **52 passed** |
| `npm run test:integration` (real Supabase; Bolna mocked in one file) | **15 passed** |
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 problems |
| `npm run build` | **Succeeds** (Next.js 16.4.1, Turbopack): `/` static; API routes dynamic; `/metrics` and `/search/[id]` partial prerender |
| `npm run check:secrets` (after build) | No secrets in 29 bundle files or the tracked files |
| `next start` + HTTP smoke test | Simulated pharmacy search ran to completion (busy, out-of-stock, partial and full-stock outcomes) |
| HTTP checks | 422 on invalid input; 403 for LIVE while not configured; 401 for webhook without secret; 401 for labels/export without token; 200 with token |
| Supabase checks | Publishable key gets `42501 permission denied` on every table and on `claim_live_calls`; secret key reads/writes |
| `npm run replay:export` | Saved the sample replay (6 calls incl. hold) |
| `npm run bolna -- check` | Not run successfully: needs `BOLNA_API_KEY` |

Bugs the tests caught and that are fixed:

- **Dispatch race.** Two concurrent dispatchers placed 4 calls with a limit of 2. Fixed with `claim_live_calls()`
  and an advisory lock.
- **Duplicate webhooks counted as changes.** Postgres `jsonb` key reordering made duplicates look new. Fixed with a
  field-by-field comparison.
- **Out-of-stock shops earned points.** They scored readiness and hold points; now they don't.
- **"Dolo 650" parsed as quantity 650.** Product-name numbers are now kept in the name.

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

1. **Credentials file not found.** The notepad file was in neither `D:\poochho` nor `D:\` (two sessions checked).
   - **Supabase:** I copied the publishable and secret keys from your *Bolna Buildathon → Poochho* project into
     `.env.local`, using the clipboard so they were never printed.
   - **Bolna:** your existing "poochho" API key is masked in the dashboard. Creating a new key was blocked by the
     permission policy, so I stopped. Paste your saved key as `BOLNA_API_KEY`, and the Poochho Assistant agent ID as
     `BOLNA_AGENT_ID`.
2. **Migrations** (all three) were applied through the Supabase SQL editor (no DB password or access token was
   available). They are therefore not recorded in `supabase_migrations.schema_migrations`; don't `db push` them
   again.
3. **Bolna agent setup:** follow `docs/bolna-setup.md`.
   - Extractions: `npm run bolna -- setup-extractions --yes`, then `test-extraction`.
   - Webhook URL plus the `x-poochho-secret` header (the value is `BOLNA_WEBHOOK_SECRET` in `.env.local`).
   - Total call timeout 90 s, voicemail detection on, auto-reschedule off.
   - The welcome message must say it's an AI.
   - I made **no changes** to your agent.
4. **Consenting test numbers** go in `data/shops.local.json` with consent notes, then run `npm run seed:shops`. On a
   Bolna trial, those numbers must be verified in Bolna and you should set `MAX_CONCURRENCY=2`.
5. **First live calls (M1/M2/M4)** need you present, 09:00–20:00 IST, `LIVE_CALLS_ENABLED=true`, and the operator
   token (`POOCHHO_ADMIN_TOKEN` in `.env.local`). Verify against the real webhook and extraction shape, then record a
   replay of a real run for the stage fallback.
6. **Sarvam** (optional): add `SARVAM_API_KEY` to switch voice input/output from browser speech to Sarvam; untested so far.
7. **Hindi review:** the prompt suggestions in `docs/bolna-setup.md` and the Hindi summary and simulated lines should be
   checked by a native speaker.

## 7. Start it locally

```bash
cd D:\poochho
npm install          # already done
npm run dev          # http://localhost:3000, SIMULATED and REPLAY work right away
npm test             # unit tests
npm run test:integration
```

## 8. Next steps when you're back (in order)

1. Add `BOLNA_API_KEY` and `BOLNA_AGENT_ID` to `.env.local`, then run `npm run bolna -- check`.
2. `npm run bolna -- setup-extractions --yes`, then `npm run bolna -- test-extraction`. Confirm the output parses as
   expected; the shape should match `tests/extraction.test.ts`.
3. Add yourself (and one consenting friend) to `data/shops.local.json`, run `npm run seed:shops`, set
   `LIVE_CALLS_ENABLED=true`, and restart.
4. **M1:** one live call to your own phone. Watch the card update. Then check `call_events` in Supabase for the raw
   (sanitised) payloads.
5. **M2/M4:** five consenting numbers. Then `npm run replay:export -- <search id> "Real run"` for the stage fallback.
6. Deploy to Vercel (env vars from `.env.example`), set the Bolna webhook URL, and rehearse `DEMO.md`.
