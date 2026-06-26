name: "Analysis Result Images — server-rendered spectrogram + waveform thumbnail"
description: |
  Generate two raster images per completed analysis in the worker (where the decoded audio + librosa
  already live), persist them via the shared local-disk storage root, serve them owner-scoped from the
  BFF, and display them on the results page Spectrum tab. These are the ONLY two visuals that genuinely
  need raw audio samples the browser doesn't have — everything else on the results page stays
  client-rendered (Recharts) from `final_json`. Pillow-only render (NO matplotlib). Best-effort:
  an image failure never fails the analysis. Confidence: 8/10.

## Core Principles
1. Context is King · 2. Validation Loops · 3. Information Dense · 4. Progressive Success · 5. Follow CLAUDE.md
6. **Server-render ONLY what needs raw audio.** Spectrogram + waveform need the full decoded signal (heavy/slow
   to do in-browser). All other visuals (EQ bars, loudness timeline, key radar, reference deltas, gaps,
   arrangement Gantt, MIDI panels, gauges) are small arrays/scalars already in `final_json` → Recharts. Do NOT
   rasterize those.

---

## Goal
Every completed analysis gets two WebP images, rendered once in the worker and shown on the results page:
- **Spectrogram** — mel/log-frequency power heatmap over the whole track (`magma` colormap on dark). The flagship:
  producers read frequency-vs-time at a glance; impossible to produce cheaply client-side.
- **Waveform thumbnail** — loudness-colored peak-envelope overview of the whole track (static raster, distinct
  from the dormant interactive `waveform_peaks_path`/WaveSurfer concept).

Images are pure heatmap/waveform pixels (NO baked-in axes/labels) so they stay small and theme-flexible; the
frontend overlays freq/time tick labels in CSS around the `<img>`.

## Why
- **User value:** a spectrogram is the single most-requested mix-visualization for producers; the waveform thumb
  gives the results hero/card an at-a-glance energy map.
- **Only-server-possible:** both need the full decoded signal + an FFT/peak pass. The browser would have to
  download + decode + STFT the entire file (slow, memory-heavy, jank). The worker already decodes the audio and
  imports librosa during analysis — marginal cost to emit two images there is tiny.
- **Cheap + bounded:** one extra `librosa.load` (decode once, render both) + Pillow encode ≈ 1–3 s CPU, far
  below the existing pipeline cost (Demucs path is 10–20 min). Images are ~80–200 KB (spectrogram) / ~30 KB
  (waveform), stored once per analysis.

## What
- New `audio_analysis.viz` module: `render_analysis_images(file_path) -> dict[str, bytes]` returning
  `{"spectrogram": <webp bytes>, "waveform": <webp bytes>}`. Pillow + numpy + librosa only.
- Worker `analyze_audio_job` renders + persists both images best-effort, keyed by `job_id`, writing to the
  shared local-disk root; stamps two new `analyses` path columns.
- BFF serves `GET /api/jobs/{jobId}/images/{kind}` (owner-scoped, `image/webp`, immutable cache, `?t=` JWT for
  `<img>`); `JobResultsDto` exposes nullable image URLs.
- Frontend Spectrum tab renders the two images (lazy `<img>`, skeleton, graceful absent-state).

### Success Criteria
- [ ] `render_analysis_images` returns valid, size-bounded WebP for mono, stereo, and silent inputs; no matplotlib import.
- [ ] Worker writes both images to `analysis/images/{jobId}/{spectrogram,waveform}.webp` and sets the two path columns; a render/IO failure leaves the analysis COMPLETE with null paths (swallowed, logged).
- [ ] BFF serves both kinds owner-scoped (IDOR → 404), `image/webp`, `Cache-Control: immutable`; `?t=` works for `<img>`.
- [ ] `JobResultsDto` returns `spectrogramImageUrl`/`waveformImageUrl` (null when absent).
- [ ] Spectrum tab shows both images when present, a skeleton while the job is pre-image, nothing (no broken `<img>`) when absent.
- [ ] All validation gates pass; existing analysis golden snapshots stay byte-identical (images are NOT part of `final_json`).

---

## All Needed Context

### Decisions (locked)
- **Pillow, not matplotlib.** matplotlib is a heavy import + larger PNGs + axis chrome we don't want baked in.
  Render: compute matrix → normalize → apply an embedded 256-entry `magma` RGB LUT → `PIL.Image` → WebP. Waveform:
  `PIL.ImageDraw` over a peak envelope. Add only `Pillow` to the analysis package deps (librosa/numpy/scipy already present).
- **Spectrogram = mel power, dB-scaled.** Use `librosa.feature.melspectrogram(n_mels=256, fmax=sr/2)` →
  `power_to_db(ref=max)` → normalize to 0–1 → LUT. Mel is perceptual/log-frequency-ish (phase1 already uses it at
  `phase1_universal.py:316`), robust, and yields a fixed-height matrix. Downsample time axis to a fixed width
  (~1024 cols) so output size is bounded regardless of track length.
- **Key by `job_id`, not `analysis_id`.** The worker has `job_id` from the actor arg; the frontend already keys
  results on `jobId` (`useJobResults` → `['jobs', jobId, 'results']`). Storage key `analysis/images/{jobId}/{kind}.webp`.
- **No axes baked in.** Pure pixels; frontend overlays labels. Dark-theme only (app is dark).
- **Best-effort, never fatal.** Mirror `_try_write_artifact` (tasks_dramatiq.py:391) — wrap in try/except, log, continue.
- **Per-phase re-run does NOT regenerate images** (only full `analyze_audio_job` does). Acceptable; noted as a limitation.

### Documentation & References
```yaml
- file: components/analysis/src/audio_analysis/phases/phase1_universal.py
  why: line 285 `y, sr = librosa.load(str(wav_path), sr=44100, mono=False)`; line 311 `mono = y.mean(axis=0)`;
       line 316 `librosa.feature.melspectrogram(y=mono, sr=sr, n_mels=128)`. Mirror the load + mel approach.
- file: components/analysis/src/audio_analysis/pipeline.py
  why: line 226 `wav_path = to_wav(file_path)` (44100 Hz temp WAV). The pipeline does NOT retain a decoded array —
       each phase re-decodes. So viz must do its OWN single load (acceptable; one extra decode).
- file: components/analysis/pyproject.toml
  why: deps lines 10–18 (librosa, soundfile, scipy, numpy<2.0 — NO Pillow/matplotlib). Add `Pillow`. Keep numpy<2.0.
- file: components/analysis/tests/integration/test_phase_snapshots.py
  why: golden-snapshot mechanics (FLOAT_PRECISION=2, UPDATE_SNAPSHOTS=1). Images are NOT in final_json → snapshots
       must stay byte-identical. Do NOT add images to the JSON snapshots.
- file: components/worker/app/tasks_dramatiq.py
  why: `analyze_audio_job` 3-phase tx — Phase A load/flip (117–159), Phase B run_pipeline no-TX (160–207),
       Phase C insert Analysis + flip COMPLETE (209–250). `LOCAL_ROOT` resolution (44–64). `_try_write_artifact`
       best-effort pattern (391). `file_abs = str((Path(LOCAL_ROOT)/file_rel).resolve())` (135).
- file: components/worker/tests/test_analyze_audio_job_reference.py
  why: actor test harness (46–69): monkeypatch `td.run_pipeline`, `td.LOCAL_ROOT`, `td._try_write_artifact`,
       `td.run_rule_engine_for_analysis`; fake `SessionFactory.begin`. Mirror for the image-render seam.
- file: components/bff/src/Spectr.Bff/Endpoints/VersionEndpoints.cs
  why: `StreamAudio` (241–278) — owner-scoped lookup, `storage.ExistsAsync`/`OpenReadAsync`, `Results.File(...)`.
       Mirror for the image endpoint (no Range needed for images).
- file: components/bff/src/Spectr.Bff/Services/IFileStorage.cs
  why: interface (3–16): `OpenReadAsync`, `ExistsAsync`. LocalDiskFileStorage `Path.Combine(_root, key)`, root =
       `Storage:LocalRoot` (repo-root data/). Worker writes the SAME root → keys line up.
- file: components/bff/src/Spectr.Bff/Endpoints/JobEndpoints.cs
  why: `GetResults` (222–276) builds `JobResultsDto`. Add image URLs here from the new Analysis path columns.
- file: components/bff/src/Spectr.Bff/DTOs/JobDtos.cs
  why: `JobResultsDto` record (18–29). Extend with two nullable image-url fields.
- file: components/bff/src/Spectr.Data/Entities/Analysis.cs
  why: canonical schema. `waveform_peaks_path` (42–43) is a DORMANT placeholder (never written; read once in
       ShareEndpoints.cs:204) for interactive peaks JSON — do NOT reuse it. Add two NEW raster-image columns.
- file: components/bff/src/Spectr.Bff/Program.cs
  why: JwtBearer `OnMessageReceived` `?t=` whitelist (52–71), currently exact `/api/versions/{id}/audio`.
       Add a branch for `/images/` paths.
- file: components/shared/aimusic_shared/models.py
  why: `Analysis` ORM mirror. Add the two columns here too (worker writes via this model).
- file: components/frontend-spectr-v2/src/features/results/SpectrumTab.tsx
  why: render target (44–133). Insert image cards after the frequency-balance / ClashCard section.
- file: components/frontend-spectr-v2/src/features/results/ReportView.tsx
  why: 42–51 picks phase data + renders `<SpectrumTab .../>`. Pass the image URLs down from `results`.
- file: components/frontend-spectr-v2/src/api/types.ts
  why: `JobResultsDto` interface (861–872). Add the two image-url fields.
- file: components/frontend-spectr-v2/src/features/listen-rack/ListenRackPage.tsx
  why: 349–353 — the `?t=${encodeURIComponent(getAccessToken() ?? '')}` URL pattern for media that can't send
       headers. Reuse for `<img src>`.
```

### Known Gotchas
```python
# CRITICAL: numpy<2.0 stays pinned (librosa/numba/soundfile). Pillow is numpy-2-agnostic — safe to add under the pin.
# CRITICAL: NO matplotlib import anywhere in the viz module (perf + image size). Use an embedded LUT + Pillow.
# CRITICAL: viz does its OWN librosa.load — the pipeline never hands back a decoded array. Decode once, render both.
# CRITICAL: worker writes raster files to disk only (Path under LOCAL_ROOT), same as _try_write_artifact /
#           reference_analyzer_actor. Prod R2 write parity for worker file output is a PRE-EXISTING gap (out of scope).
# CRITICAL: images are NOT part of final_json → analysis golden snapshots must stay byte-identical.
# CRITICAL (.NET): the audio endpoint uses AsNoTracking() on a READ — fine here (image serve is read-only). Do NOT
#           copy AsNoTracking into any write-path lookup (CLAUDE.md: poisons the whole query → silent dropped update).
# CRITICAL: tokens-in-URL leak to logs (CLAUDE.md). Acceptable parity with existing /audio ?t=; HMAC-signed image
#           URLs are the documented future hardening (out of scope, note it).
```

---

## Data model

Add to **`analyses`** (EF canonical `Analysis.cs` + shared `aimusic_shared/models.py` mirror):
- `spectrogram_image_path` varchar(500) NULL — storage key, e.g. `analysis/images/{jobId}/spectrogram.webp`.
- `waveform_image_path` varchar(500) NULL — storage key, e.g. `analysis/images/{jobId}/waveform.webp`.

EF migration: `dotnet ef migrations add AnalysisResultImages --project src/Spectr.Data --startup-project src/Spectr.Bff`
(plain additive nullable columns — no raw SQL needed; `Down()` drops them, EF-scaffolded).

---

## Implementation Blueprint (ordered)

Build order: **1 (viz module) → 2 (worker wiring) → 3 (schema+DTO) → 4 (BFF serve) → 5 (frontend)**.
Task 1 is independent and fully unit-testable in isolation; 3 can start in parallel with 1.

### Task 1 — `audio_analysis.viz` render module (analysis pkg)
```yaml
CREATE components/analysis/src/audio_analysis/viz.py:
  - render_analysis_images(file_path: str, *, sr: int = 22050) -> dict[str, bytes]
  - render_spectrogram(mono, sr) -> bytes  (mel power → dB → normalize → magma LUT → PIL → WebP)
  - render_waveform(mono, sr) -> bytes     (peak envelope → ImageDraw, loudness-colored → PIL → WebP)
  - _MAGMA_LUT: np.ndarray shape (256,3) uint8  (embedded; NO matplotlib)
MODIFY components/analysis/pyproject.toml:
  - add "Pillow>=10,<12" to dependencies (keep numpy<2.0)
```
```python
# viz.py — pseudocode, CRITICAL details only
import io, numpy as np, librosa
from PIL import Image, ImageDraw

SPEC_W, SPEC_H = 1024, 256      # bounded output regardless of track length
WAVE_W, WAVE_H = 1024, 160

def render_analysis_images(file_path, *, sr=22050):
    # decode ONCE, mono, modest sr (22050 plenty for a thumbnail; faster + smaller)
    y, sr = librosa.load(file_path, sr=sr, mono=True)        # GOTCHA: own load; pipeline doesn't expose one
    return {"spectrogram": render_spectrogram(y, sr), "waveform": render_waveform(y, sr)}

def render_spectrogram(y, sr):
    S = librosa.feature.melspectrogram(y=y, sr=sr, n_mels=SPEC_H, fmax=sr // 2)
    S_db = librosa.power_to_db(S, ref=np.max)                # 0 dB at peak, negative below
    norm = np.clip((S_db + 80.0) / 80.0, 0, 1)              # 80 dB floor → 0..1
    # time-resample to SPEC_W columns (linear index resample; cheap, deterministic)
    idx = np.linspace(0, norm.shape[1] - 1, SPEC_W).astype(int) if norm.shape[1] else np.zeros(SPEC_W, int)
    grid = norm[:, idx] if norm.shape[1] else np.zeros((SPEC_H, SPEC_W))
    rgb = _MAGMA_LUT[(grid * 255).astype(np.uint8)]         # (H,W,3); flip so low freq at bottom
    img = Image.fromarray(np.flipud(rgb), "RGB")
    buf = io.BytesIO(); img.save(buf, "WEBP", quality=80, method=4); return buf.getvalue()

def render_waveform(y, sr):
    # peak envelope over WAVE_W buckets; color by local RMS (loudness heat)
    n = max(1, len(y) // WAVE_W)
    buckets = [y[i*n:(i+1)*n] for i in range(WAVE_W)]
    peaks = np.array([np.abs(b).max() if len(b) else 0.0 for b in buckets])
    rms   = np.array([np.sqrt(np.mean(b**2)) if len(b) else 0.0 for b in buckets])
    img = Image.new("RGBA", (WAVE_W, WAVE_H), (0,0,0,0)); d = ImageDraw.Draw(img); mid = WAVE_H//2
    pmax = peaks.max() or 1.0
    for x in range(WAVE_W):
        h = int((peaks[x]/pmax) * (mid-2))
        c = _MAGMA_LUT[int(np.clip(rms[x]/(rms.max() or 1.0),0,1)*255)]
        d.line([(x, mid-h), (x, mid+h)], fill=(int(c[0]),int(c[1]),int(c[2]),255))
    buf = io.BytesIO(); img.save(buf, "WEBP", quality=80, method=4); return buf.getvalue()
```
```yaml
CREATE components/analysis/tests/test_viz.py:
  - test_returns_two_webp_keys: dict has spectrogram+waveform, both start with b"RIFF" .. b"WEBP" magic
  - test_size_bounded: each image < 300_000 bytes for a 3-min synth tone
  - test_mono_and_stereo_inputs: stereo file (synth) renders without error (load mono=True handles it)
  - test_silent_input: all-zeros wav → valid WebP, no div-by-zero (guards on max()==0)
  - test_no_matplotlib: assert "matplotlib" not in sys.modules after import audio_analysis.viz
  - use the existing synth-file conftest fixtures (tests/conftest.py synth_stem_files / a synth tone helper)
```

### Task 2 — Worker wiring (best-effort render + persist)
```yaml
MODIFY components/worker/app/tasks_dramatiq.py:
  - import: from audio_analysis.viz import render_analysis_images   (module-level, alongside run_pipeline import)
  - add helper _render_and_store_images(job_id, file_abs) -> tuple[str|None, str|None]:
      try:
        imgs = render_analysis_images(file_abs)
        base = f"analysis/images/{job_id}"
        for kind, data in (("spectrogram", imgs["spectrogram"]), ("waveform", imgs["waveform"])):
            out = Path(LOCAL_ROOT) / base / f"{kind}.webp"
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(data)
        return f"{base}/spectrogram.webp", f"{base}/waveform.webp"
      except Exception:
        logger.exception("image render failed for job %s", job_id); return None, None
  - In Phase C, when constructing the Analysis row (around line 217–231), call the helper (file_abs is in scope
    from Phase A) and set analysis.spectrogram_image_path / analysis.waveform_image_path before commit.
    NOTE: render OUTSIDE the DB transaction window where possible (it's CPU work) — compute the two path strings,
    then assign on the row. Mirror _try_write_artifact's never-raise discipline.
```
```yaml
MODIFY components/worker/tests/  (new test_analyze_audio_job_images.py):
  - monkeypatch td.render_analysis_images -> returns {"spectrogram": b"RIFFxxxxWEBP", "waveform": b"RIFFxxxxWEBP"}
    and monkeypatch the file write (or point td.LOCAL_ROOT at tmp_path) → assert both path columns set on the row.
  - failure case: monkeypatch td.render_analysis_images to raise → job still COMPLETE, both path columns None.
  - reuse the harness pattern from test_analyze_audio_job_reference.py (fake SessionFactory.begin + registry).
```

### Task 3 — Schema + DTO
```yaml
MODIFY components/bff/src/Spectr.Data/Entities/Analysis.cs:
  - add [Column("spectrogram_image_path"), MaxLength(500)] public string? SpectrogramImagePath { get; set; }
  - add [Column("waveform_image_path"),   MaxLength(500)] public string? WaveformImagePath   { get; set; }
RUN: dotnet ef migrations add AnalysisResultImages --project src/Spectr.Data --startup-project src/Spectr.Bff
MODIFY components/shared/aimusic_shared/models.py (Analysis):
  - spectrogram_image_path = Column(String(500), nullable=True)
  - waveform_image_path    = Column(String(500), nullable=True)
MODIFY components/bff/src/Spectr.Bff/DTOs/JobDtos.cs (JobResultsDto):
  - add  string? SpectrogramImageUrl = null,  string? WaveformImageUrl = null   (end of record params)
```

### Task 4 — BFF serve endpoint + DTO population + JWT whitelist
```yaml
CREATE components/bff/src/Spectr.Bff/Endpoints/AnalysisImageEndpoints.cs:
  - group: app.MapGroup("/api/jobs").RequireAuthorization()
  - GET "/{jobId:guid}/images/{kind}":  kind in {"spectrogram","waveform"} else 400
      owner-scoped: db.Analyses.AsNoTracking().Where(a => a.JobId==jobId && a.UserId==userId)
                    .Select(a => kind=="spectrogram" ? a.SpectrogramImagePath : a.WaveformImagePath)
      null/!ExistsAsync -> 404
      stream = storage.OpenReadAsync(key); return Results.File(stream, "image/webp")
      set Cache-Control: public, max-age=31536000, immutable  (key is per-analysis; content immutable)
REGISTER in Program.cs endpoint mapping (near other Map*Endpoints calls).
MODIFY components/bff/src/Spectr.Bff/Endpoints/JobEndpoints.cs (GetResults, 222–276):
  - select a.SpectrogramImagePath, a.WaveformImagePath
  - build url (no token; frontend appends ?t=): path != null ? $"/api/jobs/{jobId}/images/spectrogram" : null
  - pass into JobResultsDto(...)
MODIFY components/bff/src/Spectr.Bff/Program.cs (OnMessageReceived, 52–71):
  - add branch: if path.StartsWith("/api/jobs/", OrdinalIgnoreCase) && path.Contains("/images/", OrdinalIgnoreCase)
                -> read ctx.Request.Query["t"] into ctx.Token  (mirror the /audio branch)
```
```yaml
TESTS (Spectr.Bff.Tests):
  - serve: owner gets 200 image/webp when path set + file exists; non-owner -> 404 (IDOR); missing path -> 404;
           bad kind -> 400.
  - GetResults returns the two urls when columns set, null when absent.
  - (if there's an integration test harness) ?t= token resolves on the image path.
```

### Task 5 — Frontend Spectrum tab display
```yaml
MODIFY components/frontend-spectr-v2/src/api/types.ts (JobResultsDto, 861–872):
  - spectrogramImageUrl?: string | null;  waveformImageUrl?: string | null;
MODIFY components/frontend-spectr-v2/src/features/results/ReportView.tsx (~42–51):
  - pass results.spectrogramImageUrl / results.waveformImageUrl into <SpectrumTab .../>
MODIFY components/frontend-spectr-v2/src/features/results/SpectrumTab.tsx (after ClashCard, ~114):
  - accept props spectrogramUrl?: string|null, waveformUrl?: string|null
  - helper: const withTok = (u:string) => `${u}?t=${encodeURIComponent(getAccessToken() ?? '')}`  (import getAccessToken)
  - render a <section className="card"> per image when url present:
      <img src={withTok(url)} alt="..." loading="lazy" className={s.specImg} onError={hide} />
    overlay freq labels (20Hz / 100 / 1k / 10k) + time labels (0 .. duration) via CSS around the spectrogram img.
  - absent state: render nothing (no broken <img>); if job not yet complete, the parent already shows pipeline progress.
CREATE/MODIFY SpectrumTab.module.css: .specImg { width:100%; display:block; border-radius: var(--radius) } + label overlay rules.
```
```yaml
TESTS (vitest):
  - SpectrumTab renders an <img> with the tokened src when spectrogramUrl provided.
  - SpectrumTab renders no <img> when urls are null/undefined.
```

---

## Validation Loop

### Level 1 — Syntax & Style
```bash
ruff check components/analysis/src/ components/worker/ components/shared/
mypy components/worker/app/ --ignore-missing-imports
cd components/bff && dotnet build
cd components/frontend-spectr-v2 && npx tsc --noEmit && npm run lint
```

### Level 2 — Unit tests
```bash
pip install -e components/shared && pip install -e components/analysis
pytest -q components/analysis/tests/test_viz.py            # render: webp magic, size bound, mono/stereo/silent, no matplotlib
pytest -q components/analysis/tests/integration/           # golden snapshots STILL byte-identical (images not in final_json)
pytest -q components/worker/tests/test_analyze_audio_job_images.py
pytest -q components/shared/tests/
cd components/bff && dotnet test
cd components/frontend-spectr-v2 && npx vitest run && npm run build
```

### Level 3 — Integration
```bash
cd components/bff && dotnet ef database update --project src/Spectr.Data --startup-project src/Spectr.Bff
docker compose -f docker/docker-compose.yml up -d
# run worker + bff + frontend, upload a track, wait for COMPLETE, then:
curl -f "http://localhost:5000/api/jobs/<jobId>/images/spectrogram?t=<jwt>" -o spec.webp && file spec.webp   # RIFF/WEBP
curl -f "http://localhost:5000/api/jobs/<jobId>/images/waveform?t=<jwt>"   -o wave.webp && file wave.webp
# open the results page Spectrum tab → both images visible.
```

## Final Validation Checklist
- [ ] `render_analysis_images` valid WebP for mono/stereo/silent; no matplotlib in sys.modules.
- [ ] Analysis golden snapshots unchanged (images excluded from final_json).
- [ ] Worker sets both path columns on success; null + COMPLETE on render failure.
- [ ] EF migration applied; shared mirror matches.
- [ ] BFF serves owner-scoped image/webp + immutable cache; IDOR → 404; `?t=` works.
- [ ] `JobResultsDto` urls present/null correctly.
- [ ] Spectrum tab shows both images, lazy-loaded, graceful absent-state.
- [ ] All gates green.

---

## Error handling
- **Render/IO failure** → swallowed + logged in `_render_and_store_images`; analysis stays COMPLETE, paths null,
  results page omits the images. Never raises.
- **Silent / corrupt audio** → guards on `max()==0` avoid div-by-zero; produce a valid (empty-ish) image.
- **Image requested before render / on a pre-existing analysis** → null path → 404 → frontend renders nothing.

## Anti-patterns
- ❌ Don't import matplotlib (perf + size). LUT + Pillow only.
- ❌ Don't put image bytes/base64 in `final_json` (bloats JSONB, breaks snapshots). Store as files; reference by path column.
- ❌ Don't rasterize the client-renderable visuals (EQ bars, loudness line, key radar, gaps, arrangement, MIDI, gauges) — those stay Recharts.
- ❌ Don't reuse the dormant `waveform_peaks_path` column (it's reserved for interactive WaveSurfer peaks JSON, a different thing).
- ❌ Don't let the render fail the analysis (mirror `_try_write_artifact`).
- ❌ Don't copy `AsNoTracking()` into any write-path query.
- ❌ Don't loosen numpy<2.0.

## Known limitations / follow-ups
- **Per-phase re-run** (`rerun_phase`) does NOT regenerate images — only full `analyze_audio_job` does. Re-render on
  re-run is a follow-on if needed.
- **Prod R2 parity:** worker writes images to local disk only (same pre-existing gap as `_try_write_artifact` /
  `reference_analyzer_actor`). A worker-side storage abstraction for R2 is out of scope here.
- **Token-in-URL** for `<img>` matches the existing `/audio` pattern; HMAC-signed short-lived image URLs are the
  documented hardening path (CLAUDE.md), deferred.
- **Theme:** dark-only render. A light-theme variant would need a second render or a different LUT.

## Confidence: 8/10
Strong: every integration point has a verified anchor + snippet; render is self-contained + unit-testable in
isolation; best-effort wiring can't regress the pipeline; images live outside `final_json` so snapshots are
untouched. Risk: getting the embedded magma LUT + mel normalization to look good (tune `quality`/dB-floor/`n_mels`
visually), and worker→BFF storage-root alignment on the dev box (both must resolve to repo-root `data/`).
