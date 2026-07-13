<#
.SYNOPSIS
    Stop any running SPECTR v2 dev components and (re)launch the full local stack.

.DESCRIPTION
    Manages the primary v2 development stack:

        Infra   : Docker Compose  postgres (:5432) + redis (:6379)
        BFF     : .NET 10 minimal API           http://localhost:5000
        Worker  : Python dramatiq consumer      (no port)
        Frontend: Vite dev server (React 19)     http://localhost:5174

    The legacy FastAPI `api` and vanilla `frontend-spectr` are intentionally
    NOT managed (being phased out per CLAUDE.md).

    Flow:
        1. Stop existing instances of each app component (by listening port +
           by matching command line) so a clean process is started.
        2. Ensure the Docker infra (postgres + redis ONLY) is up and healthy.
        3. Preflight: verify Docker is reachable and postgres (5432) + redis
           (6379) accept TCP from the host. On failure the app components are
           NOT launched (story 12.3). Runs on -SkipInfra too — it validates
           the "already running" assumption instead of trusting it.
        4. Launch BFF, worker and frontend, each in its own PowerShell window
           with live logs.
        5. Print a summary of what started, what failed, and the URLs.

.PARAMETER StopOnly
    Stop the app components (and optionally the infra) without relaunching.

.PARAMETER SkipInfra
    Do not touch Docker. Assumes postgres + redis are already running.

.PARAMETER RecreateInfra
    `docker compose down` (volumes preserved) then `up -d` the infra, forcing a
    fresh postgres/redis container pair. Without this, infra is left running if
    already healthy.

.EXAMPLE
    ./scripts/start-spectr.ps1
        Restart the whole local stack.

.EXAMPLE
    ./scripts/start-spectr.ps1 -StopOnly
        Tear everything down.

.EXAMPLE
    ./scripts/start-spectr.ps1 -SkipInfra
        Restart just the app processes; leave Docker alone.
#>
[CmdletBinding()]
param(
    [switch]$StopOnly,
    [switch]$SkipInfra,
    [switch]$RecreateInfra,
    [switch]$SkipMigrations,
    [switch]$SkipRecovery
)

$ErrorActionPreference = 'Stop'
# This script lives in <repo>/scripts/ — the repo root is its parent.
$RepoRoot = Split-Path -Parent $PSScriptRoot

# ── Component definitions ───────────────────────────────────────────────────
$ComposeFile = Join-Path $RepoRoot 'docker/docker-compose.yml'
$BffDir      = Join-Path $RepoRoot 'components/bff/src/Spectr.Bff'
$DataProj    = Join-Path $RepoRoot 'components/bff/src/Spectr.Data'
$WorkerDir   = Join-Path $RepoRoot 'components/worker'
$FrontendDir = Join-Path $RepoRoot 'components/frontend-spectr-v2'

# Story 12.7 (AC5): resolve ONE absolute python and use it for BOTH the
# import pre-flight and the worker window. The spawned window runs a fresh
# PowerShell whose profile can reorder PATH — a bare `python` there may be a
# DIFFERENT interpreter than the one the launcher just verified (the
# check-vs-window profile divergence). $env:SPECTR_PYTHON overrides (e.g. a
# prepared venv's python.exe).
$PythonExe = if ($env:SPECTR_PYTHON) { $env:SPECTR_PYTHON }
             else { (Get-Command python -ErrorAction SilentlyContinue)?.Source }

# Canonical worker entrypoint (mirrors components/worker/Procfile), pinned to
# the resolved interpreter above.
$WorkerCmd = "& `"$PythonExe`" -m dramatiq app.dramatiq_app --processes 1 --threads 1 --queues coach analysis-paid analysis-free maintenance"

# ── Pretty output helpers ───────────────────────────────────────────────────
$script:Errors = @()
function Step   ([string]$m) { Write-Host "`n=== $m" -ForegroundColor Cyan }
function Info   ([string]$m) { Write-Host "    $m" -ForegroundColor Gray }
function Good   ([string]$m) { Write-Host "  + $m" -ForegroundColor Green }
function Warn   ([string]$m) { Write-Host "  ! $m" -ForegroundColor Yellow }
function Fail   ([string]$m) { Write-Host "  x $m" -ForegroundColor Red; $script:Errors += $m }

# Prefer PowerShell 7 (pwsh) for the spawned windows; fall back to Windows PowerShell.
$PwshExe = (Get-Command pwsh -ErrorAction SilentlyContinue)?.Source
if (-not $PwshExe) { $PwshExe = (Get-Command powershell -ErrorAction SilentlyContinue)?.Source }

# Resolve docker.exe explicitly. On some Windows boxes a 0-byte extensionless
# `C:\WINDOWS\system32\docker` shadows the real CLI and makes a bare `docker`
# silently no-op inside a PowerShell pipeline. Always invoke via `& $DockerExe`.
$DockerExe = (Get-Command 'docker.exe' -ErrorAction SilentlyContinue)?.Source
if (-not $DockerExe) { $DockerExe = (Get-Command 'docker' -ErrorAction SilentlyContinue)?.Source }

# ── Process-stopping primitives ─────────────────────────────────────────────
function Stop-ByPort {
    param([int]$Port, [string]$Label)
    $stopped = $false
    try {
        $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        foreach ($procId in ($conns.OwningProcess | Sort-Object -Unique)) {
            if (-not $procId -or $procId -eq 0) { continue }
            $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
            $name = if ($proc) { $proc.ProcessName } else { "pid $procId" }
            Stop-Process -Id $procId -Force -ErrorAction Stop
            Good "$Label`: stopped $name (pid $procId) on port $Port"
            $stopped = $true
        }
    } catch {
        Fail "$Label`: failed to stop process on port $Port - $($_.Exception.Message)"
    }
    return $stopped
}

function Stop-ByCommandLine {
    param([string]$ProcessName, [string]$Match, [string]$Label)
    $stopped = $false
    try {
        $procs = Get-CimInstance Win32_Process -Filter "Name = '$ProcessName'" -ErrorAction SilentlyContinue |
                 Where-Object { $_.CommandLine -and $_.CommandLine -like "*$Match*" }
        foreach ($p in $procs) {
            Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
            Good "$Label`: stopped $ProcessName (pid $($p.ProcessId))"
            $stopped = $true
        }
    } catch {
        Fail "$Label`: failed to stop $ProcessName matching '$Match' - $($_.Exception.Message)"
    }
    return $stopped
}

function Stop-Apps {
    Step 'Stopping existing SPECTR app components'

    # BFF — `dotnet run` builds & launches Spectr.Bff.exe (listens on :5000).
    # Kill by port AND by command line so the parent `dotnet run` host also dies
    # (avoids the bin/Debug/.../Spectr.Bff.exe file-lock that blocks rebuilds).
    $a = Stop-ByPort -Port 5000 -Label 'BFF'
    $b = Stop-ByCommandLine -ProcessName 'dotnet.exe' -Match 'Spectr.Bff' -Label 'BFF (dotnet run host)'
    if (-not ($a -or $b)) { Info 'BFF: nothing running' }

    # Worker — master + forked child (see Stop-Worker).
    Stop-Worker

    # Frontend — Vite dev server on :5174 (node.exe).
    $f = Stop-ByPort -Port 5174 -Label 'Frontend'
    if (-not $f) { Info 'Frontend: nothing running' }
}

# dramatiq runs a `python -m dramatiq` MASTER that forks a worker CHILD via
# multiprocessing.spawn. The child's command line is
# `... spawn_main(parent_pid=…) --multiprocessing-fork` — it does NOT contain
# "dramatiq", so a cmdline match kills only the master and ORPHANS the fork. The
# orphan keeps the dramatiq heartbeat alive ("half-dead worker": heartbeat fresh
# but nothing draining the queue) → uploads hang. So: tree-kill each master to
# take its children down with it, THEN sweep any multiprocessing-fork whose
# parent is already dead (orphans from a prior incomplete stop).
function Stop-Worker {
    $killed = $false

    # 1. dramatiq masters — taskkill /T kills the whole process tree (forks too).
    $masters = Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
               Where-Object { $_.CommandLine -and $_.CommandLine -like '*dramatiq*' }
    foreach ($m in $masters) {
        taskkill /F /T /PID $m.ProcessId *> $null
        Good "Worker: tree-killed dramatiq master (pid $($m.ProcessId))"
        $killed = $true
    }

    # 2. Orphaned forks — multiprocessing-fork python whose parent is gone.
    $forks = Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
             Where-Object { $_.CommandLine -and $_.CommandLine -like '*multiprocessing-fork*' }
    foreach ($f in $forks) {
        if (-not (Get-Process -Id $f.ParentProcessId -ErrorAction SilentlyContinue)) {
            Stop-Process -Id $f.ProcessId -Force -ErrorAction SilentlyContinue
            Good "Worker: killed orphaned fork (pid $($f.ProcessId), dead parent $($f.ParentProcessId))"
            $killed = $true
        }
    }

    if (-not $killed) { Info 'Worker: nothing running' }
}

# ── Docker infra ────────────────────────────────────────────────────────────
function Test-Docker {
    if (-not $DockerExe) { return $false }
    try { & $DockerExe info *> $null; return ($LASTEXITCODE -eq 0) } catch { return $false }
}

function Stop-Infra {
    if ($SkipInfra) { return }
    Step 'Stopping Docker infra (postgres + redis)'
    if (-not (Test-Docker)) { Warn 'Docker not available - skipping infra teardown'; return }
    & $DockerExe compose -f $ComposeFile stop postgres redis 2>&1 | ForEach-Object { Info $_ }
    if ($LASTEXITCODE -eq 0) { Good 'Infra stopped' } else { Fail 'docker compose stop failed' }
}

function Start-Infra {
    if ($SkipInfra) { Step 'Skipping Docker infra (-SkipInfra)'; return }
    Step 'Ensuring Docker infra (postgres + redis) is up'

    if (-not (Test-Docker)) {
        Fail 'Docker is not running. Start Docker Desktop, then re-run (or use -SkipInfra).'
        return
    }

    if ($RecreateInfra) {
        Info 'Recreating infra containers (volumes preserved)...'
        & $DockerExe compose -f $ComposeFile down 2>&1 | ForEach-Object { Info $_ }
    }

    # IMPORTANT: only postgres + redis. Naming them avoids building/starting the
    # bff/worker/frontend compose services (which need JWT_KEY + image builds).
    & $DockerExe compose -f $ComposeFile up -d postgres redis 2>&1 | ForEach-Object { Info $_ }
    if ($LASTEXITCODE -ne 0) { Fail 'docker compose up failed'; return }

    # Wait for healthchecks (both services define one).
    Info 'Waiting for postgres + redis to report healthy...'
    $deadline = (Get-Date).AddSeconds(60)
    foreach ($svc in 'postgres', 'redis') {
        $cid = (& $DockerExe compose -f $ComposeFile ps -q $svc).Trim()
        if (-not $cid) { Fail "$svc container not found after up"; continue }
        do {
            $health = (& $DockerExe inspect -f '{{.State.Health.Status}}' $cid 2>$null)
            if ($health -eq 'healthy') { break }
            Start-Sleep -Milliseconds 800
        } while ((Get-Date) -lt $deadline)
        if ($health -eq 'healthy') { Good "$svc healthy" } else { Fail "$svc not healthy (status: $health)" }
    }
}

# ── Preflight (story 12.3 / AC4) ────────────────────────────────────────────
# Host-side truth check before launching the app components. Start-Infra's
# healthcheck wait proves the CONTAINER thinks it's healthy; these TCP probes
# prove the ports are actually reachable from the host — and they are the ONLY
# check on the -SkipInfra path, which otherwise trusts the "already running"
# assumption. BFF/worker/frontend are all DB/Redis-dependent at boot, so
# launching them into dead infra just multiplies red windows; failing here also
# spares the confusing EF stack trace Update-Database would print first.
function Test-TcpPort {
    param([int]$Port, [int]$TimeoutMs = 2000)
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        # Wait() throws on connection-refused (faulted task) -> catch -> false.
        return ($client.ConnectAsync('localhost', $Port).Wait($TimeoutMs) -and $client.Connected)
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Test-Preflight {
    Step 'Preflight: infra reachable from the host'
    $ok = $true

    if ($SkipInfra) {
        # Docker isn't required under -SkipInfra (postgres/redis may be hosted
        # elsewhere) — report, don't fail.
        if (Test-Docker) { Info 'Docker: reachable' }
        else { Info 'Docker: not reachable (fine under -SkipInfra if postgres/redis run elsewhere)' }
    } elseif (-not (Test-Docker)) {
        Fail 'Preflight: Docker daemon not reachable - Docker Desktop not running?'
        $ok = $false
    }

    if (Test-TcpPort -Port 5432) { Good 'postgres: TCP 5432 accepting connections' }
    else {
        Fail 'Preflight: nothing accepting TCP on localhost:5432 - postgres not running/healthy? Try -RecreateInfra.'
        $ok = $false
    }

    if (Test-TcpPort -Port 6379) { Good 'redis: TCP 6379 accepting connections' }
    else {
        Fail 'Preflight: nothing accepting TCP on localhost:6379 - redis not running/healthy? Try -RecreateInfra.'
        $ok = $false
    }

    return $ok
}

# ── DB migrations ───────────────────────────────────────────────────────────
# The BFF owns the canonical schema via EF Core. If pending migrations aren't
# applied, EF's model references columns the DB lacks and every query 500s
# (e.g. `column analyses.spectrogram_image_path does not exist`). Run this with
# the BFF STOPPED (Stop-Apps already ran) so there's no build-output file lock.
function Update-Database {
    if ($SkipMigrations) { Step 'Skipping DB migrations (-SkipMigrations)'; return }
    Step 'Applying EF Core migrations (BFF schema)'
    if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) { Fail 'Migrations: `dotnet` not found on PATH'; return }
    if (-not (Get-Command 'dotnet-ef' -ErrorAction SilentlyContinue) -and -not (& dotnet ef --version 2>$null)) {
        Fail 'Migrations: dotnet-ef tool not installed (run: dotnet tool install --global dotnet-ef)'; return
    }
    Info 'dotnet ef database update...'
    $out = & dotnet ef database update --project $DataProj --startup-project $BffDir 2>&1
    if ($LASTEXITCODE -eq 0) {
        $applied = $out | Select-String -Pattern "Applying migration '([^']+)'" | ForEach-Object { $_.Matches.Groups[1].Value }
        if ($applied) { $applied | ForEach-Object { Good "applied $_" } } else { Good 'schema already up to date' }
    }
    elseif ($out -match 'PendingModelChangesWarning') {
        # In-progress entity edits with no migration yet. The applied schema is
        # current; EF just refuses to validate the drifted model. Don't block the
        # dev stack — warn and continue (it's NOT counted as a launch error).
        Warn 'BFF model has pending entity changes with no migration — schema left as-is.'
        Info 'Add a migration when ready:  dotnet ef migrations add <Name> --project src/Spectr.Data --startup-project src/Spectr.Bff'
    }
    else {
        $out | Select-Object -Last 15 | ForEach-Object { Info $_ }
        Fail 'dotnet ef database update failed (see lines above)'
    }
}

# ── Job recovery ────────────────────────────────────────────────────────────
# Stop-Apps just killed the worker, so any job it had IN-FLIGHT (`processing`,
# message consumed + unacked) is abandoned — fail those so the UI shows a
# re-runnable error instead of spinning forever. Story 3.5 (NFR16): `pending`
# jobs are NOT failed — their messages still sit in the Redis LIST and the
# worker we're about to start resumes them.
function Invoke-Recovery {
    if ($SkipRecovery) { Step 'Skipping job recovery (-SkipRecovery)'; return }
    Step 'Recovering jobs orphaned by a stopped worker'
    $recover = Join-Path $PSScriptRoot 'recover-jobs.ps1'
    if (-not (Test-Path $recover)) { Warn 'recover-jobs.ps1 not found — skipping'; return }
    try {
        & $recover -ComposeFile $ComposeFile 2>&1 | ForEach-Object { Write-Host "  $_" }
    } catch {
        Fail "job recovery failed - $($_.Exception.Message)"
    }
}

# ── App launchers (each in its own window) ──────────────────────────────────
function Start-InWindow {
    param([string]$Title, [string]$WorkDir, [string]$Command, [hashtable]$EnvVars)
    if (-not $PwshExe) { Fail "$Title`: no PowerShell executable found to host the window"; return }
    if (-not (Test-Path $WorkDir)) { Fail "$Title`: directory not found - $WorkDir"; return }

    $envSetup = ''
    if ($EnvVars) { foreach ($k in $EnvVars.Keys) { $envSetup += "`$env:$k = '$($EnvVars[$k])'; " } }

    # -NoExit keeps the window (and its logs) open after the process exits/crashes.
    $inner = "`$host.UI.RawUI.WindowTitle = '$Title'; Set-Location '$WorkDir'; $envSetup" +
             "Write-Host '>> $Title' -ForegroundColor Cyan; Write-Host '>> $Command' -ForegroundColor DarkGray; $Command"
    try {
        Start-Process -FilePath $PwshExe -ArgumentList '-NoExit', '-Command', $inner | Out-Null
        Good "$Title`: launched in new window"
    } catch {
        Fail "$Title`: failed to launch - $($_.Exception.Message)"
    }
}

function Start-Apps {
    Step 'Launching SPECTR app components'

    # --- BFF ---
    if (Get-Command dotnet -ErrorAction SilentlyContinue) {
        # Story 4.1: Development env is REQUIRED for local runs — appsettings.json
        # carries no signing keys (NFR6); dev keys live in appsettings.Development.json.
        # `dotnet run` reads Properties/launchSettings.json (Development), and the
        # explicit env var below covers shells/tools that bypass launch profiles.
        Start-InWindow -Title 'SPECTR BFF (:5000)' -WorkDir $BffDir -Command "`$env:ASPNETCORE_ENVIRONMENT='Development'; dotnet run"
    } else {
        Fail 'BFF: `dotnet` not found on PATH (install .NET 10 SDK)'
    }

    # --- Worker ---
    if ($env:SPECTR_PYTHON -and -not (Test-Path $env:SPECTR_PYTHON -PathType Leaf)) {
        # A set-but-wrong override deserves its own diagnosis (a directory or
        # typo here would otherwise abort mid-launch on the & invoke).
        Fail "Worker NOT started: `$env:SPECTR_PYTHON is set but not a file: $env:SPECTR_PYTHON"
    }
    elseif ($PythonExe -and (Test-Path $PythonExe -PathType Leaf)) {
        # Story 12.2 (AC1): fail LOUD if the worker deps are missing. A worker
        # window opened with a doomed command instantly errors while the
        # launcher exits green — a dead worker from minute zero. Story 12.7
        # (AC5): the check and the window use the SAME resolved interpreter.
        Info "Worker python: $PythonExe"
        & $PythonExe -c "import dramatiq, audio_analysis" 2>$null
        if ($LASTEXITCODE -ne 0) {
            # Re-run without suppression to capture the actual import error.
            $importError = (& $PythonExe -c "import dramatiq, audio_analysis" 2>&1 |
                            Where-Object { $_ -match 'Error' } | Select-Object -Last 1)
            if (-not $importError) { $importError = 'import failed (no error text captured)' }
            Fail ("Worker NOT started: ``$PythonExe`` cannot import worker deps - $importError. " +
                  'Install: pip install -r components/worker/requirements.txt ' +
                  'and pip install -e components/shared components/analysis ' +
                  '(or point $env:SPECTR_PYTHON at the prepared venv python.exe)')
        } else {
            Start-InWindow -Title 'SPECTR Worker' -WorkDir $WorkerDir -Command $WorkerCmd
        }
    } else {
        Fail 'Worker NOT started: no python found (PATH or $env:SPECTR_PYTHON)'
    }

    # --- Frontend ---
    if (Get-Command npm -ErrorAction SilentlyContinue) {
        if (-not (Test-Path (Join-Path $FrontendDir 'node_modules'))) {
            Warn 'Frontend: node_modules missing - the window will run `npm install` first'
            Start-InWindow -Title 'SPECTR Frontend (:5174)' -WorkDir $FrontendDir -Command 'npm install; npm run dev'
        } else {
            Start-InWindow -Title 'SPECTR Frontend (:5174)' -WorkDir $FrontendDir -Command 'npm run dev'
        }
    } else {
        Fail 'Frontend: `npm` not found on PATH (install Node.js)'
    }
}

# ── Summary ─────────────────────────────────────────────────────────────────
function Show-Summary {
    Step 'Summary'
    if ($script:Errors.Count -eq 0) {
        Good 'No errors encountered.'
    } else {
        Write-Host "  $($script:Errors.Count) issue(s):" -ForegroundColor Red
        $script:Errors | ForEach-Object { Write-Host "    - $_" -ForegroundColor Red }
    }
    if (-not $StopOnly) {
        Write-Host ''
        Write-Host '  URLs:' -ForegroundColor White
        Write-Host '    Frontend : http://localhost:5174' -ForegroundColor White
        Write-Host '    BFF API  : http://localhost:5000' -ForegroundColor White
        Write-Host '    BFF docs : http://localhost:5000/openapi/v1.json' -ForegroundColor White
        Write-Host ''
        Info 'BFF & frontend take a few seconds to compile - watch their windows.'
        Info 'Each service runs in its own window; close the window to stop that service.'
    }
}

# ── Main ────────────────────────────────────────────────────────────────────
Write-Host 'SPECTR local launcher' -ForegroundColor Magenta
Write-Host "Repo: $RepoRoot" -ForegroundColor DarkGray

Stop-Apps

if ($StopOnly) {
    Stop-Infra
    Show-Summary
    if ($script:Errors.Count -gt 0) { exit 1 } else { exit 0 }
}

Start-Infra
if (Test-Preflight) {
    Update-Database
    Invoke-Recovery
    Start-Apps
} else {
    # Preflight already Fail'ed the specifics; make the outcome unmissable.
    Warn 'Preflight failed - app components NOT launched.'
}
Show-Summary

if ($script:Errors.Count -gt 0) { exit 1 } else { exit 0 }
