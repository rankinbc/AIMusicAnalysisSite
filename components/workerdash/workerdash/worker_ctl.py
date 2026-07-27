"""Windows worker process probe + restart. Mirrors docs/STARTUP.md exactly:
NEVER kill only the dramatiq master (orphans the fork) — tree-kill, then
sweep orphaned forks, then relaunch the canonical Procfile command."""
import os
import shutil
import subprocess

HEARTBEAT_STALE_SECONDS = 60

_PROBE_PS = (
    "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | "
    "ForEach-Object { $_.CommandLine }"
)

_KILL_PS = """
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  Where-Object { $_.CommandLine -match 'dramatiq' } |
  ForEach-Object { taskkill /F /T /PID $_.ProcessId }
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  Where-Object { $_.CommandLine -match 'multiprocessing' -and
                 -not (Get-Process -Id $_.ParentProcessId -ErrorAction SilentlyContinue) } |
  Stop-Process -Force
"""

_LAUNCH_PS = (
    "Start-Process powershell -WindowStyle Minimized -ArgumentList "
    "'-NoExit','-Command',"
    "\"Set-Location '{worker_dir}'; python -m dramatiq app.dramatiq_app "
    "--processes 1 --threads 1 "
    "--queues coach analysis-paid analysis-free maintenance\""
)


def _ps(script: str) -> str:
    out = subprocess.run(
        ["powershell", "-NoProfile", "-Command", script],
        capture_output=True, text=True, timeout=30)
    return out.stdout


def probe() -> dict:
    try:
        lines = _ps(_PROBE_PS).splitlines()
    except Exception:
        return {"master": False, "fork": False}
    return {
        "master": any("dramatiq" in (l or "") for l in lines),
        "fork": any("multiprocessing" in (l or "") for l in lines),
    }


def derive_status(master: bool, fork: bool, heartbeat_age) -> str:
    if not master and not fork:
        return "dead"
    if heartbeat_age is None or heartbeat_age > HEARTBEAT_STALE_SECONDS:
        return "dead"
    if master and fork:
        return "healthy"
    return "half-dead"


def _docker_exe() -> str | None:
    """Resolve the real docker CLI. Bare `docker` on this machine is shadowed
    by a 0-byte stub in System32 (STARTUP.md problem #1), so prefer the
    Docker Desktop install path and reject zero-size candidates."""
    candidates = [
        r"C:\Program Files\Docker\Docker\resources\bin\docker.exe",
        shutil.which("docker.exe"),
        shutil.which("docker"),
    ]
    for c in candidates:
        try:
            if c and os.path.isfile(c) and os.path.getsize(c) > 0:
                return c
        except OSError:
            continue
    return None


def allin1_container() -> str | None:
    """Best-effort: name of a running structure-detection container, if any.
    Dynamically resolves docker.exe, filtering out the 0-byte System32 stub
    (see STARTUP.md problem #1)."""
    exe = _docker_exe()
    if exe is None:
        return None
    try:
        out = subprocess.run([exe, "ps", "--format", "{{.Names}}"],
                             capture_output=True, text=True, timeout=10)
        names = [n for n in out.stdout.splitlines()
                 if n and not n.startswith("docker-")]  # infra is docker-postgres-1 etc.
        return names[0] if names else None
    except Exception:
        return None


def restart(worker_dir: str) -> dict:
    if not os.path.isdir(worker_dir):
        return {"ok": False, "error": f"worker dir not found: {worker_dir}"}
    try:
        _ps(_KILL_PS)
        _ps(_LAUNCH_PS.format(worker_dir=worker_dir))
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}
