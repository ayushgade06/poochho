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
**Shop Quote**, with the 12 extractions in [`data/bolna-extractions.json`](../data/bolna-extractions.json).

**Option A, one command** (uses `POST /dispositions/bulk`, which is atomic: all or nothing):

```
npm run bolna -- setup-extractions        # shows which extractions are missing from the agent
npm run bolna -- setup-extractions --yes  # creates only those (an existing name is never created twice)
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
| `stock_quote` | Free text | Text: the shopkeeper's exact words about availability |
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

`stock_quote` was added the same night (only the missing one was created). On the sample transcript Bolna returned
"हाँ है, दो packet मिल जाएगा", the shopkeeper's line verbatim; the saved fixture now includes it. Poochho still shows a
quote only if it appears word for word in one of the shopkeeper's turns of the call transcript.

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

## 4. Agent settings (applied 2026-10-16 after the first live call)

| Where | Setting | Value | Why |
|---|---|---|---|
| Agent tab | Welcome message | `{greeting}` (`data/bolna-welcome.txt`). Poochho sends each call's greeting in that call's language from `data/call-languages.json`: Devanagari, feminine, says it is an AI and that the call is recorded | The first live call read "bol raha/rahi hoon" literally, and Roman-letter Hindi set the style for the whole call. The recording notice ("यह call record हो रही है") is what India's DPDP rules expect. Bolna keeps one welcome text for all languages (its docs suggest a variable for localized greetings), so a fixed Hindi text would also open English and Marathi calls |
| Agent tab → Canvas | Languages | Hindi (default), English, **Marathi** | Each must also be in `data/call-languages.json`; Bolna refuses (400) a call in a language the agent doesn't have |
| Languages tab → Marathi | Voice / transcription | Sarvam `bulbul:v4-flash`, "Ishita (Conversational)" / Sarvam `saaras:v4`, with a shop-call context and keywords (stock, packet, price…) | Added 2026-10-16. Hindi and English still use ElevenLabs and Deepgram |
| Agent tab | Prompt, **Hindi and English tabs** | `data/bolna-prompt.md` (see §5) | Calls use the per-language prompt. The English one was empty, so a call that switched to English improvised |
| Languages tab | Move to English when | the caller requested for it | Shopkeepers mix in English words ("already", model numbers); auto-detection flipped the call to the English setup |
| Languages tab → Voice → Advanced | Hindi voice speed rate | `0.9` | Product names and prices are easier to follow on a phone line |
| Engine tab | Endpointing | `500` ms | At 200 ms a short pause ended the turn mid-number: "₹1,299" was heard as "one thousand two" |
| Engine tab | Final Call Message (Hindi) | `आपके समय के लिए बहुत धन्यवाद, आपका दिन अच्छा हो.` | It was Roman-letter Hindi ending in "Namaste!" |
| Engine tab | Total Call Timeout | `90` s | Spec: 90 s maximum per call |
| Engine tab | Hangup on User Silence | `15` s | Ends dead calls |
| Calling tab | Voicemail Detection | on | Voicemail is recorded as a failure, never as an answer |
| Calling tab | Auto Reschedule | off | Poochho never follows up later on its own |
| Calling tab | Outbound call timing restrictions | off | Poochho refuses to dial outside `CALL_WINDOW_IST` itself |

`npm run bolna -- check` verifies the timeout, voicemail, language switching and that both prompts and the welcome
message match the files in `data/`.

Poochho never sends `retry_config`, so Bolna does not retry calls. If Bolna reports `rescheduled`, Poochho marks the
call failed and keeps asking Bolna to stop it while the search page is open. Stopping only works while the call is
queued or scheduled, so keep Bolna's own timing restriction off or wider than `CALL_WINDOW_IST`.

## 5. Agent prompt

The reference copy is `data/bolna-prompt.md`; the dashboard's original is in git history (commit "Snapshot the
Bolna agent's welcome message and prompt"). Changes made after the first live call:

- Feminine first person throughout; all Hindi in Devanagari (the voice mispronounces Roman-letter Hindi); everyday
  shop English kept as is ("एक piece", not "एक टुकड़ा"); the brand written as पूछो so it is pronounced right.
- Model numbers digit by digit ("one four one"), prices in Hindi words ("बारह सौ निन्यानवे रुपये"), no brackets read aloud.
  Poochho now sends `{item}` as `boAt Airdopes 141, Black` instead of `boAt Airdopes 141 (Black)`.
- The price is confirmed back once as a question, so a misheard amount can be corrected; a cut-off price is asked again.
- Quote calls ask whether the shop *could* hold the item; the separate "Hold it" call (`{call_purpose}` = `hold`) has
  its own section, Section 4A.
- Short closings without a recap and without "Namaste"; no promised callbacks.

**To change it:** edit `data/bolna-prompt.md`, paste it into **both** the Hindi and English tabs of the prompt editor
(Agent tab), and `data/bolna-prompt-mr.md` into the Marathi tab; save, and run `npm run bolna -- check`. Pasting works
from the clipboard: click in the editor, Ctrl+A, Ctrl+V.

The Marathi prompt (`data/bolna-prompt-mr.md`) is the Hindi one with every spoken line and keyword list translated
into Marathi (feminine forms, Devanagari, shop English kept as is); the instructions stay in English. It was written
by the developer and **needs a native speaker's review**. Both prompts have an FAQ for "why is this call recorded?"
(added 2026-10-16): the agent explains, and ends the call politely if the shopkeeper objects. Don't set it through the API: on a multilingual agent the API's
`agent_prompts` is not what calls use, and every dashboard save rewrites it. Have a native speaker review the Hindi.

## 6. Trial-account limits

Trial accounts can call **verified numbers only** (User Profile → Verified Numbers) and allow **2 concurrent calls**.
On a trial account, set `MAX_CONCURRENCY=2`. Calls beyond the limit are queued by Bolna, not rejected.

## 7. Turning on LIVE mode

1. Put consenting test numbers in `data/shops.local.json` (copy the `.example`; it is gitignored), each with a
   `consent_note` and `consent_verified_at`, then run `npm run seed:shops`.
2. Set `LIVE_CALLS_ENABLED=true` and restart. `POOCHHO_ADMIN_TOKEN` and `BOLNA_WEBHOOK_SECRET` were generated into
   `.env.local` already.
3. In the app, choose **Live**, review the shops, paste the operator token, tick the consent box, and place the calls.
