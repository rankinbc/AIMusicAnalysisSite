# AI Mix Experts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Expert Analysis panel to the report page that lets users invoke any of 24 specialist AI prompts (via Claude API) against their analysis JSON — starting with a Triage step that routes to the 2-3 most impactful specialists, then streaming each specialist's full markdown report in real time.

**Architecture:** A new FastAPI router (`/api/experts`) loads specialist `.md` system prompts from disk and forwards the job's analysis JSON to Claude (claude-sonnet-4-6) via the Anthropic async SDK with prompt caching. Triage is a blocking POST returning JSON + recommended specialist list. Each specialist streams its response via SSE, consumed on the frontend using `fetch` + `ReadableStream` so Bearer auth headers can be sent. The existing `ReportPage` gains an `ExpertsPanel` section at the bottom — no existing sections are modified.

**Tech Stack:** Python (anthropic>=0.40.0, FastAPI, sse-starlette), TypeScript (React 19, fetch ReadableStream, react-markdown)

---

## File Map

### Backend — create

| File | Responsibility |
|---|---|
| `components/api/prompts/experts/*.md` | 24 specialist system prompts (copied from AbletonAIAnalysis) |
| `components/api/app/services/expert_service.py` | Load prompts, call Claude API, yield SSE chunks |
| `components/api/app/routers/experts.py` | POST `/triage`, POST `/specialist/{name}` (SSE) |
| `components/api/tests/test_expert_service.py` | Unit tests for service layer |
| `components/api/tests/test_experts_router.py` | Integration tests for router |

### Backend — modify

| File | Change |
|---|---|
| `components/api/requirements.txt` | Add `anthropic>=0.40.0` |
| `components/api/app/config.py` | Add `anthropic_api_key`, `output_dir` settings |
| `components/api/app/main.py` | Register experts router |

### Frontend — create

| File | Responsibility |
|---|---|
| `components/frontend/src/features/experts/useExpertAnalysis.ts` | Triage POST + specialist fetch-stream hook |
| `components/frontend/src/features/experts/ExpertsPanel.tsx` | Container — renders triage button, specialist cards, outputs |
| `components/frontend/src/features/experts/TriageView.tsx` | Displays triage markdown + recommended specialist buttons |
| `components/frontend/src/features/experts/SpecialistCard.tsx` | Single specialist button + streaming output area |
| `components/frontend/src/features/experts/ExpertOutput.tsx` | Renders streaming markdown with react-markdown |

### Frontend — modify

| File | Change |
|---|---|
| `components/frontend/package.json` | Add `react-markdown` |
| `components/frontend/src/types/api.ts` | Add `TriageResult`, `ExpertChunk` types |
| `components/frontend/src/features/report/ReportPage.tsx` | Add `<ExpertsPanel jobId={jobId} />` at bottom |

---

## Task 1: Copy Specialist Prompts into the API Component

**Files:**
- Create: `components/api/prompts/experts/` (24 × `.md`)

- [ ] **Step 1: Create the prompts directory and copy all 24 files**

```bash
mkdir -p "<repo-root>/components/api/prompts/experts"

$src = "<AbletonAIAnalysis checkout>/docs/ai/RecommendationGuide/prompts"
$dst = "<repo-root>/components/api/prompts/experts"

Copy-Item "$src/*.md" "$dst/"
```

- [ ] **Step 2: Verify all 24 files are present**

```bash
ls "<repo-root>/components/api/prompts/experts" | Measure-Object
```

Expected: `Count: 24`

The 24 files that must be present:
`Triage.md`, `LowEnd.md`, `FrequencyBalance.md`, `Dynamics.md`, `StereoPhase.md`,
`Loudness.md`, `Sections.md`, `TranceArrangement.md`, `StemReference.md`,
`HarmonicAnalysis.md`, `ClarityAnalysis.md`, `SpatialAnalysis.md`,
`SurroundCompatibility.md`, `PlaybackOptimization.md`, `OverallScore.md`,
`GainStagingAudit.md`, `StereoFieldAudit.md`, `FrequencyCollisionDetection.md`,
`DynamicsHumanizationReport.md`, `SectionContrastAnalysis.md`,
`DensityBusynessReport.md`, `ChordHarmonyAnalysis.md`,
`DeviceChainAnalysis.md`, `PriorityProblemSummary.md`

- [ ] **Step 3: Commit**

```bash
git add components/api/prompts/
git commit -m "feat: add 24 specialist AI prompt files to API"
```

---

## Task 2: Add Anthropic SDK and Config

**Files:**
- Modify: `components/api/requirements.txt`
- Modify: `components/api/app/config.py`

- [ ] **Step 1: Add anthropic to requirements.txt**

Open `components/api/requirements.txt`. Add after the existing dependencies:

```
anthropic>=0.40.0
```

- [ ] **Step 2: Add anthropic_api_key and output_dir to config.py**

Open `components/api/app/config.py`. Add to the `Settings` class (wherever the other fields like `jwt_secret_key` and `redis_url` are defined):

```python
    anthropic_api_key: str = ""          # set via ANTHROPIC_API_KEY env var
    output_dir: str = "output"           # relative to project root; override via OUTPUT_DIR
```

The full env-var name is derived from the field name by pydantic-settings (e.g. `ANTHROPIC_API_KEY`). No other changes needed — pydantic-settings reads it automatically.

- [ ] **Step 3: Reinstall backend dependencies**

```bash
cd components/api && pip install -r requirements.txt
```

Expected: `Successfully installed anthropic-0.40.x ...` (or similar)

- [ ] **Step 4: Commit**

```bash
git add components/api/requirements.txt components/api/app/config.py
git commit -m "feat: add Anthropic SDK dependency and config settings"
```

---

## Task 3: Expert Service (Backend Core Logic)

**Files:**
- Create: `components/api/app/services/expert_service.py`
- Create: `components/api/tests/test_expert_service.py`

- [ ] **Step 1: Write the failing tests**

Create `components/api/tests/test_expert_service.py`:

```python
import json
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

# We import after monkeypatching so Anthropic client isn't real
from app.services.expert_service import (
    load_prompt,
    extract_recommended_specialists,
    VALID_SPECIALISTS,
)


def test_load_prompt_returns_string(tmp_path, monkeypatch):
    """load_prompt reads the correct .md file."""
    fake_prompts = tmp_path / "experts"
    fake_prompts.mkdir()
    (fake_prompts / "LowEnd.md").write_text("# Low End Specialist\nContent here.")

    monkeypatch.setattr("app.services.expert_service.PROMPTS_DIR", fake_prompts)

    result = load_prompt("LowEnd")
    assert result == "# Low End Specialist\nContent here."


def test_load_prompt_missing_raises(tmp_path, monkeypatch):
    """load_prompt raises FileNotFoundError for unknown specialist."""
    fake_prompts = tmp_path / "experts"
    fake_prompts.mkdir()

    monkeypatch.setattr("app.services.expert_service.PROMPTS_DIR", fake_prompts)

    with pytest.raises(FileNotFoundError):
        load_prompt("NonExistent")


def test_extract_recommended_specialists_finds_names():
    """Parses specialist names from triage output."""
    triage_text = """
RUN THESE SPECIALISTS
1. LowEnd.md [PRIORITY: CRITICAL]
2. Dynamics.md [PRIORITY: SEVERE]
3. Sections.md [PRIORITY: MODERATE]
"""
    result = extract_recommended_specialists(triage_text)
    assert result == ["LowEnd", "Dynamics", "Sections"]


def test_extract_recommended_specialists_deduplicates():
    """Returns each specialist at most once."""
    text = "LowEnd.md mentioned again LowEnd.md"
    result = extract_recommended_specialists(text)
    assert result.count("LowEnd") == 1


def test_extract_recommended_specialists_empty():
    """Returns empty list when no specialists mentioned."""
    result = extract_recommended_specialists("no specialists here")
    assert result == []


def test_valid_specialists_does_not_include_triage():
    """Triage should not be a valid specialist (it's the router)."""
    # Specialists list is used for validation; Triage is handled separately
    assert "Triage" not in VALID_SPECIALISTS


@pytest.mark.asyncio
async def test_run_triage_calls_claude_and_parses_specialists(tmp_path, monkeypatch):
    """run_triage calls the Anthropic client and returns structured output."""
    fake_prompts = tmp_path / "experts"
    fake_prompts.mkdir()
    (fake_prompts / "Triage.md").write_text("You are the triage router.")
    monkeypatch.setattr("app.services.expert_service.PROMPTS_DIR", fake_prompts)

    fake_message = MagicMock()
    fake_message.content = [MagicMock(text="1. LowEnd.md [PRIORITY: CRITICAL]\n2. Dynamics.md")]

    mock_create = AsyncMock(return_value=fake_message)

    with patch("app.services.expert_service.AsyncAnthropic") as MockClient:
        instance = MockClient.return_value
        instance.messages.create = mock_create

        from app.services.expert_service import run_triage

        result = await run_triage({"audio_analysis": {"bpm": 138}})

    assert result["text"] == "1. LowEnd.md [PRIORITY: CRITICAL]\n2. Dynamics.md"
    assert "LowEnd" in result["recommended_specialists"]
    assert "Dynamics" in result["recommended_specialists"]


@pytest.mark.asyncio
async def test_stream_specialist_yields_chunks(tmp_path, monkeypatch):
    """stream_specialist yields chunk events then a done event."""
    fake_prompts = tmp_path / "experts"
    fake_prompts.mkdir()
    (fake_prompts / "LowEnd.md").write_text("You are the low end specialist.")
    monkeypatch.setattr("app.services.expert_service.PROMPTS_DIR", fake_prompts)

    async def fake_text_stream():
        yield "Hello "
        yield "world"

    mock_stream_ctx = MagicMock()
    mock_stream_ctx.__aenter__ = AsyncMock(return_value=mock_stream_ctx)
    mock_stream_ctx.__aexit__ = AsyncMock(return_value=False)
    mock_stream_ctx.text_stream = fake_text_stream()

    with patch("app.services.expert_service.AsyncAnthropic") as MockClient:
        instance = MockClient.return_value
        instance.messages.stream = MagicMock(return_value=mock_stream_ctx)

        from app.services.expert_service import stream_specialist

        events = []
        async for event in stream_specialist("LowEnd", {"bpm": 138}):
            events.append(event)

    assert events[0]["event"] == "chunk"
    assert json.loads(events[0]["data"])["text"] == "Hello "
    assert events[1]["event"] == "chunk"
    assert json.loads(events[1]["data"])["text"] == "world"
    assert events[-1]["event"] == "done"
```

- [ ] **Step 2: Run tests — expect import failures (module doesn't exist yet)**

```bash
cd components/api && python -m pytest tests/test_expert_service.py -v 2>&1 | head -30
```

Expected: `ModuleNotFoundError: No module named 'app.services.expert_service'`

- [ ] **Step 3: Implement expert_service.py**

Create `components/api/app/services/expert_service.py`:

```python
from pathlib import Path
import json
import re
from anthropic import AsyncAnthropic
from ..config import settings

PROMPTS_DIR = Path(__file__).parents[2] / "prompts" / "experts"
CLAUDE_MODEL = "claude-sonnet-4-6"

VALID_SPECIALISTS = frozenset({
    "LowEnd", "FrequencyBalance", "Dynamics", "StereoPhase",
    "Loudness", "Sections", "TranceArrangement", "StemReference",
    "HarmonicAnalysis", "ClarityAnalysis", "SpatialAnalysis",
    "SurroundCompatibility", "PlaybackOptimization", "OverallScore",
    "GainStagingAudit", "StereoFieldAudit", "FrequencyCollisionDetection",
    "DynamicsHumanizationReport", "SectionContrastAnalysis",
    "DensityBusynessReport", "ChordHarmonyAnalysis",
    "DeviceChainAnalysis", "PriorityProblemSummary",
})

_SPECIALIST_PATTERN = re.compile(
    r'\b(' + '|'.join(re.escape(s) for s in VALID_SPECIALISTS) + r')\.md\b'
)


def load_prompt(specialist: str) -> str:
    path = PROMPTS_DIR / f"{specialist}.md"
    if not path.exists():
        raise FileNotFoundError(f"Prompt not found: {specialist}.md")
    return path.read_text(encoding="utf-8")


def extract_recommended_specialists(triage_text: str) -> list[str]:
    found = _SPECIALIST_PATTERN.findall(triage_text)
    seen: set[str] = set()
    return [s for s in found if not (s in seen or seen.add(s))]  # type: ignore[func-returns-value]


async def run_triage(analysis_json: dict) -> dict:
    prompt = load_prompt("Triage")
    client = AsyncAnthropic(api_key=settings.anthropic_api_key)

    message = await client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=4096,
        system=[{
            "type": "text",
            "text": prompt,
            "cache_control": {"type": "ephemeral"},
        }],
        messages=[{
            "role": "user",
            "content": (
                "Here is the analysis JSON:\n\n"
                f"```json\n{json.dumps(analysis_json, indent=2)}\n```\n\n"
                "Please triage this mix."
            ),
        }],
    )

    text: str = message.content[0].text
    return {
        "text": text,
        "recommended_specialists": extract_recommended_specialists(text),
    }


async def stream_specialist(specialist: str, analysis_json: dict):
    """Async generator yielding SSE-compatible dicts."""
    prompt = load_prompt(specialist)
    client = AsyncAnthropic(api_key=settings.anthropic_api_key)

    async with client.messages.stream(
        model=CLAUDE_MODEL,
        max_tokens=4096,
        system=[{
            "type": "text",
            "text": prompt,
            "cache_control": {"type": "ephemeral"},
        }],
        messages=[{
            "role": "user",
            "content": (
                "Here is the analysis JSON:\n\n"
                f"```json\n{json.dumps(analysis_json, indent=2)}\n```\n\n"
                "Please analyze this mix."
            ),
        }],
    ) as stream:
        async for chunk in stream.text_stream:
            yield {"event": "chunk", "data": json.dumps({"text": chunk})}

    yield {"event": "done", "data": "{}"}
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
cd components/api && python -m pytest tests/test_expert_service.py -v
```

Expected: `8 passed`

- [ ] **Step 5: Commit**

```bash
git add components/api/app/services/expert_service.py components/api/tests/test_expert_service.py
git commit -m "feat: add expert service with Anthropic SDK and prompt caching"
```

---

## Task 4: Experts Router

**Files:**
- Create: `components/api/app/routers/experts.py`
- Create: `components/api/tests/test_experts_router.py`

- [ ] **Step 1: Write the failing router tests**

Create `components/api/tests/test_experts_router.py`:

```python
import json
import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock, patch

from app.main import app
from app.models.user import User
from app.models.upload_job import UploadJob
from app.models.analysis_result import AnalysisResult


FAKE_USER = User(id="user-1", email="test@test.com", hashed_password="x", is_active=True)
FAKE_JOB = UploadJob(id="job-1", owner_id="user-1", status="done", progress=100)
FAKE_RESULT = AnalysisResult(id="res-1", job_id="job-1", result_path="job-1.json")
FAKE_ANALYSIS = {"audio_analysis": {"bpm": 138, "loudness": {"integrated_lufs": -10.0}}}


async def override_current_user():
    return FAKE_USER


@pytest.mark.asyncio
async def test_triage_returns_structured_response(tmp_path, monkeypatch):
    """POST /experts/{job_id}/triage returns text + recommended_specialists."""
    # Write fake analysis file
    results_dir = tmp_path / "results"
    results_dir.mkdir()
    (results_dir / "job-1.json").write_text(json.dumps(FAKE_ANALYSIS))

    monkeypatch.setattr("app.routers.experts.RESULTS_DIR", results_dir)

    with (
        patch("app.routers.experts.get_current_user", override_current_user),
        patch("app.routers.experts._fetch_job_and_result", AsyncMock(return_value=(FAKE_JOB, FAKE_RESULT))),
        patch("app.services.expert_service.run_triage", AsyncMock(return_value={
            "text": "1. LowEnd.md [PRIORITY: CRITICAL]",
            "recommended_specialists": ["LowEnd"],
        })),
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post("/api/experts/job-1/triage")

    assert resp.status_code == 200
    body = resp.json()
    assert "text" in body
    assert body["recommended_specialists"] == ["LowEnd"]


@pytest.mark.asyncio
async def test_specialist_invalid_name_returns_400(monkeypatch):
    """POST /experts/{job_id}/specialist/BadName returns 400."""
    with patch("app.routers.experts.get_current_user", override_current_user):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post("/api/experts/job-1/specialist/BadName")

    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_specialist_streams_sse(tmp_path, monkeypatch):
    """POST /experts/{job_id}/specialist/LowEnd returns SSE chunks."""
    results_dir = tmp_path / "results"
    results_dir.mkdir()
    (results_dir / "job-1.json").write_text(json.dumps(FAKE_ANALYSIS))

    monkeypatch.setattr("app.routers.experts.RESULTS_DIR", results_dir)

    async def fake_stream(*args, **kwargs):
        yield {"event": "chunk", "data": json.dumps({"text": "Hello"})}
        yield {"event": "done", "data": "{}"}

    with (
        patch("app.routers.experts.get_current_user", override_current_user),
        patch("app.routers.experts._fetch_job_and_result", AsyncMock(return_value=(FAKE_JOB, FAKE_RESULT))),
        patch("app.services.expert_service.stream_specialist", fake_stream),
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post(
                "/api/experts/job-1/specialist/LowEnd",
                headers={"Accept": "text/event-stream"},
            )

    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]
```

- [ ] **Step 2: Run tests — expect failures**

```bash
cd components/api && python -m pytest tests/test_experts_router.py -v 2>&1 | head -20
```

Expected: `ImportError` or `404` (router not registered yet)

- [ ] **Step 3: Implement experts.py router**

Create `components/api/app/routers/experts.py`:

```python
from pathlib import Path
import json
from fastapi import APIRouter, Depends, HTTPException
from sse_starlette.sse import EventSourceResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..db import get_session
from ..models.upload_job import UploadJob
from ..models.analysis_result import AnalysisResult
from ..models.user import User
from .auth import get_current_user
from ..services.expert_service import (
    run_triage,
    stream_specialist,
    VALID_SPECIALISTS,
)
from ..config import settings

router = APIRouter(prefix="/experts", tags=["experts"])

RESULTS_DIR = Path(settings.output_dir) / "analysis_results"


async def _fetch_job_and_result(
    job_id: str,
    current_user: User,
    session: AsyncSession,
) -> tuple[UploadJob, AnalysisResult]:
    job = await session.scalar(
        select(UploadJob).where(
            UploadJob.id == job_id,
            UploadJob.owner_id == current_user.id,
        )
    )
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    result = await session.scalar(
        select(AnalysisResult).where(AnalysisResult.job_id == job_id)
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Analysis not complete yet")

    return job, result


def _load_analysis(job_id: str) -> dict:
    path = RESULTS_DIR / f"{job_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Analysis file not found on disk")
    return json.loads(path.read_text(encoding="utf-8"))


@router.post("/{job_id}/triage")
async def triage(
    job_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    await _fetch_job_and_result(job_id, current_user, session)
    analysis = _load_analysis(job_id)
    return await run_triage(analysis)


@router.post("/{job_id}/specialist/{specialist_name}")
async def specialist_stream(
    job_id: str,
    specialist_name: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    if specialist_name not in VALID_SPECIALISTS:
        raise HTTPException(status_code=400, detail=f"Unknown specialist: {specialist_name!r}")

    await _fetch_job_and_result(job_id, current_user, session)
    analysis = _load_analysis(job_id)

    async def generate():
        async for event in stream_specialist(specialist_name, analysis):
            yield event

    return EventSourceResponse(generate())
```

- [ ] **Step 4: Run router tests — expect all pass**

```bash
cd components/api && python -m pytest tests/test_experts_router.py -v
```

Expected: `3 passed`

- [ ] **Step 5: Commit**

```bash
git add components/api/app/routers/experts.py components/api/tests/test_experts_router.py
git commit -m "feat: add experts router with triage and specialist SSE endpoints"
```

---

## Task 5: Wire Experts Router into main.py

**Files:**
- Modify: `components/api/app/main.py`

- [ ] **Step 1: Register the experts router**

Open `components/api/app/main.py`. Find the block where existing routers are included — it will look something like:

```python
from .routers import auth, uploads, jobs
app.include_router(auth.router, prefix="/api")
app.include_router(uploads.router, prefix="/api")
app.include_router(jobs.router, prefix="/api")
```

Add the experts import and registration after the existing ones:

```python
from .routers import auth, uploads, jobs, experts   # add experts
# ...existing include_router calls...
app.include_router(experts.router, prefix="/api")   # add this line
```

- [ ] **Step 2: Verify the endpoint appears in OpenAPI**

```bash
cd components/api && uvicorn app.main:app --reload &
sleep 3 && curl -s http://localhost:8000/openapi.json | python -m json.tool | grep -A2 "experts"
kill %1
```

Expected: Output includes `"/api/experts/{job_id}/triage"` and `"/api/experts/{job_id}/specialist/{specialist_name}"`

- [ ] **Step 3: Commit**

```bash
git add components/api/app/main.py
git commit -m "feat: register experts router in FastAPI app"
```

---

## Task 6: Frontend Dependencies and Types

**Files:**
- Modify: `components/frontend/package.json`
- Modify: `components/frontend/src/types/api.ts`

- [ ] **Step 1: Install react-markdown**

```bash
cd components/frontend && npm install react-markdown
```

Expected: `added 1 package` (react-markdown includes its own TypeScript types)

- [ ] **Step 2: Add expert types to api.ts**

Open `components/frontend/src/types/api.ts`. Append at the end of the file:

```typescript
// --- Expert Analysis types ---

export interface TriageResult {
  /** Full formatted triage report text (markdown) */
  text: string
  /** Specialist names extracted from triage output, e.g. ["LowEnd", "Dynamics"] */
  recommended_specialists: string[]
}

export interface ExpertStreamChunk {
  text: string
}

export type SpecialistName =
  | 'LowEnd'
  | 'FrequencyBalance'
  | 'Dynamics'
  | 'StereoPhase'
  | 'Loudness'
  | 'Sections'
  | 'TranceArrangement'
  | 'StemReference'
  | 'HarmonicAnalysis'
  | 'ClarityAnalysis'
  | 'SpatialAnalysis'
  | 'SurroundCompatibility'
  | 'PlaybackOptimization'
  | 'OverallScore'
  | 'GainStagingAudit'
  | 'StereoFieldAudit'
  | 'FrequencyCollisionDetection'
  | 'DynamicsHumanizationReport'
  | 'SectionContrastAnalysis'
  | 'DensityBusynessReport'
  | 'ChordHarmonyAnalysis'
  | 'DeviceChainAnalysis'
  | 'PriorityProblemSummary'

export const SPECIALIST_LABELS: Record<SpecialistName, string> = {
  LowEnd: 'Low End',
  FrequencyBalance: 'Frequency Balance',
  Dynamics: 'Dynamics',
  StereoPhase: 'Stereo & Phase',
  Loudness: 'Loudness',
  Sections: 'Sections',
  TranceArrangement: 'Trance Arrangement',
  StemReference: 'Stem Reference',
  HarmonicAnalysis: 'Harmonic & Key',
  ClarityAnalysis: 'Clarity',
  SpatialAnalysis: 'Spatial',
  SurroundCompatibility: 'Surround Compat.',
  PlaybackOptimization: 'Playback',
  OverallScore: 'Overall Score',
  GainStagingAudit: 'Gain Staging',
  StereoFieldAudit: 'Stereo Field',
  FrequencyCollisionDetection: 'Freq. Collisions',
  DynamicsHumanizationReport: 'Dynamics Humaniz.',
  SectionContrastAnalysis: 'Section Contrast',
  DensityBusynessReport: 'Density & Busyness',
  ChordHarmonyAnalysis: 'Chord Harmony',
  DeviceChainAnalysis: 'Device Chain',
  PriorityProblemSummary: 'Priority Summary',
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd components/frontend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add components/frontend/package.json components/frontend/package-lock.json components/frontend/src/types/api.ts
git commit -m "feat: add react-markdown and expert TypeScript types"
```

---

## Task 7: useExpertAnalysis Hook

**Files:**
- Create: `components/frontend/src/features/experts/useExpertAnalysis.ts`

- [ ] **Step 1: Create the hook**

Create `components/frontend/src/features/experts/useExpertAnalysis.ts`:

```typescript
import { useState, useCallback, useRef } from 'react'
import apiClient from '../../lib/apiClient'
import { useAuth } from '../../contexts/AuthContext'
import type { TriageResult, SpecialistName } from '../../types/api'

export interface ExpertAnalysisState {
  triage: TriageResult | null
  triageLoading: boolean
  triageError: string | null
  specialistOutputs: Partial<Record<SpecialistName, string>>
  specialistLoading: Partial<Record<SpecialistName, boolean>>
  specialistErrors: Partial<Record<SpecialistName, string>>
  runTriage: () => Promise<void>
  runSpecialist: (name: SpecialistName) => void
  cancelSpecialist: (name: SpecialistName) => void
}

export function useExpertAnalysis(jobId: string): ExpertAnalysisState {
  const { accessToken } = useAuth()
  const [triage, setTriage] = useState<TriageResult | null>(null)
  const [triageLoading, setTriageLoading] = useState(false)
  const [triageError, setTriageError] = useState<string | null>(null)
  const [specialistOutputs, setSpecialistOutputs] = useState<Partial<Record<SpecialistName, string>>>({})
  const [specialistLoading, setSpecialistLoading] = useState<Partial<Record<SpecialistName, boolean>>>({})
  const [specialistErrors, setSpecialistErrors] = useState<Partial<Record<SpecialistName, string>>>({})

  // Abort controllers keyed by specialist name for cancellation
  const abortRefs = useRef<Partial<Record<SpecialistName, AbortController>>>({})

  const runTriage = useCallback(async () => {
    setTriageLoading(true)
    setTriageError(null)
    try {
      const { data } = await apiClient.post<TriageResult>(`/experts/${jobId}/triage`)
      setTriage(data)
    } catch (e: any) {
      setTriageError(e.response?.data?.detail ?? e.message ?? 'Triage failed')
    } finally {
      setTriageLoading(false)
    }
  }, [jobId])

  const runSpecialist = useCallback((name: SpecialistName) => {
    // Cancel any existing stream for this specialist
    abortRefs.current[name]?.abort()
    const controller = new AbortController()
    abortRefs.current[name] = controller

    setSpecialistLoading(prev => ({ ...prev, [name]: true }))
    setSpecialistErrors(prev => ({ ...prev, [name]: undefined }))
    setSpecialistOutputs(prev => ({ ...prev, [name]: '' }))

    // Use fetch (not axios) for streaming — axios doesn't support ReadableStream
    fetch(`/api/experts/${jobId}/specialist/${name}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken ?? ''}`,
        Accept: 'text/event-stream',
      },
      signal: controller.signal,
    })
      .then(async (resp) => {
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}))
          throw new Error(body?.detail ?? `HTTP ${resp.status}`)
        }

        const reader = resp.body!.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })

          // SSE lines: "event: chunk\ndata: {...}\n\n"
          const parts = buffer.split('\n\n')
          buffer = parts.pop() ?? ''

          for (const part of parts) {
            const dataLine = part.split('\n').find(l => l.startsWith('data: '))
            if (!dataLine) continue
            const payload = JSON.parse(dataLine.slice(6))
            if ('text' in payload) {
              setSpecialistOutputs(prev => ({
                ...prev,
                [name]: (prev[name] ?? '') + payload.text,
              }))
            }
          }
        }
      })
      .catch((err: Error) => {
        if (err.name !== 'AbortError') {
          setSpecialistErrors(prev => ({ ...prev, [name]: err.message }))
        }
      })
      .finally(() => {
        setSpecialistLoading(prev => ({ ...prev, [name]: false }))
        delete abortRefs.current[name]
      })
  }, [jobId, accessToken])

  const cancelSpecialist = useCallback((name: SpecialistName) => {
    abortRefs.current[name]?.abort()
    setSpecialistLoading(prev => ({ ...prev, [name]: false }))
  }, [])

  return {
    triage, triageLoading, triageError,
    specialistOutputs, specialistLoading, specialistErrors,
    runTriage, runSpecialist, cancelSpecialist,
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd components/frontend && npx tsc --noEmit
```

Expected: No errors. Fix any import path or type errors before proceeding.

- [ ] **Step 3: Commit**

```bash
git add components/frontend/src/features/experts/useExpertAnalysis.ts
git commit -m "feat: add useExpertAnalysis hook with triage and streaming specialist support"
```

---

## Task 8: Expert UI Components

**Files:**
- Create: `components/frontend/src/features/experts/ExpertOutput.tsx`
- Create: `components/frontend/src/features/experts/SpecialistCard.tsx`
- Create: `components/frontend/src/features/experts/TriageView.tsx`
- Create: `components/frontend/src/features/experts/ExpertsPanel.tsx`

- [ ] **Step 1: Create ExpertOutput — renders streaming markdown**

Create `components/frontend/src/features/experts/ExpertOutput.tsx`:

```tsx
import ReactMarkdown from 'react-markdown'

interface Props {
  text: string
  loading: boolean
  error?: string
}

export default function ExpertOutput({ text, loading, error }: Props) {
  if (error) {
    return (
      <p className="mt-3 text-sm text-red-500">{error}</p>
    )
  }

  if (!text && !loading) return null

  return (
    <div className="mt-3">
      {loading && !text && (
        <p className="text-sm text-muted-foreground animate-pulse">Generating analysis…</p>
      )}
      {text && (
        <div className="prose prose-sm prose-invert max-w-none rounded-md bg-muted/30 p-4 font-mono text-xs leading-relaxed">
          <ReactMarkdown>{text}</ReactMarkdown>
          {loading && (
            <span className="ml-1 inline-block h-3 w-1.5 animate-pulse bg-foreground" />
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create SpecialistCard — button + output area for one specialist**

Create `components/frontend/src/features/experts/SpecialistCard.tsx`:

```tsx
import { useState } from 'react'
import ExpertOutput from './ExpertOutput'
import type { SpecialistName } from '../../types/api'
import { SPECIALIST_LABELS } from '../../types/api'

interface Props {
  name: SpecialistName
  recommended?: boolean
  output: string
  loading: boolean
  error?: string
  onRun: () => void
  onCancel: () => void
}

export default function SpecialistCard({
  name, recommended, output, loading, error, onRun, onCancel,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const label = SPECIALIST_LABELS[name]
  const hasOutput = !!output

  return (
    <div className={`rounded-lg border p-4 transition-colors ${recommended ? 'border-yellow-500/50 bg-yellow-500/5' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          {recommended && (
            <span className="rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs text-yellow-400">
              Recommended
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {hasOutput && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {expanded ? 'Collapse' : 'Expand'}
            </button>
          )}
          {loading ? (
            <button
              onClick={onCancel}
              className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-400 hover:bg-red-500/10"
            >
              Cancel
            </button>
          ) : (
            <button
              onClick={() => { onRun(); setExpanded(true) }}
              className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90"
            >
              {hasOutput ? 'Re-run' : 'Run'}
            </button>
          )}
        </div>
      </div>

      {(expanded || loading) && (
        <ExpertOutput text={output} loading={loading} error={error} />
      )}
    </div>
  )
}
```

- [ ] **Step 3: Create TriageView — shows triage output + recommended specialist buttons**

Create `components/frontend/src/features/experts/TriageView.tsx`:

```tsx
import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { TriageResult, SpecialistName } from '../../types/api'
import { SPECIALIST_LABELS } from '../../types/api'
import SpecialistCard from './SpecialistCard'
import type { ExpertAnalysisState } from './useExpertAnalysis'

interface Props {
  triage: TriageResult
  state: ExpertAnalysisState
  showAll: boolean
  onShowAll: () => void
}

export default function TriageView({ triage, state, showAll, onShowAll }: Props) {
  const { recommended_specialists } = triage
  const [triageExpanded, setTriageExpanded] = useState(false)

  const specialistsToShow = showAll
    ? (Object.keys(SPECIALIST_LABELS) as SpecialistName[])
    : (recommended_specialists as SpecialistName[])

  return (
    <div className="space-y-4">
      {/* Triage report */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Triage Report</h3>
          <button
            onClick={() => setTriageExpanded(e => !e)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {triageExpanded ? 'Collapse' : 'Show full report'}
          </button>
        </div>
        {triageExpanded && (
          <div className="prose prose-sm prose-invert mt-3 max-w-none rounded-md bg-muted/30 p-4 font-mono text-xs">
            <ReactMarkdown>{triage.text}</ReactMarkdown>
          </div>
        )}
      </div>

      {/* Specialist cards */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">
            {showAll ? 'All Specialists' : `Recommended Specialists (${recommended_specialists.length})`}
          </h3>
          {!showAll && (
            <button
              onClick={onShowAll}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Show all 23 →
            </button>
          )}
        </div>

        {specialistsToShow.map(name => (
          <SpecialistCard
            key={name}
            name={name as SpecialistName}
            recommended={recommended_specialists.includes(name)}
            output={state.specialistOutputs[name as SpecialistName] ?? ''}
            loading={state.specialistLoading[name as SpecialistName] ?? false}
            error={state.specialistErrors[name as SpecialistName]}
            onRun={() => state.runSpecialist(name as SpecialistName)}
            onCancel={() => state.cancelSpecialist(name as SpecialistName)}
          />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create ExpertsPanel — top-level container**

Create `components/frontend/src/features/experts/ExpertsPanel.tsx`:

```tsx
import { useState } from 'react'
import { useExpertAnalysis } from './useExpertAnalysis'
import TriageView from './TriageView'

interface Props {
  jobId: string
}

export default function ExpertsPanel({ jobId }: Props) {
  const state = useExpertAnalysis(jobId)
  const [showAll, setShowAll] = useState(false)

  return (
    <section className="rounded-lg border p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Expert Analysis</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Run AI specialists against your analysis JSON for deep-dive fixes.
            Start with Triage to identify which experts matter most for your mix.
          </p>
        </div>

        {!state.triage && (
          <button
            onClick={state.runTriage}
            disabled={state.triageLoading}
            className="shrink-0 rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {state.triageLoading ? 'Running triage…' : 'Run Triage'}
          </button>
        )}
      </div>

      {state.triageError && (
        <p className="mb-4 rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">
          {state.triageError}
        </p>
      )}

      {state.triageLoading && !state.triage && (
        <div className="space-y-2">
          <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
        </div>
      )}

      {state.triage && (
        <TriageView
          triage={state.triage}
          state={state}
          showAll={showAll}
          onShowAll={() => setShowAll(true)}
        />
      )}
    </section>
  )
}
```

- [ ] **Step 5: Verify TypeScript compiles with no errors**

```bash
cd components/frontend && npx tsc --noEmit
```

Expected: No errors. Fix any before proceeding.

- [ ] **Step 6: Commit**

```bash
git add components/frontend/src/features/experts/
git commit -m "feat: add ExpertsPanel, TriageView, SpecialistCard, and ExpertOutput components"
```

---

## Task 9: Wire ExpertsPanel into ReportPage

**Files:**
- Modify: `components/frontend/src/features/report/ReportPage.tsx`

- [ ] **Step 1: Add ExpertsPanel import and render**

Open `components/frontend/src/features/report/ReportPage.tsx`. Add the import after the existing imports:

```tsx
import ExpertsPanel from '../experts/ExpertsPanel'
```

Inside the `return` block, after `<ArrangementAdvisor fixes={report.arrangement_fixes} />`, add:

```tsx
      <ExpertsPanel jobId={jobId!} />
```

The full `return` block should now end with:

```tsx
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <h1 className="text-3xl font-bold">Analysis Report</h1>
      <p className="text-sm text-muted-foreground">Job: {jobId}</p>

      <MixScore data={report.mix_score} genre={report.genre} />
      <StreamingReadiness targets={report.streaming_readiness} />
      <FrequencyChart bands={report.frequency_balance} />
      <GenreRadar percentiles={report.genre_percentiles} />
      <StemClash clashes={report.stem_clashes} />
      {report.reference_comparison && (
        <ReferenceComparison comparisons={report.reference_comparison} />
      )}
      <ArrangementAdvisor fixes={report.arrangement_fixes} />
      <ExpertsPanel jobId={jobId!} />
    </main>
  )
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd components/frontend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Build for production (catch any bundler issues)**

```bash
cd components/frontend && npm run build
```

Expected: `✓ built in Xs` — no errors.

- [ ] **Step 4: Commit**

```bash
git add components/frontend/src/features/report/ReportPage.tsx
git commit -m "feat: add ExpertsPanel to ReportPage — completes AI Mix Experts feature"
```

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|---|---|
| 24 specialist prompts accessible in API | Task 1 |
| Claude API called with system prompt + analysis JSON | Task 3 |
| Prompt caching on system prompt | Task 3 (`cache_control: ephemeral`) |
| Triage runs first and extracts routing | Tasks 3, 4 |
| Specialists stream response via SSE | Tasks 3, 4 |
| Frontend handles Bearer auth on streaming endpoint | Task 7 (`fetch` with Authorization header) |
| Triage result displayed with full markdown | Task 8 (TriageView) |
| Recommended specialists surfaced as actionable cards | Task 8 (SpecialistCard, `recommended` prop) |
| All 23 specialists accessible (not just recommended) | Task 8 (TriageView `showAll`) |
| Streaming output rendered as markdown | Task 8 (ExpertOutput + react-markdown) |
| Cancel mid-stream | Task 7 (`AbortController`), Task 8 (`onCancel`) |
| Panel wired into report page | Task 9 |
| Backend validates job ownership before Claude call | Task 4 (`_fetch_job_and_result`) |
| Invalid specialist names rejected | Task 4 (400 response) |
| Tests for service and router | Tasks 3, 4 |

### Placeholder Scan

No TBDs, TODOs, or "similar to above" present. All code blocks are complete.

### Type Consistency

- `SpecialistName` defined in `api.ts` (Task 6), imported in `useExpertAnalysis.ts` (Task 7), `SpecialistCard.tsx`, `TriageView.tsx` (Task 8) — consistent.
- `ExpertAnalysisState` exported from hook (Task 7), imported as type in `TriageView` (Task 8) — consistent.
- `TriageResult` defined in `api.ts`, returned by `apiClient.post<TriageResult>` in hook, accepted as `triage: TriageResult` prop in `TriageView` — consistent.
- `SPECIALIST_LABELS` defined in `api.ts`, imported in `SpecialistCard` and `TriageView` — consistent.
- `run_triage` returns `{"text": str, "recommended_specialists": list[str]}` in Python (Task 3) → matches `TriageResult` TypeScript interface (Task 6) — consistent.

### Edge Cases Covered

- Triage loading state: skeleton shown while waiting for Claude (ExpertsPanel)
- Triage error state: error message displayed (ExpertsPanel)
- Specialist cancel mid-stream: AbortController.abort() cleans up (hook)
- Re-running a specialist: clears previous output and restarts (hook)
- Collapsed by default until user expands: SpecialistCard starts collapsed
- `jobId` could be undefined if accessed outside route: `jobId!` assertion in Task 9 (safe because ExpertsPanel only rendered on `/report/:jobId`)
