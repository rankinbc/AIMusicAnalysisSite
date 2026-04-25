# AI Mix Experts

An expert analysis panel on the report page that routes a completed mix analysis through 24 specialist AI prompts via the Claude API. Users start with a **Triage** step that reads the full analysis JSON and identifies the 2–3 most impactful problem areas, then run individual specialist reports that stream in real time.

---

## User flow

1. Open a completed analysis report (`/report/:jobId`).
2. Scroll to the **Expert Analysis** panel at the bottom.
3. Click **Run Triage** — Claude reads the analysis and returns a prioritised problem summary plus a recommended specialist list. Takes ~5–15 seconds (not streamed).
4. The recommended specialists appear as cards. Click **Run** on any card to stream a deep-dive report in markdown.
5. Use **Show all 23 →** to access the full specialist list beyond the recommendations.
6. Click **Cancel** to abort a stream mid-way. Click **Re-run** to retry.

---

## Configuration

| Env var | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | API key for the Claude API — set in `components/api/.env` |
| `OUTPUT_DIR` | No | Where analysis JSON files are stored. Defaults to `output`. Must contain `analysis_results/{job_id}.json` |

Add to `components/api/.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
```

---

## Architecture

```
Browser                       FastAPI (components/api)              Claude API
───────                       ────────────────────────              ──────────
POST /api/experts/{id}/triage ──► validate job ownership
                                  load output/analysis_results/{id}.json
                                  run_triage(analysis_json) ──────► claude-sonnet-4-6
                              ◄── { text, recommended_specialists }

POST /api/experts/{id}/specialist/{name}
  (fetch + ReadableStream)    ──► validate job ownership + specialist name
                                  stream_specialist(name, analysis_json) ─► claude-sonnet-4-6
  ◄── SSE stream (text/event-stream)                                    ◄── token stream
       event: chunk  data: {"text": "..."}
       event: done   data: {}
```

**Why `fetch` instead of axios for streaming:** The `EventSource` API and axios cannot send custom HTTP headers like `Authorization: Bearer`. The specialist endpoint uses `fetch` + `ReadableStream` which supports full HTTP request control.

**Prompt caching:** Every Claude call sets `cache_control: {"type": "ephemeral"}` on the system prompt. The large specialist `.md` files are cached at the API layer for ~5 minutes, reducing token cost and latency on repeated calls.

---

## The 24 specialists

| Name | Focus |
|---|---|
| **Triage** | Routes to the highest-impact specialists (run first) |
| **LowEnd** | Kick/bass relationship, 50–150 Hz, sidechain settings |
| **FrequencyBalance** | Full-spectrum EQ balance vs. genre targets |
| **Dynamics** | Crest factor, compression, section energy map |
| **StereoPhase** | Correlation, mono compatibility, bass below 150 Hz |
| **Loudness** | LUFS targets (Spotify −14, Apple −16, club −8 to −10) |
| **Sections** | Structural contrast, energy flow, arrangement |
| **TranceArrangement** | Trance-specific arrangement conventions |
| **StemReference** | Per-stem comparison against reference tracks |
| **HarmonicAnalysis** | Key detection, chord progressions, tension/release |
| **ClarityAnalysis** | Masking, mud, definition between elements |
| **SpatialAnalysis** | Width, depth, reverb placement |
| **SurroundCompatibility** | Fold-down safety, downmix checks |
| **PlaybackOptimization** | Club system, headphone, and small-speaker translates |
| **OverallScore** | Weighted quality score across all dimensions |
| **GainStagingAudit** | Gain structure from input to master bus |
| **StereoFieldAudit** | Detailed stereo image and M/S analysis |
| **FrequencyCollisionDetection** | Overlapping frequency ranges between elements |
| **DynamicsHumanizationReport** | Groove, timing micro-variations, feel |
| **SectionContrastAnalysis** | Contrast between drop, breakdown, and build |
| **DensityBusynessReport** | Note density, arrangement space, breathing room |
| **ChordHarmonyAnalysis** | Harmonic richness, chord voicings, extensions |
| **DeviceChainAnalysis** | Plugin chain review, redundant processing |
| **PriorityProblemSummary** | Ranked list of all issues found across the mix |

---

## File map

```
components/api/
  prompts/experts/          24 specialist .md system prompts
  app/
    services/
      expert_service.py     load_prompt, run_triage, stream_specialist
    routers/
      experts.py            POST /{job_id}/triage, POST /{job_id}/specialist/{name}
  tests/
    test_expert_service.py  8 unit tests
    test_experts_router.py  3 integration tests

components/frontend/src/features/experts/
  useExpertAnalysis.ts      Hook: triage state + specialist streaming state
  ExpertsPanel.tsx          Top-level container — triage button, loading skeleton
  TriageView.tsx            Collapsible triage report + specialist card list
  SpecialistCard.tsx        Run/Cancel/Expand per specialist
  ExpertOutput.tsx          Streaming markdown renderer (react-markdown)
```

---

## API reference

### `POST /api/experts/{job_id}/triage`

Auth: `Authorization: Bearer <token>` required.

Validates that `job_id` belongs to the authenticated user, loads the analysis JSON, and calls Claude with the Triage system prompt.

**Response** `200 OK`:
```json
{
  "text": "## Triage Report\n...",
  "recommended_specialists": ["LowEnd", "Dynamics", "StereoPhase"]
}
```

**Errors**: `401` (no/invalid token), `404` (job not found or analysis not complete)

---

### `POST /api/experts/{job_id}/specialist/{specialist_name}`

Auth: `Authorization: Bearer <token>` required.  
Accept: `text/event-stream`

Streams the specialist's analysis as server-sent events.

**Valid specialist names**: all 23 non-Triage names in the table above.

**SSE events**:
```
event: chunk
data: {"text": "token or phrase from Claude"}

event: done
data: {}
```

**Errors**: `400` (unknown specialist name), `401`, `404`

---

## Running the tests

```bash
cd components/api
python -m pytest tests/test_expert_service.py tests/test_experts_router.py -v
# 11 tests, all mocked — no real Anthropic calls made
```
