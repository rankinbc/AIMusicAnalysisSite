# Latest `final_json` extract — 2026-06-25

Pulled from the local Postgres (`spectr` DB, `analyses` table, Docker container `docker-postgres-1`).

## Source row
- **analysis id:** `92a87fbe-16cf-4230-8ac5-7c7fdde8ff5c`
- **song_name:** `gvb ghbhg`
- **created_at:** `2026-06-25 22:51:21 UTC`
- **size:** ~64 KB JSONB (3,629 lines pretty-printed)

This is the most recent row **with a real payload**. The 5 newest rows by `created_at`
(23:09–23:10 UTC) all have a **2-byte `final_json` (`{}`)** — the empty-payload signature of the
"analysis dispatched but worker didn't finish / wasn't running" pattern (see memory
`stuck-pending-worker-down`). Worth checking the dramatiq worker if those were expected to complete.

## Files
- `final_json.full.json` — exact `jsonb_pretty(final_json)` output, nothing removed.
- `final_json.condensed.json` — identical structure, but long numeric arrays (`beats`, `downbeats`,
  segment timings, etc.) collapsed to `[first, second, "... N values ...", last]` for readability.
  Every scalar field and value is preserved.

## Query used
```sql
SELECT jsonb_pretty(final_json) FROM analyses
WHERE id = '92a87fbe-16cf-4230-8ac5-7c7fdde8ff5c';
```
To re-pull the latest non-empty row:
```sql
SELECT id, created_at, song_name, octet_length(final_json::text) AS bytes
FROM analyses
WHERE octet_length(final_json::text) > 100
ORDER BY created_at DESC LIMIT 1;
```
