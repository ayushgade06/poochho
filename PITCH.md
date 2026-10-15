# Poochho: 3-minute pitch outline

Fill the **[brackets]** with real numbers before presenting. Do not use numbers from simulated runs as performance.

## 1. Problem (0:00–0:25)

- Most Indian neighbourhood shops (kirana stores, chemists, hardware shops) have no online inventory. The only way
  to know whether something is in stock, its price, and whether they'll keep it for you is to **call**.
- Calling five shops means five calls, missed calls, Hindi/English switching and no comparison. People give up, or
  travel to a shop that doesn't have it.
- **India's shops have no inventory API. The phone is the API.**

## 2. Demo (0:25–1:25)

Follow `DEMO.md`: request, parallel AI calls, ledger with verified answers, Hold it, spoken summary and WhatsApp.

## 3. Why this is different (1:25–1:45)

- **Works with every shop today.** No app for the shopkeeper, no catalogue, no onboarding: just their phone.
- **Honest by construction.** The AI discloses itself first. Unknown prices stay unknown and are never "cheapest";
  a reservation is confirmed only by the shop. Ranking is deterministic and explainable, not an LLM's opinion.
- **Parallel and multilingual.** Five calls at once in Hindi or English, built on Bolna's voice stack.

## 4. Market entry (1:45–2:05)

- Start with urgent, low-availability purchases where a wasted trip hurts: medicines after hours, specific spare
  parts, baby and pet supplies, festival items.
- One city and neighbourhood at a time, with shops that agree to receive calls (an opt-in list). An opt-out is
  permanent and immediate.

## 5. Expansion (2:05–2:20)

- More languages (Marathi, Tamil, Bengali…) as voices are verified with native speakers.
- Shops that answer often become a live availability map. Repeat questions get cached answers before any call is
  made.
- B2B: distributors checking retailer stock, and pharmacies finding substitutes.

## 6. Business model (2:20–2:35)

- Consumers: a small fee per completed search or reservation; free tier for occasional use.
- Shops: free, and they get customers who arrive already committed. Later, a paid "verified stock" badge.
- Unit economics to validate: call cost per search **[₹ from Bolna cost breakdown]** vs fee **[₹]**.

## 7. Defensibility (2:35–2:45)

- A consent-first network of shops that agreed to be called, plus labelled call outcomes, builds a dataset no
  scraper has.
- Measured extraction accuracy on real Hindi calls, improved with manual labels (`/metrics`).

## 8. Real metrics (2:45–2:52)

From `/metrics?mode=live` only:

- Live calls placed **[n]**; answer rate **[x% of n]**.
- Median time to first usable quote **[s]**.
- Extraction accuracy **[x% over n labelled fields]**.
- If n < 10, say "early pilot, n = [n]" rather than quoting a percentage.

## 9. The ask (2:52–3:00)

- **[e.g. Bolna credits and support for a 100-shop Pune pilot; introductions to pharmacy chains; mentors in telecom compliance.]**
- "You ask once. Poochho asks everyone."
