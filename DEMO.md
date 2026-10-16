# Poochho: 90-second demo

**Timing basis.** In SIMULATED/REPLAY runs on the dev setup, all calls finish **15–20 s** after dialling (measured
2026-10-16). Real Bolna calls take longer. The agent's own target is about 45 s, and Bolna can need extra seconds
to minutes to finalise extraction. So do not rely on live calls finishing inside 90 seconds on stage. Run live
calls at rehearsal, record them with `npm run replay:export`, and present the **REPLAY** of that real run. Its
banner says so honestly.

## Before you go on stage (T-10 min)

- [ ] `npm run dev` (or the deployment) is up. Tab 1: home page. Tab 2: `/metrics?mode=live`.
- [ ] The replay you'll use is recorded from a **real** run (`source: live`) and appears under Replay on the home page.
- [ ] For a live segment: it's between 09:00 and 20:00 IST, `LIVE_CALLS_ENABLED=true`, and `npm run bolna -- check`
      shows the wallet balance and concurrency. Test phones are charged, unmuted, and their owners have agreed.
- [ ] The operator token is pasted once (it is remembered for the tab).
- [ ] Laptop volume is up for the spoken summary. If the venue audio is bad, the text summary is on screen anyway.
- [ ] Browser zoom at 110–125% on the projector.

## Script

| Time | Screen | Say |
|---|---|---|
| 0:00–0:10 | Home page, headline | "Need Dolo 650 at 10 pm? You call six chemists, four don't pick up. India's shops have no inventory API. **The phone is the API.** Poochho calls for you." |
| 0:10–0:20 | Choose **Replay** (or Simulated), pick the run, **Play replay**. *Live alternative: type "Amul Butter, 2 packet, Kothrud, Pune", Find for me, review the 5 shops, Place 5 calls.* | "I ask once. Poochho rings five nearby shops **at the same time**, in Hindi. You review exactly who gets called, and only shops that agreed to test calls can be called." |
| 0:20–0:50 | Switchboard: lamps ring (marigold), talk (blue waveform), answer (green); one shows *Not reached · No answer* | "Every call says *I'm an AI assistant* in its first sentence, asks three questions — stock, price, can you hold it — and hangs up in under a minute. This shop didn't answer; we never retry automatically." |
| 0:50–1:05 | Scroll to **Ledger**, point at a shop's quoted words | "Answers come back as structured data, ranked by a fixed formula, not an LLM, and availability comes first: who has it, how soon, will they hold it. Price is second, because packaged goods carry a printed MRP. Under each shop: its **own words**, checked word for word against the call transcript, and how fresh the answer is. Mehta didn't quote a price, so it says *not quoted*, never zero. Patil only has one packet, so it can't be the best match, however cheap." |
| 1:05–1:20 | Best-match card, **Hold it**, **Yes** | "One tap places a second, separate call asking Sharma Kirana to keep it aside. It only says *reserved* if the shop actually agrees on that call." Wait for **Reservation confirmed by the shop**. |
| 1:20–1:30 | Point at the **time-saved** strip and the cost line, pick **मराठी** (or the judge's language), **Hear the summary**, point at WhatsApp | "Measured from this run: all calls together took X, one by one would take Y, and the whole search cost ₹Z in call charges. And the answer comes back in your language: eleven Indian languages through Sarvam. **You ask once. Poochho asks everyone.**" (A simulated run says it used no credits; quote ₹Z only from a real run or its replay.) |

**For the interview (operator token in the tab):** on a real call's card, **Play the call recording** lets judges
hear the actual shopkeeper. The agent's first sentence says it is an AI and that the call is recorded.

**Optional opener (Sarvam, needs the operator token in the tab):** tap **Speak in any Indian language** and say one
sentence in Marathi/Tamil/Hindi, e.g. "मला कोथरूड, पुणे मध्ये दोन पॅकेट अमूल बटर हवे आहे". The whole form fills itself
(product, quantity, area, city) in about 3 seconds. Rehearse it on the venue's mic first; if it mishears, fix the field
by hand and say "you always review before anything is called".

## If something goes wrong

| Problem | Do this |
|---|---|
| Live calls slow or unanswered | Say "real shopkeepers are busy, here's the run we recorded an hour ago", then **Replay** that run. The REPLAY banner keeps it honest |
| No replay of a real run yet | Use **Simulated**. The banner says scripted demo; say so out loud |
| Venue Wi-Fi down | Phone hotspot. Supabase must be reachable for every mode |
| Spoken summary silent | Read the on-screen summary; it is the same text |
| Everything down | Play the screen recording from rehearsal (record one) |

Never present simulated or replayed results as live, and never quote metrics from simulated runs as real-world
performance (`/metrics` labels them).
