# SPECTR — the async social core (publish → listen → react-on-the-timeline)

> From the 2026-06-16 session. The bootstrappable heart of the community (works from ONE listener; live room comes later). See `PRPs/spectr-flywheel.md` for the whole machine.

## Identity model (resolves anon ↔ match tension)

Persistent account underneath; **configurable public face** on top. You choose: display name (or "Anon"), profile visibility, whether your other tracks show, comments/reactions on/off. Two graphs: **friends** (mutual, opt-in) and **bookmarks** (one-way save). Taste-match uses account-level fingerprint, renders per your privacy config.

---

## The flow

### A. Publish (from the Library)
Action on any analyzed version: **"Publish for feedback."** Settings:
- **Identity:** real name · custom · Anon
- **Visibility:** discoverable in feed / unlisted-link-only
- **Allow:** reactions · timestamped comments · "open to collab" flag
- **Optional ask:** "what do you want feedback on?" (e.g. "the drop")
Publishing is **free** (you want volume). Result = a public **Track Page**.

### B. The Feed (discovery + the reciprocity engine)
Sorts: **For You** (taste-matched) · **Fresh** (recent) · **Needs ears** (low-feedback tracks) · **Genre**.
- **Reciprocity lever (cold-start critical):** a track surfaces *more* when its artist has recently *given* substantive feedback. Give-to-get, automated and harder to game than Discord threads. Anti-leech.
- Card: waveform/cover · name-or-Anon · genre/BPM · "3 left a note" · ▶.

### C. The Track Page (the ALIVE listener — this is where the soul lives)
Reuse the Listen/DJ aesthetic (living spectrum/waveform), not a static player.
- **React-on-the-timeline (the core interaction):** while it plays, tap an emoji → it **floats up on the stage** (the "appear on stage" moment) AND pins to that timestamp.
- **Comment at a timestamp:** click the waveform → leave a note at that moment.
- **Aggregate heat:** the waveform shows reaction density — 🔥 clusters at the drop, 😴 valleys at the boring part. Anyone can read "crowd loved 0:48, slept at 2:14."
- **Bookmark · Friend-request · Follow.**

```
┌──────────────────────────────────────────────────────────────┐
│  ◀ feed     "untitled drop" · Anon · deep house · 124      ☆  │  ☆ bookmark
│                                                          + add │  +add friend
│   living spectrum / waveform  ▁▂▅█▇▅▂▁▂▅▇█▇▅▂▁   ← playhead ▮  │
│   reaction HEAT:  🔥🔥──😴😴😴────❤️──                          │
│   0:00        1:30     2:14          3:20                      │
│  [▶] 2:14 / 5:32     tap to react → 👍 👎 🔥 😴 ❤️ 😂          │
├──────────────────────────────────────────────────────────────┤
│  NOTES (timestamped)                                           │
│  2:14  glitch_9   "this breakdown drags — cut 8 bars"         │
│  0:48  nova_kit   "ok this drop is sick 🔥"                    │
└──────────────────────────────────────────────────────────────┘
```

### D. Back to the artist — reactions become findings (closes the loop)
The artist's view of their published track = the same heat map + every comment by timestamp. Crucially, **crowd sentiment becomes a finding** alongside the AI findings:
> "Listeners disengaged 2:10–2:30 (8 😴)" — ground truth, sitting next to the machine's guesses.
→ motivates a revision → re-analyze → re-publish v+1. The exposure loop, wired.

### E. Credit / reciprocity flow
- **Earn:** give a *substantive* reaction/comment (weighted by whether the artist marks it helpful — reuse the existing verdict helpful/wrong mechanic). Earns credits + surfaces your own tracks.
- **Spend:** analyze · **boost** (surface your track to more ears faster). Publishing itself is free.
- Low-effort spam-react earns ~nothing (quality gate).

---

## Reuse (most of this exists)
- **Bookmarks**, **share tokens / public report pages**, the **Listen player + waveform**, **library/versions**, **credits/entitlements** — all already in the codebase.
- Genuinely new: the **feed + reciprocity surfacing**, the **react-on-timeline** interaction + heat aggregation, and the **reactions→findings** bridge.

## Why this is the right starting surface
- Works from **one** listener (no density requirement → survives cold start).
- Reuses the **alive** aesthetic (the soul) instead of a dead report.
- Ships the **motivation loop** (get heard → fix → re-publish) which is the actual reason people improve.
- The live room is the same Track Page with the stage/chat/DJ rails turned on — built later, for free.

## Economy — decisions (locked 2026-06-16)

**Two separate currencies — "buy tools, earn ears":**
- **Credits** — spend on *tools* (analyze, boost, DJ a set). Buyable with money, or earned via valuable feedback.
- **Standing** (karma) — governs *feed visibility* + your reviewer earn-multiplier. **Earned only, never buyable.** You can buy analyses; you cannot buy attention. (Anti-pay-to-win — protects the vibe + the "unique music" crowd.)

**Reciprocity surfacing = the cold-start spine (locked):** your track gets more ears the more feedback you've *recently given* — regardless of credits. Works for the broke producer; the give-to-get culture of producer Discords, automated and less gameable.

**Earning (tiered by value, reputation-gated):**
- Listen attentively (≥~⅔ played + ≥1 reaction) → tiny **standing** trickle, hard daily cap; **barely any credits** (protect revenue / prevent a free-analysis grind mill).
- Timestamped comment → more.
- Comment the artist marks 👍 helpful → the **real earn** (credits + standing). Reuse the existing verdict helpful/wrong mechanic.
- **Reputation multiplier:** consistently-helpful reviewers earn more per action; spammers decay toward zero. The anti-farming spine.

**Heat = PUBLIC (locked):** the crowd reaction heat is visible to everyone — it's fun, it's social proof, AND it's data (🔥 spammed at 1:32 = "that moment hits"). Accept the mild performance-anxiety tradeoff; the brand is playful/opt-in/anonymous-friendly, which offsets it.

**Standing tension to watch:** keep the listening faucet *symbolic* for credits so the business (selling analyses) isn't cannibalized; let money be the fast path to lots of analyses, and valuable feedback the earned path.
