# UI Reference Images

Reference screenshots for the Listen-page rack redesign. The implementer treats
images here as the **source of truth for visual fidelity** — it screenshot-compares
its rendered output against them and iterates until they match (see the "Fidelity
workflow" section of `PRPs/listen-ui-design-prompt.md`).

## What goes here

- **`baseline-*.png`** — screenshots of the CURRENT app, captured before the redesign,
  to lock the existing visual language the new UI must match. Capture at least:
  - `baseline-listen.png` — the current Listen page (the thing being redesigned)
  - `baseline-library.png` — the song library
  - `baseline-results.png` — a results page
  - `baseline-login.png` — the auth screen (type scale / button / token reference)
- **`mockup*.png`** — the target design(s) for the new rack (from Claude design), if any.

Commit these — they travel with the repo so any machine / agent has the visual target.

## How to capture (needs the app running)

1. Bring the stack up (a logged-in user + a version with audio):
   ```
   docker compose -f docker/docker-compose.yml up -d
   # + BFF, worker, and `cd components/frontend-spectr-v2 && npm run dev` per root CLAUDE.md
   ```
2. With the Playwright browser tools: `browser_navigate` to each page, then
   `browser_take_screenshot` and save the file here. Capture the Listen page at a
   realistic viewport (e.g. 1440×900) with a real version loaded.
3. For the redesign, the implementer keeps re-capturing the Listen page into a scratch
   dir during the loop and diffs it against `mockup*.png` / `baseline-listen.png`.

This can't be done in a backend-less environment — run it on the dev machine.
