# PRP: GAP-12 — Track Name + Version History

**Status:** Draft  
**Effort:** Half-day (DB + upload form in v1.1); additional half-day for chart UI in v1.2  
**Phase:** v1.1 (schema + upload field) / v1.2 (tracks page + LineChart)

---

## Goal

Add a `track_name` field to `UploadJob` so producers can tag uploads with a track name, then group all versions of the same track to show a score-over-time LineChart — turning the tool into a longitudinal mix improvement tracker.

## Why

- No competitor offers track versioning; this is a first-mover moat feature
- Creates lock-in: producers who log versions don't want to switch and lose history
- The DB schema addition must happen in v1.1 so data accumulates from day one; the UI can ship in v1.2

## What

### Backend

**File:** `models.py` — Add `track_name` to `UploadJob`:

```python
class UploadJob(Base):
    # ... existing columns ...
    track_name: Mapped[str | None] = mapped_column(String(200), nullable=True, index=True)
```

**Migration:** `alembic revision --autogenerate -m "add track_name to upload_job"`

No backfill needed — existing rows will have `NULL` track_name, which is valid.

**File:** Upload endpoint (wherever multipart form is handled):

```python
@router.post("/upload")
async def upload_track(
    file: UploadFile = File(...),
    track_name: str | None = Form(None),  # ADD THIS
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session)
):
    job = UploadJob(
        user_id=current_user.id,
        filename=file.filename,
        track_name=track_name.strip() if track_name else None,  # ADD THIS
        ...
    )
```

**New Pydantic models:**

```python
class TrackVersionSummary(BaseModel):
    job_id: int
    filename: str
    score: float | None
    grade: str | None
    created_at: datetime

class TrackGroup(BaseModel):
    track_name: str
    version_count: int
    latest_score: float | None
    latest_grade: str | None
    versions: list[TrackVersionSummary]
```

**New route:**

```python
@router.get("/tracks", response_model=list[TrackGroup])
async def list_tracks(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session)
):
    result = await session.execute(
        select(UploadJob)
        .options(selectinload(UploadJob.analysis_result))
        .where(
            UploadJob.user_id == current_user.id,
            UploadJob.track_name.isnot(None)
        )
        .order_by(UploadJob.track_name, UploadJob.created_at.asc())
    )
    jobs = result.scalars().all()

    # Group by track_name in Python
    from itertools import groupby
    groups = []
    for name, versions in groupby(jobs, key=lambda j: j.track_name):
        version_list = list(versions)
        groups.append(TrackGroup(
            track_name=name,
            version_count=len(version_list),
            latest_score=version_list[-1].analysis_result.final_json.get("overall_score") if version_list[-1].analysis_result else None,
            latest_grade=version_list[-1].analysis_result.final_json.get("grade") if version_list[-1].analysis_result else None,
            versions=[
                TrackVersionSummary(
                    job_id=v.id,
                    filename=v.filename,
                    score=v.analysis_result.final_json.get("overall_score") * 100 if v.analysis_result else None,
                    grade=v.analysis_result.final_json.get("grade") if v.analysis_result else None,
                    created_at=v.created_at
                )
                for v in version_list
            ]
        ))
    return groups
```

### Frontend

**File:** `frontend/src/pages/UploadPage.tsx`

Add optional "Track Name" text input to the upload form:

```tsx
<div className="mt-4">
  <label className="block text-sm text-gray-400 mb-1">
    Track Name <span className="text-gray-600">(optional — used to track versions)</span>
  </label>
  <input
    type="text"
    value={trackName}
    onChange={(e) => setTrackName(e.target.value)}
    placeholder="e.g. Deadlock, Summer Demo..."
    maxLength={200}
    className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white"
  />
</div>
```

Include `track_name` in the FormData submitted to the upload endpoint.

**New file:** `frontend/src/pages/TrackHistoryPage.tsx`

```tsx
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const TrackHistoryPage = () => {
  const { data: tracks, isLoading } = useQuery({
    queryKey: ['tracks'],
    queryFn: () => fetch('/api/tracks', { credentials: 'include' }).then(r => r.json())
  });
  const [selected, setSelected] = useState<string | null>(null);

  if (isLoading) return <div>Loading tracks...</div>;
  if (!tracks?.length) return (
    <div>No named tracks yet. Add a track name when uploading to start tracking versions.</div>
  );

  const selectedTrack = tracks.find((t: TrackGroup) => t.track_name === selected) ?? tracks[0];

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-2xl font-bold mb-6">Track History</h1>
      <div className="grid grid-cols-3 gap-6">
        {/* Track list */}
        <div className="col-span-1 space-y-2">
          {tracks.map((t: TrackGroup) => (
            <button
              key={t.track_name}
              onClick={() => setSelected(t.track_name)}
              className={`w-full text-left px-4 py-3 rounded border ${
                selectedTrack.track_name === t.track_name
                  ? 'border-blue-500 bg-blue-950' : 'border-gray-700 bg-gray-900'
              }`}
            >
              <div className="font-semibold">{t.track_name}</div>
              <div className="text-sm text-gray-400">{t.version_count} versions</div>
            </button>
          ))}
        </div>
        {/* Score chart */}
        <div className="col-span-2">
          <h2 className="text-xl font-bold mb-4">{selectedTrack.track_name}</h2>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={selectedTrack.versions}>
              <XAxis dataKey="filename" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} />
              <Tooltip />
              <Line type="monotone" dataKey="score" stroke="#3b82f6" strokeWidth={2} dot />
            </LineChart>
          </ResponsiveContainer>
          {/* Version table */}
          <table className="w-full mt-4">
            <thead>
              <tr className="text-left border-b text-gray-400 text-sm">
                <th>File</th><th>Score</th><th>Grade</th><th>Date</th><th></th>
              </tr>
            </thead>
            <tbody>
              {selectedTrack.versions.map((v: TrackVersionSummary) => (
                <tr key={v.job_id} className="border-b">
                  <td className="py-2 text-sm">{v.filename}</td>
                  <td>{v.score?.toFixed(0) ?? '—'}</td>
                  <td>{v.grade ?? '—'}</td>
                  <td className="text-sm text-gray-400">
                    {new Date(v.created_at).toLocaleDateString()}
                  </td>
                  <td>
                    <Link to={`/reports/${v.job_id}`} className="text-blue-500 text-sm">View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
```

**File:** `App.tsx` — Add `/tracks` route inside `ProtectedLayout`.

**File:** Navigation component — Add "Track History" link for authenticated users.

## Tasks

### Task 1: DB migration — add track_name to UploadJob
- [ ] Add `track_name: Mapped[str | None]` to `UploadJob` in `models.py` (nullable, String(200), indexed)
- [ ] Run `alembic revision --autogenerate -m "add track_name to upload_job"`
- [ ] Review migration — should be an `ALTER TABLE` adding a nullable column
- [ ] Run `alembic upgrade head`
- [ ] Verify column exists: `SELECT column_name FROM information_schema.columns WHERE table_name='upload_job'`

### Task 2: Backend — accept track_name in upload endpoint
- [ ] Add `track_name: str | None = Form(None)` parameter to the upload endpoint
- [ ] Store `track_name.strip()` (if not None) on the `UploadJob` row
- [ ] Test with `curl -F "file=@test.wav" -F "track_name=Test Track" /api/upload`

### Task 3: Backend — tracks grouping endpoint
- [ ] Define `TrackVersionSummary` and `TrackGroup` Pydantic models
- [ ] Implement `GET /tracks` route with groupby logic
- [ ] Use `selectinload(UploadJob.analysis_result)` to avoid N+1
- [ ] Test with a user who has 3 uploads of the same track name

### Task 4: Frontend — track_name field in upload form
- [ ] Add optional text input to `UploadPage.tsx`
- [ ] Include `track_name` in FormData on submit
- [ ] Verify uploads with and without track_name both succeed

### Task 5: Frontend — TrackHistoryPage
- [ ] Create `TrackHistoryPage.tsx` with track list + LineChart + version table
- [ ] Import Recharts `LineChart`, `Line`, `XAxis`, `YAxis`, `Tooltip`, `ResponsiveContainer`
- [ ] Add `/tracks` route to `App.tsx` inside `ProtectedLayout`
- [ ] Add "Track History" link to navigation

## Validation

- [ ] `track_name` column exists on `upload_job` table after migration
- [ ] Upload with `track_name` stores correctly; upload without `track_name` stores NULL
- [ ] `GET /tracks` returns grouped track data with correct version counts and scores
- [ ] Track History page renders correctly for a user with 2 tracks, each with 3 versions
- [ ] LineChart shows score trajectory over versions for selected track
- [ ] Empty state renders for users with no named tracks

## Anti-Patterns

- Do not make `track_name` required — it must be optional to preserve existing upload behavior
- Do not defer the DB migration to v1.2 — the column must exist from day one so data accumulates
- Do not use a separate `Track` DB model for v1.1 — grouping `UploadJob` rows by `track_name` in Python is sufficient; a normalized Track entity can be added in v1.2 if needed
- Do not attempt to auto-detect track names from filenames — user intent is required; let the producer name their tracks explicitly
