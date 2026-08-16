<#
.SYNOPSIS
    Put the local SPECTR dev stack behind a public HTTPS URL so someone else
    can click into it (demo / show-a-friend), then tear the URL down.

.DESCRIPTION
    Wraps start-spectr.ps1 with a Cloudflare "quick tunnel": a throwaway
    https://<random>.trycloudflare.com hostname that forwards to the Vite dev
    server on :5174. No Cloudflare account, no DNS, no deploy.

    Only :5174 is exposed. The BFF (:5000) stays bound to localhost — the
    frontend's own /api proxy forwards to it SERVER-side, which also means the
    visitor is same-origin with the API and the BFF's localhost-only CORS
    allowlist is never consulted.

    SECURITY — read before running:
      * Anyone with the link reaches your dev stack. They can register an
        account, upload audio, and burn your Anthropic spend via the coach.
      * The link is unguessable but unauthenticated. Treat it like a password.
      * It dies when this script exits. That is the off switch — close the
        window when the demo is over.
      * This is the DEV stack against your DEV database. Do not use it for
        anything you would not hand a stranger.

    Requires cloudflared:  winget install --id Cloudflare.cloudflared

.PARAMETER SkipStack
    Assume BFF/worker/frontend are already running; only open the tunnel.

.PARAMETER Yes
    Skip the "this will be public" confirmation prompt.

.EXAMPLE
    ./scripts/share-demo.ps1
        Restart the stack, then print a public URL.

.EXAMPLE
    ./scripts/share-demo.ps1 -SkipStack
        Stack is already up — just get me a link.
#>
[CmdletBinding()]
param(
    [switch]$SkipStack,
    [switch]$Yes
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$FrontendPort = 5174

function Info  { param($m) Write-Host "==> $m" -ForegroundColor Cyan }
function Warn  { param($m) Write-Host "!!  $m" -ForegroundColor Yellow }
function Fail  { param($m) Write-Host "!!  $m" -ForegroundColor Red; exit 1 }

# ── 1. Consent ──────────────────────────────────────────────────────────────
if (-not $Yes) {
    Warn 'This publishes your local dev stack to the public internet.'
    Warn 'Anyone with the link can register, upload, and spend your API credits.'
    $answer = Read-Host 'Type "share" to continue'
    if ($answer -ne 'share') { Fail 'Aborted.' }
}

# ── 2. cloudflared present? ─────────────────────────────────────────────────
$cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cloudflared) {
    Warn 'cloudflared is not installed. Install it with:'
    Write-Host '    winget install --id Cloudflare.cloudflared' -ForegroundColor White
    Fail 'Re-run this script once it is on PATH.'
}

# ── 3. Bring the stack up ───────────────────────────────────────────────────
# Read by vite.config.ts to accept the tunnel's Host header and point the HMR
# websocket at :443. Set BEFORE launching so the child windows inherit it.
$env:SPECTR_SHARE = '1'

if (-not $SkipStack) {
    Info 'Starting the SPECTR stack (this opens its own windows)...'
    & (Join-Path $PSScriptRoot 'start-spectr.ps1')
} else {
    Warn 'Skipping stack start. If the frontend was already running WITHOUT'
    Warn 'SPECTR_SHARE=1, restart it or the tunnel will 403 on Host check.'
}

# ── 4. Wait for Vite ────────────────────────────────────────────────────────
Info "Waiting for the frontend on :$FrontendPort ..."
$ready = $false
foreach ($_attempt in 1..60) {
    try {
        $probe = New-Object System.Net.Sockets.TcpClient
        $probe.Connect('127.0.0.1', $FrontendPort)
        $probe.Close()
        $ready = $true
        break
    } catch {
        Start-Sleep -Seconds 2
    }
}
if (-not $ready) { Fail "Frontend never came up on :$FrontendPort. Check its window, then see docs/STARTUP.md section 6." }

# ── 5. Open the tunnel ──────────────────────────────────────────────────────
$logDir = Join-Path $env:TEMP 'spectr-share'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$outLog = Join-Path $logDir 'cloudflared.out.log'
$errLog = Join-Path $logDir 'cloudflared.err.log'
Remove-Item $outLog, $errLog -ErrorAction SilentlyContinue

Info 'Opening the public tunnel...'
$tunnel = Start-Process -FilePath $cloudflared.Source `
    -ArgumentList 'tunnel', '--url', "http://localhost:$FrontendPort" `
    -PassThru -NoNewWindow `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog

# cloudflared prints the assigned hostname to stderr, usually within ~5 s.
$publicUrl = $null
foreach ($_attempt in 1..45) {
    Start-Sleep -Seconds 1
    $text = (Get-Content $outLog, $errLog -Raw -ErrorAction SilentlyContinue) -join "`n"
    $hit = [regex]::Match($text, 'https://[a-z0-9-]+\.trycloudflare\.com')
    if ($hit.Success) { $publicUrl = $hit.Value; break }
    if ($tunnel.HasExited) { Fail "cloudflared exited early. Log: $errLog" }
}

if (-not $publicUrl) {
    Warn "Could not parse the URL. Check $errLog"
    Fail 'Tunnel may still be starting — look in that log for a trycloudflare.com hostname.'
}

# ── 6. Hand over the link ───────────────────────────────────────────────────
Write-Host ''
Write-Host '  ┌────────────────────────────────────────────────────────┐' -ForegroundColor Green
Write-Host '  │  SEND THIS LINK                                        │' -ForegroundColor Green
Write-Host '  └────────────────────────────────────────────────────────┘' -ForegroundColor Green
Write-Host "     $publicUrl" -ForegroundColor White
Write-Host ''
Info 'The link is live while this window stays open.'
Info 'Press Ctrl-C (or close this window) to kill it.'
Write-Host ''

try {
    Wait-Process -Id $tunnel.Id
} finally {
    if (-not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue }
    Info 'Tunnel closed. The link is dead.'
}
