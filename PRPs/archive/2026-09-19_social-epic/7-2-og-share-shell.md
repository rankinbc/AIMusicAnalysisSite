# Story 7.2: OG Share Shell

Status: review

## Story

As a share recipient on Discord,
I want the link to unfurl with the grade and track name,
So that the post sells itself before anyone clicks.

## Acceptance Criteria

1. **Given** `/r/{token}` fetched by a crawler or chat app (FR22, AR28), **When** the BFF responds, **Then** it serves a prerendered HTML shell with OG/Twitter meta (grade, verdict text, track name, static branded OG image) and the inline projection JSON, **And** the SPA hydrates the route for human visitors.
2. **Given** per-report privacy, **When** meta renders, **Then** `noindex` applies per report.
3. **Given** the 5-second test, **When** the page loads at 360 px, **Then** grade + verdict text sit above the fold.

## Dev Agent Record

### Completion Notes List

- **AC1** — `Endpoints/OgShareEndpoints.cs`: root-level `GET /r/{token}` (outside `/api`). Serves a self-contained HTML shell: og:title "{song} — grade {G} on SPECTR", og:description = hottest verdict headline (show_verdicts-gated) or score line, og:image `/og-share.png` (new branded 1200×630 static in frontend `public/`), twitter:card summary_large_image, plus `<script type="application/json" id="share-projection">` carrying the 7.1 default-deny projection (never the raw final_json — leak-marker asserted in tests). HTML-escaped via HtmlEncoder.
- **Human-vs-crawler split** — `nginx.conf` `/r/` location: bot user-agents (discord/slack/twitter/facebook/whatsapp/telegram/linkedin/google/bing/embedly/pinterest/skype) proxy to the BFF shell; everyone else gets the SPA (`try_files /index.html`). URI-less `proxy_pass` inside `if` = the sanctioned nginx pattern. Dev (Vite) serves the SPA directly — meta only matters where crawlers reach the stack.
- **AC2** — `noindex, nofollow` on every shell, including the 404 gone page.
- **AC3** — shell body is single-column centered with the grade as a 72 px block at the top; the SPA page (7.1) leads with GradePill + score in the header. Unknown/revoked token → friendly "This share link is gone" shell (7.3's AC1 surface, already in place).
- Tests: `OgShareShellTests` (2, Postgres-gated) — meta + escaping + noindex + projection-only + inline JSON; gone-page 404.

### File List

- `components/bff/src/Spectr.Bff/Endpoints/OgShareEndpoints.cs` (new) + Program.cs root mapping
- `components/frontend-spectr-v2/nginx.conf` (bot-split /r/ location)
- `components/frontend-spectr-v2/public/og-share.png` (new branded OG image)
- `components/bff/tests/Spectr.Bff.Tests/OgShareShellTests.cs` (new, 2 tests)

### Change Log

- 2026-07-02: implemented on `social/epic-7-11`; gates green (BFF 237/237 excl. Stripe webhook per direction; vite build OK). Status → review.
