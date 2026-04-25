# PRP: GAP-07 — Past Analyses History Page ("My Reports")

**Status:** Draft  
**Effort:** 2–3 hours  
**Phase:** v1.1 — Retention features

---

## Goal

Expose a `GET /jobs` endpoint returning the authenticated user's analysis history and build a `HistoryPage.tsx` component that renders a sortable table of past analyses with links to individual reports.

## Why

- History is a primary retention driver — users return to compare versions and track improvement
- All data already exists in the database; this is purely a read path surfacing existing rows
- Mix Check Studio has this feature; its absence means every user session starts from scratch

## What

### Backend

**File:** `routers/jobs.py` (or wherever `UploadJob` routes live)

Add a list endpoint:

```python
from pydantic import BaseModel
from datetime import datetime

class JobSummary(BaseModel):
    id: int
    filename: str
    status: str
    grade: str | None
    genre: str | None
    created_at: datetime
    analysis_result_id: int | None

    class Config:
        from_attributes = True

@router.get("/jobs", response_model=list[JobSummary])
async def list_jobs(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session)
):
    result = await session.execute(
        select(UploadJob)
        .options(selectinload(UploadJob.analysis_result))
        .where(UploadJob.user_id == current_user.id)
        .order_by(UploadJob.created_at.desc())
        .limit(50)
    )
    jobs = result.scalars().all()
    return jobs
```

If `grade` and `genre` are stored in `AnalysisResult.final_json` rather than as dedicated columns, the `JobSummary` serializer needs a `@validator` or `@computed_field` that extracts them:

```python
@computed_field
def grade(self) -> str | None:
    if self.analysis_result and self.analysis_result.final_json:
        return self.analysis_result.final_json.get("grade")
    return None
```

Alternatively, add dedicated `grade: str` and `genre: str` columns to `AnalysisResult` if they are not already present (preferred for query performance).

### Frontend

**New file:** `frontend/src/pages/HistoryPage.tsx`

```tsx
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';

const gradeColor = (grade: string) => ({
  'A': 'bg-green-500', 'B': 'bg-blue-500',
  'C': 'bg-yellow-500', 'D': 'bg-orange-500', 'F': 'bg-red-500'
}[grade] ?? 'bg-gray-500');

const HistoryPage = () => {
  const { data: jobs, isLoading } = useQuery({
    queryKey: ['jobs'],
    queryFn: () => fetch('/api/jobs', { credentials: 'include' }).then(r => r.json())
  });

  if (isLoading) return <div>Loading your reports...</div>;
  if (!jobs?.length) return <div>No analyses yet. <Link to="/upload">Upload your first track</Link></div>;

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-2xl font-bold mb-6">My Reports</h1>
      <table className="w-full">
        <thead>
          <tr className="text-left border-b">
            <th>Track</th><th>Grade</th><th>Genre</th><th>Date</th><th></th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job: JobSummary) => (
            <tr key={job.id} className="border-b hover:bg-gray-50">
              <td className="py-3">{job.filename}</td>
              <td>
                {job.grade && (
                  <span className={`px-2 py-1 rounded text-white font-bold ${gradeColor(job.grade)}`}>
                    {job.grade}
                  </span>
                )}
              </td>
              <td>{job.genre ?? '—'}</td>
              <td>{new Date(job.created_at).toLocaleDateString()}</td>
              <td>
                <Link to={`/reports/${job.analysis_result_id}`} className="text-blue-600 hover:underline">
                  View
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default HistoryPage;
```

**File:** `frontend/src/App.tsx`

Add route inside `ProtectedLayout`:
```tsx
<Route path="/history" element={<HistoryPage />} />
```

**File:** Navigation component — add "My Reports" link to the authenticated nav.

## Tasks

### Task 1: Backend — JobSummary schema and list endpoint
- [ ] Define `JobSummary` Pydantic model with `id`, `filename`, `status`, `grade`, `genre`, `created_at`, `analysis_result_id`
- [ ] Determine whether `grade` and `genre` are columns on `AnalysisResult` or keys in `final_json`
- [ ] Add `GET /jobs` route with `get_current_user` dependency
- [ ] Use `selectinload(UploadJob.analysis_result)` to avoid N+1 when reading grade/genre from the related model
- [ ] Test with `curl -H "Authorization: Bearer <token>" /api/jobs` — expect list of job summaries

### Task 2: Frontend — HistoryPage component
- [ ] Create `frontend/src/pages/HistoryPage.tsx`
- [ ] Define TypeScript `JobSummary` interface matching the API response
- [ ] Implement table with columns: Track, Grade (colored badge), Genre, Date, View link
- [ ] Add empty state message
- [ ] Test with a user that has 0 analyses (empty state) and with a user that has multiple

### Task 3: Routing and navigation
- [ ] Add `/history` route inside `ProtectedLayout` in `App.tsx`
- [ ] Add "My Reports" link to the authenticated navigation component
- [ ] Verify navigation link appears only for logged-in users

## Validation

- [ ] `GET /jobs` returns 200 with list for authenticated user
- [ ] `GET /jobs` returns 401 for unauthenticated request
- [ ] History page renders correctly for a user with 5+ past analyses
- [ ] Empty state renders correctly for a new user with no analyses
- [ ] Each "View" link navigates to the correct report page
- [ ] Grade badges are colored correctly (green=A, blue=B, yellow=C, orange=D, red=F)

## Anti-Patterns

- Do not use `select(UploadJob).all()` without a user filter — this would return all users' jobs
- Do not skip `selectinload` for the `analysis_result` relationship — lazy loading in async SQLAlchemy raises `MissingGreenlet` errors
- Do not paginate in v1.1 — use `limit(50)` and defer pagination to v1.2
- Do not place the `/history` route outside `ProtectedLayout` — the history page must require authentication
