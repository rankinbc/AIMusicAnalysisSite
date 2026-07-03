<#
.SYNOPSIS
    Recover SPECTR analysis jobs orphaned by a dead/restarted worker.

.DESCRIPTION
    When the dramatiq worker dies mid-flight, the jobs it was running stay in
    `processing` forever and queued jobs stay `pending` — the worker's in-flight
    messages sit unacked in Redis and dramatiq's low-traffic maintenance never
    requeues them. The UI then spins with no error (it only shows an error once a
    job reaches `failed`).

    This script finds non-terminal jobs (`pending` / `processing`) older than a
    staleness threshold and marks them `failed` with a clear, UI-visible message
    (`error_code = worker_unavailable`). The user then sees "worker stopped — re-run"
    instead of an infinite spinner, and can re-trigger the analysis.

    We deliberately FAIL-and-resurface rather than reverse-engineer dramatiq's
    Redis ack internals to requeue — that path is fragile across dramatiq versions.
    Re-running from the UI is deterministic.

    Talks to Postgres through the docker-compose `postgres` service (dev stack).

.PARAMETER StaleMinutes
    Age threshold. Jobs whose most-recent activity (started_at, else dispatched_at)
    is older than this are considered abandoned. When omitted, this is read from
    the BFF's appsettings.json `Worker:StaleJobMinutes` (the single source of truth
    shared with the runtime StaleJobReaper), falling back to 30 if unreadable.

.PARAMETER DryRun
    Show what WOULD be failed without changing anything.

.PARAMETER ComposeFile
    Path to the docker-compose file (defaults to <repo>/docker/docker-compose.yml).

.EXAMPLE
    ./scripts/recover-jobs.ps1 -DryRun
        Preview abandoned jobs.

.EXAMPLE
    ./scripts/recover-jobs.ps1
        Fail all abandoned jobs older than 30 min.

.EXAMPLE
    ./scripts/recover-jobs.ps1 -StaleMinutes 5
        Tighter threshold (e.g. right after a known worker crash).
#>
[CmdletBinding()]
param(
    [int]$StaleMinutes,
    [switch]$DryRun,
    [string]$ComposeFile
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
if (-not $ComposeFile) { $ComposeFile = Join-Path $RepoRoot 'docker/docker-compose.yml' }

# Single source of truth: when -StaleMinutes isn't passed, read the same value
# the BFF StaleJobReaper uses (appsettings.json Worker:StaleJobMinutes), so the
# launcher and the runtime reaper never drift. Fall back to 30 if unreadable.
if (-not $PSBoundParameters.ContainsKey('StaleMinutes')) {
    $StaleMinutes = 30
    $appsettings = Join-Path $RepoRoot 'components/bff/src/Spectr.Bff/appsettings.json'
    if (Test-Path $appsettings) {
        try {
            $cfg = Get-Content $appsettings -Raw | ConvertFrom-Json
            if ($cfg.Worker -and $cfg.Worker.StaleJobMinutes) {
                $StaleMinutes = [int]$cfg.Worker.StaleJobMinutes
            }
        } catch { }  # malformed/locked → keep default
    }
}

function Info ([string]$m) { Write-Host "    $m" -ForegroundColor Gray }
function Good ([string]$m) { Write-Host "  + $m" -ForegroundColor Green }
function Warn ([string]$m) { Write-Host "  ! $m" -ForegroundColor Yellow }

# Resolve docker.exe explicitly (a 0-byte C:\WINDOWS\system32\docker can shadow it).
$DockerExe = (Get-Command 'docker.exe' -ErrorAction SilentlyContinue)?.Source
if (-not $DockerExe) { $DockerExe = (Get-Command 'docker' -ErrorAction SilentlyContinue)?.Source }
if (-not $DockerExe) { Warn 'docker not found — cannot reach Postgres'; exit 1 }

# Resolve the postgres container id via compose (robust to project-name changes).
$Pg = (& $DockerExe compose -f $ComposeFile ps -q postgres 2>$null)
if ($Pg) { $Pg = $Pg.Trim() }
if (-not $Pg) { Warn 'postgres container not running (start the stack first)'; exit 1 }

# Returns scalar text from a one-row/one-col query.
function Invoke-Scalar ([string]$sql) {
    ($sql | & $DockerExe exec -i $Pg psql -U spectr -d spectr -t -A 2>$null | Select-Object -First 1)
}

Write-Host 'SPECTR job recovery' -ForegroundColor Magenta
Info "stale threshold: $StaleMinutes min  (mode: $(if ($DryRun) {'DRY-RUN'} else {'apply'}))"

# Predicate shared by the preview + the update. Story 3.5 (NFR16): PROCESSING
# only — a pending job's message still sits in the Redis queue and the worker
# this launcher is about to start WILL consume it; failing pending jobs here
# was defeating queue-resume by design. (The runtime StaleJobReaper still
# catches truly orphaned pending rows after its long PendingGraceMinutes.)
$where = @"
status = 'processing'
AND COALESCE(started_at, dispatched_at, TIMESTAMPTZ '2000-01-01')
    < now() - (INTERVAL '1 minute' * $StaleMinutes)
"@

# Preview counts by status.
$preview = @"
SELECT status, count(*) FROM analysis_jobs WHERE $where GROUP BY status ORDER BY status;
"@
Write-Host "`n  Abandoned jobs:" -ForegroundColor White
$rows = $preview | & $DockerExe exec -i $Pg psql -U spectr -d spectr -t -A -F ' x ' 2>$null | Where-Object { $_ }
$total = [int](Invoke-Scalar "SELECT count(*) FROM analysis_jobs WHERE $where;")
if ($total -eq 0) { Good 'none — nothing to recover'; exit 0 }
$rows | ForEach-Object { Info $_ }

if ($DryRun) {
    Warn "$total job(s) WOULD be marked failed (dry-run, no changes)"
    exit 0
}

# Apply: mark failed with a UI-visible message. error_code intentionally NOT
# 'invalid_file' (that triggers the BFF credit-reversal read path).
$update = @"
UPDATE analysis_jobs SET
    status = 'failed',
    error_code = 'worker_unavailable',
    error_message = 'Analysis worker stopped before this job finished. Re-run the analysis.',
    current_phase = 'failed',
    failed_at = now()
WHERE $where;
"@
$result = $update | & $DockerExe exec -i $Pg psql -U spectr -d spectr 2>&1
if ($LASTEXITCODE -eq 0) {
    Good "marked $total job(s) failed (error_code=worker_unavailable) — now visible in the UI as a re-runnable failure"
} else {
    $result | ForEach-Object { Info $_ }
    Warn 'update failed'
    exit 1
}
