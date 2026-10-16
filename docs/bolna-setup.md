# Bolna setup for Poochho

Your agent **Poochho Assistant** already exists in Agent Studio, with a Hindi/English prompt and the variables
`{shop_name}`, `{item}`, `{quantity}` and `{customer_area}`. Poochho sends exactly those four (plus `call_purpose`
and `timezone`) as `user_data` on `POST /call`. These steps connect it to the app. None of them place a call.

Sources: Bolna docs at <https://www.bolna.ai/docs> (make call, executions, webhooks, extractions, calling guardrails),
read on 2026-10-16.

## 1. Credentials

Add to `.env.local` (never commit it):

```
BOLNA_API_KEY=bn-...         # Developers → API Keys. Shown once at creation: use the key you saved.
BOLNA_AGENT_ID=...           # the Poochho Assistant agent id
```

Then check the account (read-only, free):

```
npm run bolna -- check
```

It prints the wallet balance, the concurrency limit, whether the prompt uses the four variables, which Poochho
extractions are missing, and how many phone numbers the account has.

## 2. Extractions (structured answers)

Poochho reads Bolna's post-call extractions from `extracted_data`. That object is nested as
Category → extraction name → `{ objective, subjective, confidence_label }`. Create one category,
**Shop Quote**, with the 11 extractions in [`data/bolna-extractions.json`](../data/bolna-extractions.json).

**Option A, one command** (uses `POST /dispositions/bulk`, which is atomic: all or nothing):

```
npm run bolna -- setup-extractions        # shows what it will create
npm run bolna -- setup-extractions --yes  # creates them
npm run bolna -- test-extraction          # runs them on a sample transcript; no call is placed
```

**Option B, by hand.** Go to Extractions tab → New Category "Shop Quote" → Add Extraction, once per row. Copy each
name and prompt exactly from `data/bolna-extractions.json`; the names must match.

| Name | Answer type | Values (objective) / format (subjective) |
|---|---|---|
| `in_stock` | Pre-defined | `yes` · `partial` · `no` · `unsure` |
| `unit_price_inr` | Free text | Numeric |
| `total_price_inr` | Free text | Numeric |
| `price_unit` | Free text | Text |
| `qty_available` | Free text | Numeric |
| `brand_or_variant` | Free text | Text |
| `pickup_or_delivery` | Pre-defined | `pickup` · `delivery` · `unknown` |
| `ready_in_minutes` | Free text | Numeric |
| `can_hold` | Pre-defined | `yes` · `no` · `unknown` |
| `opt_out` | Pre-defined | `yes` · `no` |
| `notes` | Free text | Text |

Poochho accepts only these exact values. Anything else becomes "unsure", "unknown" or empty; it is never guessed.
Confidence comes from Bolna's own per-extraction `confidence_label`: the weakest label among availability and
price is used.

**Verified on 2026-10-16** (no call placed): the extractions were created on Poochho Assistant with
`setup-extractions --yes`. `test-extraction` then returned all 11 answers for the sample transcript, and the wallet
was unchanged. The real response is saved in `tests/fixtures/bolna-dispositions-test.json` and parsed by
`tests/extraction.test.ts`. Each answer carries `objective`, `subjective`, `confidence` (0–1), `confidence_label`,
`reasoning_*` and `validation`. Bolna's model filled `unit_price_inr` = 270 by dividing the stated 540 total, despite
the prompt. Poochho therefore takes the unit price from a stated total whenever there is one.

## 3. Webhook

Bolna posts the full execution object on every status change. It does not sign webhooks; its documented trust
mechanisms are custom headers and source IPs. In **Extractions tab → Webhook Configuration**:

- **Webhook URL:** `https://<your-deployment>/api/bolna/webhook`
- **Add headers:** `{"x-poochho-secret": "<value of BOLNA_WEBHOOK_SECRET in .env.local>"}`
- **Trigger on statuses:** all statuses (the default)
- **Send test:** expect HTTP **202** `{"ignored":"unknown execution"}`. The sample's id is not one of our calls, so a
  202 proves the secret works. A 401 means the header is wrong.
- **Save agent**

Optional: set `BOLNA_WEBHOOK_IPS=13.203.39.153,13.126.9.249,13.202.133.53` (Bolna's documented source IPs) to also
check the sender's IP.

**Local development:** Bolna cannot reach `localhost`. Poochho polls `GET /executions/{id}` every 5 seconds while
a search page is open, so LIVE mode still works locally without a tunnel. Webhooks only make updates faster.

## 4. Recommended agent settings

| Where | Setting | Value | Why |
|---|---|---|---|
| Agent tab | Welcome message | must say it is an AI, e.g. `नमस्ते, मैं Poochho की AI assistant हूँ, एक customer की तरफ से call कर रही हूँ।` | Your prompt's Section 2 assumes the welcome message discloses the AI |
| Engine tab | Total Call Timeout | `90` s | Spec: 90 s maximum per call |
| Engine tab | Hangup on User Silence | `10` s | Ends dead calls quickly |
| Calling tab | Voicemail Detection | on | Voicemail is recorded as a failure, never as an answer |
| Calling tab | Outbound call timing restrictions | 9–20 | Matches `CALL_WINDOW_IST`. Poochho also refuses to dial outside it |
| Calling tab | Auto Reschedule | off | Poochho never follows up later on its own |

Poochho never sends `retry_config`, so Bolna does not retry calls. If Bolna reports `rescheduled`, Poochho marks the
call failed and keeps asking Bolna to stop it while the search page is open. Stopping only works while the call is
queued or scheduled, so keep Bolna's own timing restriction off or wider than `CALL_WINDOW_IST`.

## 5. Prompt suggestions (optional; have a native speaker review them)

1. **Quote calls should not reserve by accident.** Section 4 Q2 currently asks "क्या आप इस {item} को हमारे customer के
   लिए रख सकते हैं?". A shopkeeper may treat that as a reservation on every quote call. A hypothetical form keeps
   reservations for the explicit "Hold it" call: `अगर customer लेना चाहें, तो क्या आप इसे थोड़ी देर के लिए रख पाएंगे? और कितनी जल्दी ready हो सकता है?`
2. **Reservation calls.** Poochho passes `{call_purpose}` = `quote` or `hold`. Add near the top: `अगर {call_purpose} "hold" है, तो बताइए
   कि customer ने यह item लेने का फ़ैसला किया है और पूछिए कि क्या shop इसे customer के लिए रख देगी।` Alternatively, create a separate
   agent for holds and set `BOLNA_HOLD_AGENT_ID`.
3. Fix `{{quantity}}` in Section 4 Q1 to `{quantity}` for consistency. Bolna accepts both forms, but an unresolved
   `{{x}}` is read out literally while `{x}` renders as empty.

## 6. Trial-account limits

Trial accounts can call **verified numbers only** (User Profile → Verified Numbers) and allow **2 concurrent calls**.
On a trial account, set `MAX_CONCURRENCY=2`. Calls beyond the limit are queued by Bolna, not rejected.

## 7. Turning on LIVE mode

1. Put consenting test numbers in `data/shops.local.json` (copy the `.example`; it is gitignored), each with a
   `consent_note` and `consent_verified_at`, then run `npm run seed:shops`.
2. Set `LIVE_CALLS_ENABLED=true` and restart. `POOCHHO_ADMIN_TOKEN` and `BOLNA_WEBHOOK_SECRET` were generated into
   `.env.local` already.
3. In the app, choose **Live**, review the shops, paste the operator token, tick the consent box, and place the calls.
