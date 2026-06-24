# Listen-page UI Design — Launch Guide

How to prepare and launch the separate **"Claude design"** session that will design
+ build the new Listen-page DSP rack UI. The design brief itself is
`PRPs/listen-ui-design-prompt.md` (read that for the actual task + constraints); this
file is just the operational checklist for getting that session running.

## Where it runs

A **fresh Claude Code session on this machine**, in the repo root, on the
**`listen-ui-overhaul`** branch (already checked out).

- Fresh session = clean context for a large design + build job.
- Same machine = it can run the **screenshot loop** (live app + Playwright driving a
  real Listen page), which is the single biggest fidelity lever in the brief.
- Cloud / web Claude can generate mockups but **cannot** see the running stack, so the
  screenshot loop would be skipped — not recommended for this work.

## Step 1 — Bring the stack up (before starting the design session)

The design session needs a live, logged-in Listen page with real audio. From the repo
root, in separate terminals (leave them running):

```bash
docker compose -f docker/docker-compose.yml up -d           # Postgres, Redis, allin1
cd components/bff/src/Spectr.Bff && dotnet run              # BFF on :5000
cd components/worker && python -m dramatiq app.dramatiq_app  # dramatiq worker
cd components/frontend-spectr-v2 && npm run dev             # frontend on :5174
```

## Step 2 — Ensure a logged-in user + a version *with audio*

Open `http://localhost:5174`, register / log in, and confirm at least one song version
has an uploaded mix and finished analysis (so the Listen page has audio + phase data).
Note its Listen URL:

```
http://localhost:5174/listen/<versionId>
```

You'll hand that `<versionId>` URL to the design session as its test target.

## Step 3 — (Optional) engine smoke test

The design session can run `PRPs/listen-smoke-script.md` in the browser console to
confirm the engine works before trusting it — the handle is exposed in dev as
`window.__spectrGraph`. Optional, but it's there.

## Step 4 — Launch the session and paste this prompt

Open a new Claude Code session in this repo and give it (fill in `<versionId>`):

> Read `PRPs/listen-ui-design-prompt.md` and follow it exactly. You're designing +
> building the new Listen-page DSP rack UI on the `listen-ui-overhaul` branch. The
> engine is frozen — bind to the `useAudioGraph` handle only. The stack is already
> running; a Listen page with real audio is at
> `http://localhost:5174/listen/<versionId>`. Start by invoking the
> `superpowers:frontend-design` skill, capture the baselines into `ui-reference/`
> (step 0), then propose 2–3 layout/IA mockups for my approval before building. Design
> direction is settled in the brief — don't re-litigate it.

## Settled design direction (already in the brief)

Encoded in `PRPs/listen-ui-design-prompt.md` so the design session inherits it instead
of re-asking:

- Keep the current **cool dark/neon, visualizer-rich** aesthetic + `tokens.css` language
  — evolution, not a restyle.
- Read as a **legitimate pro tool** (precise controls, real meters, clear signal flow).
- **Coexist with listening-room features** (visualizer stage, laser show, DJ stem deck,
  notes — more planned) — don't crowd them out.
- **No mockup exists** → design the look from the aesthetic, show 2–3 mockups, get
  approval before building.
- **Layout / IA is the design session's call** (pedalboard chain vs channel strip vs
  tiered dashboard, etc.) — the product owner deferred it.

## State at handoff

- ✅ `listen-ui-overhaul` branched off `origin/master` — full engine (Phases 1–5) + all
  UI-prep artifacts: this brief, `PRPs/listen-dsp-rack-capabilities.md`,
  `features/listen/rackManifest.ts`, `features/listen/meterHooks.ts`,
  `PRPs/listen-smoke-script.md`, `features/listen/README.md` (living system guide).
- ✅ Design direction committed into the brief (`cf835bb`).
- ⏳ `ui-reference/` baselines **not captured** (stack was down at prep time) — the design
  session captures them as its step 0 once Steps 1–2 above are done.
