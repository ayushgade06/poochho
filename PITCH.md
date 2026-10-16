# Poochho: 3-minute pitch outline

Every number below was re-checked against its source on 2026-10-17. Quote them as worded here; don't round them up,
and never use numbers from simulated runs as performance.

## 1. Problem (0:00–0:25)

- India's neighbourhood shops and chemists have no online inventory. The only way to know if something is in stock,
  how soon it's ready and whether they'll keep it for you is to **call**. Calling five shops means five calls, missed
  calls, switching languages, and no comparison.
- **Medicines hurt most.** The prescribed brand is unavailable at the chemist in **10% to 60% of cases, varying by
  region** (Vector Consulting Group, 900+ chemists in 18 cities; BioSpectrum India, 23 Feb 2025). And **86% of
  surveyed consumers bought medicines mainly from local chemists** in the past 12 months (LocalCircles, 1.06 lakh
  responses across 327 districts; ThePrint, 17 Sep 2026).
- Price comparison is the wrong product: packaged goods and medicines carry a printed MRP. **Availability is the
  product**: who has it now, how soon, and will they hold it.
- **India's shops have no inventory API. The phone is the API.**

## 2. Demo (0:25–1:25)

Follow `DEMO.md`: one sentence in any of 11 languages, parallel AI calls (each shop in its own language), answers
appearing mid-call with the shopkeeper's own words, calling stopping once a shop has it and will hold it, the
ranked ledger, Hold it, and the summary heard back in your language.

## 3. Why this is different (1:25–1:50)

- **Works with every shop today.** No app for the shopkeeper, no catalogue, no onboarding: just their phone.
- **Every answer has proof.** The shopkeeper's exact words (checked word for word against the transcript), how fresh
  the answer is, the call recording for the operator, and what the search cost.
- **Honest by construction.** The AI says it is an AI, and that the call is recorded, in its first sentence. Unknown
  prices stay unknown and are never "cheapest"; a reservation counts only when the shop confirms it. Ranking is
  deterministic and explainable, not an LLM's opinion.
- **Built on Bolna's own features:** mid-call tool calls (answers fill in while the shopkeeper talks), per-call
  language (a Pune shop is called in Marathi while you asked in Tamil), and web calls (judges can play the
  shopkeeper in their browser). Bolna says 60–70% of its call volume is English or Hindi and regional languages are
  rising (TechCrunch, 20 Jan 2026); Poochho goes regional per shop. **98% of internet users accessed content in Indic
  languages** (IAMAI–Kantar, *Internet in India Report 2024*; Storyboard18, 16 Jan 2025).

## 4. Validation (1:50–2:05)

- **Google ships the idea in the US.** "Let Google Call" phones nearby stores to check whether they have what you're
  looking for, how much it costs and any promos (Google, 13 Nov 2025; US only). Poochho is the India-first,
  multilingual, consent-first version for kiranas and chemists.
- **People pay for it.** Medfinder (US) uses AI agents and human copilots to call pharmacies for hard-to-find
  medicines: **$17.50–$35 per search** on a subscription (medfinder.com/pricing, read 17 Oct 2026).
- **The bar to beat:** **26%** of Google's AI pricing calls to US businesses went unanswered, and **48%** of the
  answered ones gave no price (Invoca data; CXM, 15 Dec 2025). `/metrics` measures exactly these two rates.

## 5. Market entry (2:05–2:20)

- **Start with medicines**: urgent, often out of stock, bought locally. AIOCD says it represents **about 12.4 lakh
  chemists and drug distributors** (ETV Bharat, 13 May 2026).
- **Then kiranas**: India's general trade, **over 1.4 crore kirana stores, accounts for nearly 75–80% of FMCG
  sales** (PIB, DPIIT/ONDC roundtable, 12 Jun 2026).
- One city at a time (Pune first), with shops that agree to receive calls. An opt-out is permanent and immediate.

## 6. Business model (2:20–2:35)

- Consumers: a small fee per completed search or reservation; free for occasional use.
- Shops: free, and they get customers who arrive already committed.
- **B2B:** FMCG brands already pay vendors like Awign for store audits and telecalling. Poochho runs availability
  checks across hundreds of retailers in an afternoon, in each shop's language.
- Unit economics, measured: our first real search cost **≈ ₹13.8** in Bolna call charges for a quote call plus a
  hold call (15¢ US; **early pilot, n = 1**). Stopping once found cuts calls per search.

## 7. Compliance and defensibility (2:35–2:45)

- **TRAI (18 Sep 2026):** businesses must declare A2P calls (auto-dialled, robo, pre-recorded or artificial-voice) to
  their telecom operator in advance, with the numbers they call from, or the calls count as spam. Poochho calls from
  a declared number, only shops that consented, and records opt-outs permanently.
- **Drugs and Cosmetics Rules, Rule 65(11-A):** a chemist may not supply any other preparation in place of a Schedule
  H, H1 or X prescription, even one with the same substance. Poochho never recommends a substitute; it reports only
  what the chemist said.
- **DPDP Rules 2025:** the core duties apply from **13 May 2027** (the consent-manager rule from Nov 2026). Poochho
  already announces recording, keeps phone numbers on the server, and shows transcripts of real calls only to the
  operator.
- **The moat:** a consent-first network of shops that agreed to be called, and labelled call outcomes (`/metrics`
  extraction accuracy) that no scraper has.

## 8. Real metrics (2:45–2:52)

From `/metrics?mode=live` only. Today it reads **early pilot, n = 1**: 1 real quote call, answered, first usable quote
**111 s** after dialling, **≈ ₹8.28** per answered call. Update these after the recorded LIVE run; if n < 10, say
"early pilot, n = [n]" rather than quoting a percentage.

## 9. The ask (2:52–3:00)

- **[e.g. Bolna credits and support for a 100-shop Pune pilot; introductions to a pharmacy chain or distributor;
  mentors in telecom compliance.]**
- "You ask once. Poochho asks everyone."

## Sources

| Fact | Source |
|---|---|
| Prescribed brand unavailable in 10–60% of cases | <https://www.biospectrumindia.com/public/news/73/25721/leading-pharma-companies-have-significant-gaps-in-brand-availability-at-chemists-report.html> |
| 86% bought medicines mainly from local chemists | <https://theprint.in/feature/64-of-indians-bought-medicine-without-a-prescription-finds-survey/3045890/> |
| 98% accessed Indic-language content | <https://www.storyboard18.com/digital/surge-in-indic-language-adoption-leads-to-55-surge-in-rural-internet-users-53632.htm> |
| Bolna: 60–70% English or Hindi | <https://techcrunch.com/2026/01/20/bolna-nabs-6-3-million-from-general-catalyst-for-its-india-focused-voice-orchestration-platform/> |
| Let Google Call | <https://blog.google/products/shopping/agentic-checkout-holiday-ai-shopping/> |
| Medfinder pricing | <https://www.medfinder.com/pricing> |
| 26% unanswered, 48% no price | <https://cxm.world/digital-experience/googles-ai-is-phoning-businesses-for-pricing-and-many-arent-answering-survey-reveals/> |
| AIOCD ~12.4 lakh members | <https://www.etvbharat.com/en/health/pharmacies-across-india-shut-may-20-epharmacy-concerns-enn26051305103> |
| 1.4 crore kiranas, 75–80% of FMCG | <https://www.pib.gov.in/PressReleasePage.aspx?PRID=2272311&reg=48&lang=1> |
| Awign store audits and telecalling | <https://business.awign.com/industry/fmcg> |
| TRAI PR 119/2026 | <https://www.trai.gov.in/sites/default/files/2026-09/PR_No119of2026.pdf> |
| Rule 65(11-A) | <https://cdsco.gov.in/opencms/export/sites/CDSCO_WEB/Pdf-documents/acts_rules/2016DrugsandCosmeticsAct1940Rules1945.pdf> |
| DPDP Rules 2025 | <https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf> |
