# Validation test — is the AI hook good? (2026-06-16)

> The cheap make-or-break test before building more. ~1–2 weeks, ~$0, **zero new product code** (you already have the analyzer — you just run tracks and collect honest opinions). Answers risk #2 from `spectr-vision-2026-06-16.md`: is the analyzer good enough to be the cold-start fuel?

## The question (precise)

On **audio-only** uploads (no stems/.als — test the hook at its lowest-friction), are SPECTR's findings/Moves:
1. **Correct** (not confidently wrong)?
2. **More useful** to a real target producer than the market leader (TrackScore)?
3. Worth paying for?

Audio-only is the point: it's how 90% of first-time users arrive. If your edge only appears after someone uploads stems + a project file, the frictionless hook isn't differentiated.

## Setup

- **5 tracks**, target genre (trance/house/techno), at "almost-there" bedroom quality (the ICP's work — yours, friends', or community WIPs). Include **1 known-good pro track as a control** (does the tool correctly say "this is clean," or invent problems?).
- For each: run through **SPECTR (audio-only)** AND **TrackScore**. Capture both outputs.
- **Strip branding**, label outputs **A / B**, randomize which is which per track.

## Two measurements

**1. Correctness (the killer metric) — expert ear pass.**
Before showing producers, have a trained ear (a real mix engineer — hire a freelancer for ~$50, or you, brutally honest) score every SPECTR Move:
`correct` · `plausible-but-unverifiable` · `wrong/harmful`.
**The `wrong/harmful` rate is the whole ballgame.** Confidently-wrong advice kills trust faster than no advice.

**2. Usefulness + willingness — blind producer preference test.**
Recruit **~10 target producers**. Per track, show A vs B blind, ask the 6 questions below.

## The producer question sheet (per track, A vs B blind)

1. Which feedback is more useful for improving **this** mix?  A / B / tie
2. Which would actually change what you'd do in your DAW?  A / B / neither
3. Anything in A or B that's **wrong** or you'd disagree with? (which + what)
4. If you could keep only one, which?  A / B
5. Would you pay ~$13/mo for the one you picked?  yes / no / maybe — why?
6. What's missing that would make it a must-have?

## Recruiting message (copy-paste — value-first, respects community norms)

> Hey — I'm a producer building an AI tool that tells you *what to fix* in your mix (not just a score). I'm testing whether it's actually any good vs what's already out there, and I need ~10 sets of honest ears.
>
> The ask: ~10 min. I show you two sets of feedback on a track, you tell me which is more useful and call out anything that's flat-out wrong. Blind — you won't know which tool is which.
>
> What you get: free analyses on your own tracks, and you'll see how the tools stack up. Happy to return feedback on your stuff too.
>
> Comment or DM if you're in. 🙏

(Post in ONE genre Discord/subreddit you're already in, or DM warm contacts. Don't spam; lead with the reciprocity.)

## Pass bar + what each outcome means

| Result | Reading | Do next |
|---|---|---|
| Correctness clean (`wrong/harmful` < ~10%) **AND** SPECTR wins "more useful" in ≥~⅔ of comparisons | **The hook has fuel.** | Build the async craft + publish→react core. |
| Correctness clean, but **tie/lose** on usefulness (audio-only) | Your depth (stems/.als) is doing the work; the frictionless hook isn't differentiated. Or the market rewards simplicity. | Investigate *before* building — is the wedge depth? presentation/voice? Don't assume. |
| **High `wrong/harmful` rate** | **STOP.** The analysis/pattern engine is the problem; nothing downstream matters. | Fix the pattern-first engine + validator first. (Cheapest, most important finding.) |

## Cautions (small-N honesty)

- Blind + randomized + branding stripped, or brand bias swamps the signal.
- Don't recruit only friends — they're nice. Strangers from the genre community.
- Explicitly ask about *wrongness* (Q3) — producers won't volunteer it.
- N=5 tracks / 10 people = a **signal, not proof.** A clear directional result is all you need to decide build-vs-fix.

## Cost / timebox

~1–2 weeks elapsed; ~$0–50 (freelance ear + small incentives). No product code. The most decision-relevant 2 weeks you can spend right now.
