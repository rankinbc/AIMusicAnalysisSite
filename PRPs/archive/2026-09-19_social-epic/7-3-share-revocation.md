# Story 7.3: Share Revocation

Status: review

## Story

As a report owner,
I want to kill a share link anytime,
So that sharing is always reversible.

## Acceptance Criteria

1. **Given** my active share (FR23), **When** I revoke it, **Then** the token soft-deletes and `/r/{token}` returns a friendly gone page.
2. **Given** regeneration, **When** I create a new link, **Then** the old token stays dead.
3. **Given** the share controls (UX-DR42), **When** rendered, **Then** a lock/globe glyph + one-line scope text state exactly what a share exposes.

## Pre-existing surface

- AC1 backend: `DELETE /api/analyses/{id}/share/` nulls the token (revocation); the public API 404s. The friendly gone page shipped with 7.2 (`OgShareEndpoints.GonePage` — crawler path) and the SPA's "Share link not found / may have been revoked" state (`/r/$token` route) covers human visitors.
- AC2 backend: regenerate endpoint + old-token-dead integration test shipped with 7.1.

## What this story ADDED

- **AC3 (UX-DR42)** — `SharePublishDialog`: 🌐 scope banner stating exactly what a share exposes ("anyone with it can play the track and see the grade, score, top signals and comments") AND what it never does ("your project file, stems and library stay private" — the 7.1 projection makes that claim true by construction). Revoke button carries the 🔒 glyph.
- **AC2 UI** — `↻ Regenerate` button wired to `useRegenerateShare` (new hook → `POST .../share/regenerate`); success toast states the old link is dead; the dialog swaps to the new URL in place.
- Tests: `SharePublishDialog.test.tsx` (jsdom + testing-library, fetch stubbed): scope banner content incl. the stays-private clause; revoke + regenerate controls present.

## Dev Agent Record

- 2026-07-02: implemented on `social/epic-7-11`. Gates: frontend build/tsc/eslint/vitest 623/623. Status → review.
