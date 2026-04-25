# Start all dev services cleanly. Run from the project root.
# Usage: powershell -ExecutionPolicy Bypass -File start-dev.ps1

$Root = $PSScriptRoot

Write-Host "Stopping any running dev processes..." -ForegroundColor Yellow
Get-Process -Name python* -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -match "uvicorn|celery"
} | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name node* -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -match "vite"
} | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Host "Starting API on port 8000..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "cd '$Root\components\api'; python -m uvicorn app.main:app --port 8000 --reload" -WindowStyle Normal

Start-Sleep -Seconds 3

Write-Host "Starting Celery worker..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "cd '$Root\components\worker'; python -m celery -A app.celery_app worker --loglevel=info --concurrency=1 --pool=solo" -WindowStyle Normal

Write-Host "Starting frontend on port 5173..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "cd '$Root\components\frontend'; npm run dev -- --port 5173 --strictPort" -WindowStyle Normal

Start-Sleep -Seconds 5
Write-Host ""
Write-Host "Dev stack running:" -ForegroundColor Green
Write-Host "  Frontend : http://localhost:5173" -ForegroundColor White
Write-Host "  API      : http://localhost:8000" -ForegroundColor White
Write-Host ""
Write-Host "Open http://localhost:5173 in your browser." -ForegroundColor Green
