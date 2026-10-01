<#
.SYNOPSIS
    Run only the checks for what you changed (dev loop), or every gate (-Full).

.DESCRIPTION
    DEV LOOP (default): diffs the working tree (committed + staged + unstaged +
    untracked) against the merge-base with -Base (default origin/develop), maps
    each changed file to its component and runs just the relevant checks:

      worker / analysis / shared  pytest on the changed test files + tests that
                                  import a changed module (whole suite when a
                                  change can't be mapped, e.g. conftest.py);
                                  ruff on the changed .py files.
                                  shared model changes also run the worker suite.
      workerdash                  its whole suite (~1 s).
      frontend-spectr-v2          tsc -b, eslint on changed files, vitest
                                  `related` (tests that import changed files),
                                  CSS token/focus lints when .css changed.
      bff                         dotnet build + test classes that mention a
                                  changed type (tests need Postgres running).

    CHECKPOINT (-Full): every gate from CLAUDE.md "Validation gates" + the CI
    extras. Run before merging develop -> solo (deploy) or when asked.

.EXAMPLE
    ./scripts/test-changed.ps1                  # dev loop
    ./scripts/test-changed.ps1 -DryRun          # just print what would run
    ./scripts/test-changed.ps1 -Only worker,frontend
    ./scripts/test-changed.ps1 -Full            # checkpoint: all gates
    ./scripts/test-changed.ps1 -Base origin/solo
#>
[CmdletBinding()]
param(
    [string]$Base = 'origin/develop',
    [switch]$Full,
    [switch]$DryRun,
    [ValidateSet('worker', 'workerdash', 'analysis', 'shared', 'frontend', 'bff')]
    [string[]]$Only
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (git -C $PSScriptRoot rev-parse --show-toplevel).Trim()
$Python = if ($env:SPECTR_PYTHON) { $env:SPECTR_PYTHON } else { 'python' }

$Dir = @{
    worker     = Join-Path $RepoRoot 'components/worker'
    workerdash = Join-Path $RepoRoot 'components/workerdash'
    analysis   = Join-Path $RepoRoot 'components/analysis'
    shared     = Join-Path $RepoRoot 'components/shared'
    frontend   = Join-Path $RepoRoot 'components/frontend-spectr-v2'
    bff        = Join-Path $RepoRoot 'components/bff'
}

# ── step runner ──────────────────────────────────────────────────────────────
$script:Results = [System.Collections.Generic.List[object]]::new()

function Invoke-Step {
    param([string]$Component, [string]$Label, [string]$WorkDir, [string]$Exe, [string[]]$Arguments)
    if ($Only -and $Component -notin $Only) { return }
    $shown = "$Exe $($Arguments -join ' ')"
    if ($shown.Length -gt 220) { $shown = $shown.Substring(0, 217) + '...' }
    Write-Host "`n=== [$Component] $Label" -ForegroundColor Cyan
    Write-Host "    $shown" -ForegroundColor DarkGray
    if ($DryRun) { $script:Results.Add([pscustomobject]@{ Component = $Component; Step = $Label; Result = 'dry-run'; Seconds = 0 }); return }
    $sw = [Diagnostics.Stopwatch]::StartNew()
    Push-Location $WorkDir
    try {
        & $Exe @Arguments
        $ok = ($LASTEXITCODE -eq 0)
    } catch {
        Write-Host "    $($_.Exception.Message)" -ForegroundColor Red
        $ok = $false
    } finally {
        Pop-Location
    }
    $sw.Stop()
    $script:Results.Add([pscustomobject]@{
        Component = $Component; Step = $Label
        Result = if ($ok) { 'PASS' } else { 'FAIL' }
        Seconds = [math]::Round($sw.Elapsed.TotalSeconds, 1)
    })
}

function Write-Summary {
    Write-Host "`n=== Summary" -ForegroundColor Cyan
    if ($script:Results.Count -eq 0) { Write-Host '    nothing to run'; return 0 }
    foreach ($r in $script:Results) {
        $color = switch ($r.Result) { 'PASS' { 'Green' } 'FAIL' { 'Red' } default { 'Gray' } }
        Write-Host ("    {0,-5} {1,-11} {2,-40} {3,6}s" -f $r.Result, $r.Component, $r.Step, $r.Seconds) -ForegroundColor $color
    }
    $failed = @($script:Results | Where-Object Result -eq 'FAIL').Count
    if ($failed) { Write-Host "`n    $failed step(s) FAILED" -ForegroundColor Red; return 1 }
    Write-Host "`n    all green" -ForegroundColor Green
    return 0
}

# ── checkpoint mode: every gate ──────────────────────────────────────────────
if ($Full) {
    Invoke-Step worker  'ruff (all python)' $RepoRoot $Python @('-m', 'ruff', 'check', 'components/worker/', 'components/shared/', 'components/analysis/src/', 'components/workerdash/')
    Invoke-Step worker  'pytest (full)' $Dir.worker $Python @('-m', 'pytest', '-q', 'tests/')
    Invoke-Step worker  'mypy verdict_lib' $Dir.worker $Python @('-m', 'mypy', 'app/verdict_lib/', '--ignore-missing-imports')
    Invoke-Step workerdash 'pytest (full)' $Dir.workerdash $Python @('-m', 'pytest', '-q', 'tests/')
    Invoke-Step shared  'pytest (full)' $RepoRoot $Python @('-m', 'pytest', '-q', 'components/shared/tests/')
    Invoke-Step analysis 'pytest (full)' $RepoRoot $Python @('-m', 'pytest', '-q', 'components/analysis/tests/')
    Invoke-Step frontend 'tsc -b' $Dir.frontend 'npx' @('tsc', '-b')
    Invoke-Step frontend 'lint' $Dir.frontend 'npm' @('run', 'lint')
    Invoke-Step frontend 'lint:css' $Dir.frontend 'npm' @('run', 'lint:css')
    Invoke-Step frontend 'lint:prices' $Dir.frontend 'npm' @('run', 'lint:prices')
    Invoke-Step frontend 'lint:focus' $Dir.frontend 'npm' @('run', 'lint:focus')
    Invoke-Step frontend 'build' $Dir.frontend 'npm' @('run', 'build')
    Invoke-Step frontend 'lint:bundle' $Dir.frontend 'npm' @('run', 'lint:bundle')
    Invoke-Step frontend 'vitest (full)' $Dir.frontend 'npx' @('vitest', 'run')
    Invoke-Step bff     'dotnet build' $Dir.bff 'dotnet' @('build')
    Invoke-Step bff     'dotnet test (needs Postgres)' $Dir.bff 'dotnet' @('test', '--no-build')
    exit (Write-Summary)
}

# ── dev-loop mode: what changed? ─────────────────────────────────────────────
$mergeBase = (git -C $RepoRoot merge-base HEAD $Base 2>$null)
if (-not $mergeBase) {
    Write-Host "Can't find a merge-base with '$Base' (fetch it, or pass -Base <ref>)." -ForegroundColor Red
    exit 2
}
$changed = @(
    git -C $RepoRoot diff --name-only $mergeBase.Trim()
    git -C $RepoRoot ls-files --others --exclude-standard
) | Where-Object { $_ } | Sort-Object -Unique

Write-Host "Changed vs $Base (merge-base $($mergeBase.Trim().Substring(0, 7))): $($changed.Count) file(s)" -ForegroundColor Cyan
if ($changed.Count -eq 0) { Write-Host '    nothing changed'; exit 0 }

function Get-Changed([string]$prefix) {
    @($changed | Where-Object { $_.StartsWith($prefix) })
}

# Python: map changed source modules to the test files that import them.
# $pkgRoot: repo-relative dir that contains the package (e.g. components/worker)
function Get-PythonTargets {
    param([string]$ComponentDir, [string]$PkgRoot, [string]$TestsRel, [string[]]$Files)
    $testsAbs = Join-Path $ComponentDir $TestsRel
    $targets = [System.Collections.Generic.HashSet[string]]::new()
    $needFull = $false
    $testFiles = @(Get-ChildItem $testsAbs -Recurse -Filter 'test_*.py' -File -ErrorAction SilentlyContinue)
    foreach ($f in $Files) {
        $abs = Join-Path $RepoRoot $f
        $name = Split-Path $f -Leaf
        if ($name -in 'conftest.py', 'pytest.ini', 'pyproject.toml', 'requirements.txt', 'requirements.lock.txt') { $needFull = $true; continue }
        if (-not $f.EndsWith('.py')) { if ($f -match '/prompts/') { $needFull = $true }; continue }
        if ($name -like 'test_*.py') { if (Test-Path $abs) { [void]$targets.Add($abs) }; continue }
        if (-not $f.StartsWith("$PkgRoot/")) { continue }
        # app/runlog/middleware.py -> app.runlog.middleware ; package app.runlog ; leaf middleware
        $mod = $f.Substring($PkgRoot.Length + 1) -replace '\.py$', '' -replace '/', '.'
        $mod = $mod -replace '\.__init__$', ''
        $leaf = $mod.Split('.')[-1]
        $pkg = if ($mod.Contains('.')) { $mod.Substring(0, $mod.LastIndexOf('.')) } else { '' }
        $patterns = @([regex]::Escape($mod))
        if ($pkg) { $patterns += "from\s+$([regex]::Escape($pkg))\s+import\s+[^\n]*\b$([regex]::Escape($leaf))\b" }
        $hits = @($testFiles | Where-Object { Select-String -Path $_.FullName -Pattern $patterns -Quiet })
        if ($hits.Count -eq 0) { $needFull = $true } else { $hits | ForEach-Object { [void]$targets.Add($_.FullName) } }
    }
    [pscustomobject]@{ Full = $needFull; Files = @($targets) }
}

function Invoke-PythonComponent {
    param([string]$Component, [string]$ComponentDir, [string]$PkgRoot, [string]$TestsRel, [string[]]$Files, [switch]$ForceFull)
    if (-not $Files -and -not $ForceFull) { return }
    $t = Get-PythonTargets -ComponentDir $ComponentDir -PkgRoot $PkgRoot -TestsRel $TestsRel -Files $Files
    if ($ForceFull -or $t.Full) {
        $why = if ($ForceFull) { 'upstream change' } else { 'unmapped change' }
        Invoke-Step $Component "pytest (full — $why)" $ComponentDir $Python @('-m', 'pytest', '-q', $TestsRel)
    } elseif ($t.Files.Count) {
        $rel = $t.Files | ForEach-Object { [IO.Path]::GetRelativePath($ComponentDir, $_) }
        Invoke-Step $Component "pytest ($($rel.Count) file(s))" $ComponentDir $Python (@('-m', 'pytest', '-q') + $rel)
    }
}

# ── python components ────────────────────────────────────────────────────────
$py = @($changed | Where-Object { $_.EndsWith('.py') -and (Test-Path (Join-Path $RepoRoot $_)) -and $_ -match '^components/(worker|workerdash|analysis/src|shared)/' })
$pyComps = @('worker', 'workerdash', 'analysis', 'shared')
if ($py.Count -and (-not $Only -or ($Only | Where-Object { $_ -in $pyComps }))) {
    # ruff is cross-component; attribute it to a selected python component
    $comp = if ($Only) { @($Only | Where-Object { $_ -in $pyComps })[0] } else { 'worker' }
    Invoke-Step $comp "ruff ($($py.Count) changed file(s))" $RepoRoot $Python (@('-m', 'ruff', 'check') + $py)
}

$sharedChanged = Get-Changed 'components/shared/'
Invoke-PythonComponent shared $Dir.shared 'components/shared' 'tests' $sharedChanged
Invoke-PythonComponent analysis $Dir.analysis 'components/analysis/src' 'tests' (Get-Changed 'components/analysis/')
# Worker depends on shared's ORM models: a shared change re-runs the worker suite.
Invoke-PythonComponent worker $Dir.worker 'components/worker' 'tests' (Get-Changed 'components/worker/') -ForceFull:([bool]($sharedChanged | Where-Object { $_.EndsWith('.py') }))
if (Get-Changed 'components/workerdash/') {
    Invoke-Step workerdash 'pytest (full, ~1 s)' $Dir.workerdash $Python @('-m', 'pytest', '-q', 'tests/')
}

# ── frontend ─────────────────────────────────────────────────────────────────
$fe = @(Get-Changed 'components/frontend-spectr-v2/')
if ($fe.Count) {
    $feRel = $fe | ForEach-Object { $_.Substring('components/frontend-spectr-v2/'.Length) }
    $feExisting = @($feRel | Where-Object { Test-Path (Join-Path $Dir.frontend $_) })
    $code = @($feExisting | Where-Object { $_ -match '\.(ts|tsx)$' })
    $css = @($feExisting | Where-Object { $_ -match '\.css$' })
    if ($code.Count -or ($feRel -match 'tsconfig|package\.json')) {
        Invoke-Step frontend 'tsc -b (incremental)' $Dir.frontend 'npx' @('tsc', '-b')
    }
    if ($code.Count) {
        Invoke-Step frontend "eslint ($($code.Count) file(s))" $Dir.frontend 'npx' (@('eslint', '--max-warnings', '0') + $code)
        $src = @($code | Where-Object { $_.StartsWith('src/') })
        if ($src.Count) {
            # vitest `related`: tests that (transitively) import the changed files.
            Invoke-Step frontend 'vitest related' $Dir.frontend 'npx' (@('vitest', 'related', '--run', '--passWithNoTests') + $src)
        }
    }
    if ($css.Count) {
        Invoke-Step frontend 'lint:css' $Dir.frontend 'npm' @('run', 'lint:css')
        Invoke-Step frontend 'lint:focus' $Dir.frontend 'npm' @('run', 'lint:focus')
    }
}

# ── bff ──────────────────────────────────────────────────────────────────────
$cs = @(Get-Changed 'components/bff/' | Where-Object { $_ -match '\.(cs|csproj|json|props)$' })
if ($cs.Count) {
    Invoke-Step bff 'dotnet build' $Dir.bff 'dotnet' @('build', '--nologo', '-v', 'q')
    $testDir = Join-Path $Dir.bff 'tests/Spectr.Bff.Tests'
    # Only files that declare tests — helpers (TestEnv, TestSupport) mention everything.
    $testFiles = @(Get-ChildItem $testDir -Recurse -Filter '*.cs' -File |
        Where-Object { $_.FullName -notmatch '[\\/](obj|bin)[\\/]' -and (Select-String -Path $_.FullName -Pattern '\[(Fact|Theory)' -Quiet) })
    $classes = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($f in ($cs | Where-Object { $_.EndsWith('.cs') })) {
        $stem = [IO.Path]::GetFileNameWithoutExtension($f)
        if ($f -match '/tests/') { [void]$classes.Add($stem); continue }
        if ($f -match '/Migrations/') { continue }  # migrations are exercised by every DB test; use -Full
        foreach ($tf in $testFiles) {
            if (Select-String -Path $tf.FullName -Pattern "\b$([regex]::Escape($stem))\b" -Quiet) { [void]$classes.Add($tf.BaseName) }
        }
    }
    if ($classes.Count -gt 0 -and $classes.Count -le 25) {
        $filter = ($classes | ForEach-Object { "FullyQualifiedName~.$_" }) -join '|'
        Invoke-Step bff "dotnet test ($($classes.Count) class(es), needs Postgres)" $Dir.bff 'dotnet' @('test', '--no-build', '--nologo', '--filter', $filter)
    } elseif ($classes.Count -gt 25) {
        Invoke-Step bff 'dotnet test (full — wide change, needs Postgres)' $Dir.bff 'dotnet' @('test', '--no-build', '--nologo')
    } else {
        Write-Host "`n    [bff] no test class references the changed types — build only (use -Only bff -Full for all tests)" -ForegroundColor Yellow
    }
}

exit (Write-Summary)
