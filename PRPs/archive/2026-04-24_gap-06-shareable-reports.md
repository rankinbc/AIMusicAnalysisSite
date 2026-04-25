# PRP: GAP-06 — Shareable Report Links

**Status:** Draft  
**Effort:** 1–2 hours  
**Phase:** v1.1 — Collaboration and sharing

---

## Goal

Generate a UUID share token for each analysis result, expose an unauthenticated read-only endpoint by token, and add a "Copy Share Link" button to the report page so producers can share results without requiring recipients to have accounts.

## Why

- Sharing a report with a mastering engineer or Discord community is a natural workflow step that currently requires a screenshot
- Mix Check Studio supports this; its absence is a friction point for collaborative use cases
- Every shared link is an organic growth touchpoint — recipients encounter the product without a paid ad

## What

### Backend

**File:** `models.py` (or wherever `AnalysisResult` is defined)

Add `share_token` column to `AnalysisResult`:

```python
import uuid

class AnalysisResult(Base):
    # ... existing columns ...
    share_token: Mapped[str] = mapped_column(
        String(36),
        default=lambda: str(uuid.uuid4()),
        unique=True,
        index=True,
        nullable=False
    )
```

**Migration:** Generate an Alembic migration:
```bash
alembic revision --autogenerate -m "add share_token to analysis_result"
```

In the migration `upgrade()`, if backfilling existing rows is needed:
```sql
UPDATE analysis_result SET share_token = gen_random_uuid()::text WHERE share_token IS NULL;
```

**File:** `routers/analysis.py` (or wherever analysis routes live)

Add the public share endpoint — place it BEFORE any auth middleware that would apply globally:

```python
@router.get("/reports/share/{share_token}", response_model=dict)
async def get_shared_report(
    share_token: str,
    session: AsyncSession = Depends(get_session)
):
    result = await session.scalar(
        select(AnalysisResult).where(AnalysisResult.share_token == share_token)
    )
    if not result:
        raise HTTPException(status_code=404, detail="Report not found")
    return result.final_json
```

Do NOT apply `Depends(get_current_user)` to this route — it must be publicly accessible.

### Frontend

**File:** `frontend/src/pages/ReportPage.tsx`

Add a "Copy Share Link" button in the report header area:

```tsx
const handleCopyShareLink = () => {
  const shareUrl = `${window.location.origin}/reports/share/${result.share_token}`;
  navigator.clipboard.writeText(shareUrl).then(() => {
    // Show a brief "Copied!" toast or change button text temporarily
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  });
};

<button
  onClick={handleCopyShareLink}
  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
>
  {copied ? "Copied!" : "Copy Share Link"}
</button>
```

**New file:** `frontend/src/pages/SharedReportPage.tsx`

A page that fetches `GET /reports/share/:token` and renders the report in read-only mode. Reuse existing report components but omit the upload button, delete button, and any authenticated actions:

```tsx
const SharedReportPage = () => {
  const { token } = useParams();
  const { data, isLoading, error } = useQuery(
    ['shared-report', token],
    () => fetch(`/api/reports/share/${token}`).then(r => r.json())
  );
  if (isLoading) return <LoadingSpinner />;
  if (error || !data) return <NotFound />;
  return <ReportView result={data} readOnly />;
};
```

**File:** `frontend/src/App.tsx`

Add the route (outside `ProtectedLayout`):

```tsx
<Route path="/reports/share/:token" element={<SharedReportPage />} />
```

## Tasks

### Task 1: Backend — add share_token column and migration
- [ ] Add `share_token` mapped column to `AnalysisResult` in `models.py`
- [ ] Import `uuid` at the top of `models.py`
- [ ] Run `alembic revision --autogenerate -m "add share_token to analysis_result"`
- [ ] Review the generated migration — ensure `default` generates UUID on insert, not as a server default
- [ ] If the DB already has rows, add backfill SQL in `upgrade()`
- [ ] Run `alembic upgrade head` and verify column exists in DB

### Task 2: Backend — add public share route
- [ ] Add `GET /reports/share/{share_token}` route to the analysis router
- [ ] Confirm the route does NOT use `get_current_user` dependency
- [ ] Test with `curl /api/reports/share/<valid_token>` — expect 200 + JSON
- [ ] Test with `curl /api/reports/share/fake-token` — expect 404

### Task 3: Frontend — Copy Share Link button
- [ ] Add `share_token` to the TypeScript type for `AnalysisResult` / report response
- [ ] Add `handleCopyShareLink` function and button to `ReportPage.tsx`
- [ ] Add `copied` state with 2-second reset for "Copied!" feedback
- [ ] Test clipboard write in browser

### Task 4: Frontend — SharedReportPage
- [ ] Create `frontend/src/pages/SharedReportPage.tsx`
- [ ] Fetch `GET /api/reports/share/:token` from `useParams()`
- [ ] Render report using existing components in read-only mode
- [ ] Add the route to `App.tsx` outside the auth wrapper
- [ ] Test by opening the share URL in incognito — report should load without login

## Validation

- [ ] New `AnalysisResult` rows have a non-null, unique `share_token` UUID
- [ ] `GET /reports/share/{valid_token}` returns 200 with full report JSON, no auth required
- [ ] `GET /reports/share/{invalid_token}` returns 404
- [ ] "Copy Share Link" button appears on authenticated report page and copies correct URL
- [ ] Share URL opens in incognito and displays the full analysis report
- [ ] Authenticated actions (upload, delete) are not present on the shared view

## Anti-Patterns

- Do not apply `get_current_user` to the share endpoint — it must be unauthenticated
- Do not use sequential integers as share tokens — they are guessable; UUIDs are not
- Do not forget to backfill `share_token` for existing rows in the migration or existing reports will have NULL tokens and the "Copy Share Link" button will break
- Do not place the public route inside a router group that has auth middleware applied at the group level
