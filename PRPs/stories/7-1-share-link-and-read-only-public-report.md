# Story 7.1: Share Link & Read-Only Public Report

Status: review

## Story

As a proud producer,
I want a public link to my report that shows my result without exposing my project,
So that I can post it in Discord safely.

## Acceptance Criteria

1. **Given** a report (FR21), **When** I create a share link, **Then** a random 128-bit token generates — one per report, with regenerate support (AR28).
2. **Given** `/r/{token}`, **When** a stranger opens it, **Then** the read-only single-column 880 px page renders: brand mark → VerdictHero → top 3 verdicts with evidence chips (no chat) → frequency chart vs genre (UX-DR35).
3. **Given** the projection (FR22), **When** the share payload serializes, **Then** the `ShareReportProjection` allowlist DTO is the ONLY source — .als internals and raw stems never appear (a default-deny test asserts it).
4. **Given** a recipient view, **When** rendered, **Then** no owner controls appear.

## Pre-existing surface (verified before building — most of 7.1 already shipped in the Listen-V3 slice)

`ShareEndpoints.cs` already had: owner create/patch/revoke (192-bit URL-safe token, exceeds the 128-bit AC), public GET + Range audio + peaks + anonymous comments; frontend `/_public/r.$token.tsx` already rendered the read-only single-column page (grade, score, BPM/key/LUFS, native audio, comments) with zero owner controls (AC4).

## What this story ADDED (the gaps)

- **AC3 (the security gap)** — `Services/ShareReportProjection.cs`: DEFAULT-DENY allowlist projection. The public payload previously served the RAW `final_json` (leaking .als track/device internals, stem paths, upload keys). Now only allowlisted values project: root grade/overall_score/danceability_score; phase 1 numeric summary keys; phase 2 genre+confidence; phase 6 percentiles. Phases 3/4/5/7/8 never project. Unknown fields never flow through (that's the property, not a blocklist).
- **AC3 test** — `ShareReportProjectionTests`: poisoned final_json (MUST_NOT_LEAK markers in root/phase1/phase4/phase8) asserts markers absent + allowlist present, both unit-level and across the wire via the anonymous endpoint (Postgres-gated).
- **AC1 regenerate** — `POST /api/analyses/{id}/share/regenerate`: fresh token, old token immediately 404s (integration-tested).
- **AC2 top-3 verdicts** — `/r/$token` now renders "Top signals" (first 3 projected verdicts: severity, metric line, headline/summary, ≤4 evidence chips) when the owner enabled show_verdicts.

## Deferred (named follow-ons)

- Frequency-chart-vs-genre visual (AC2's chart) — projection now carries `frequency_balance`/`bands` + phase-6 percentiles, so the chart is a pure frontend add; slotted with the 7.2 OG shell work where the page gets its 360 px above-the-fold pass.
- Lock/globe scope glyph + one-line scope copy = 7.3 (UX-DR42).

## Dev Agent Record

- 2026-07-02: gaps implemented on `release/phase-0-hygiene`. Gates: BFF 235/235 (Stripe webhook excluded per 2026-07-02 direction), frontend build/tsc/eslint/vitest 621/621. Status → review.
