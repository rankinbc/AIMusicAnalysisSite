"""Worker watchdog: keep the dramatiq worker alive, with evidence.

`python -m workerdash.watchdog` probes the worker every INTERVAL_S seconds
(process pair + heartbeat, same rules as the dashboard). Two consecutive
bad checks trigger a tree-kill + relaunch — with the worker's stdout/stderr
redirected to a dated log file, so the next crash finally leaves a trace.
Three restarts inside a 10-minute window halt the watchdog's restarting
(crash loop — restarting harder won't help) and flag it in the status file
the dashboard reads.

Status file (WATCHDOG_STATUS_FILE, default <repo data/>/logs/watchdog-status.json):
{ts, status, action, restarts_in_window, halted} — best-effort, read by
/api/state for the dashboard banner.
"""
import json
import os
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

from . import wire
from . import worker_ctl

INTERVAL_S = 30
BAD = ("dead", "half-dead")
CRASH_LOOP_MAX = 3
CRASH_LOOP_WINDOW_S = 600

WORKER_DIR_DEFAULT = os.path.normpath(os.path.join(
    os.path.dirname(__file__), "..", "..", "worker"))
LOG_DIR_DEFAULT = os.path.normpath(os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "data", "logs"))


@dataclass
class Decision:
    action: str  # ok | wait | restart | halt


def decide(status_history, restart_times, now) -> Decision:
    """Pure: act on the last two statuses + recent restart timestamps."""
    recent = [t for t in restart_times if now - t <= CRASH_LOOP_WINDOW_S]
    last_two = status_history[-2:]
    if len(last_two) < 2 or any(s not in BAD for s in last_two):
        bad_now = bool(last_two) and last_two[-1] in BAD
        return Decision("wait" if bad_now else "ok")
    if len(recent) >= CRASH_LOOP_MAX:
        return Decision("halt")
    return Decision("restart")


def launch_worker_logged(worker_dir: str, log_dir: str) -> str:
    """Relaunch the workers — one per pool in ``worker_ctl.WORKER_POOLS`` (coach
    alone, then batch; STARTUP.md #3b) — each with output redirected to its own
    dated log file. Returns the batch (last) pool's log path. Uses Start-Process
    redirection (the workers keep running after the watchdog exits)."""
    Path(log_dir).mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    log = ""
    for pool in worker_ctl.WORKER_POOLS:
        name = pool[0] if len(pool) == 1 else "batch"
        log = os.path.join(log_dir, f"worker-{name}-{stamp}.log")
        err = os.path.join(log_dir, f"worker-{name}-{stamp}.err.log")
        queues = ",".join(f"'{q}'" for q in pool)
        ps = (
            f"Start-Process -WindowStyle Hidden -WorkingDirectory '{worker_dir}' "
            f"-RedirectStandardOutput '{log}' -RedirectStandardError '{err}' "
            "-FilePath python -ArgumentList '-m','dramatiq','app.dramatiq_app',"
            "'--processes','1','--threads','1',"
            f"'--queues',{queues}"
        )
        subprocess.run(["powershell", "-NoProfile", "-Command", ps],
                       capture_output=True, text=True, timeout=120)
    return log


def kill_worker() -> None:
    """Tree-kill dramatiq masters + sweep orphaned forks (STARTUP.md rule)."""
    ps = """
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  Where-Object { $_.CommandLine -match 'dramatiq' } |
  ForEach-Object { taskkill /F /T /PID $_.ProcessId }
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  Where-Object { $_.CommandLine -match 'multiprocessing' -and
                 -not (Get-Process -Id $_.ParentProcessId -ErrorAction SilentlyContinue) } |
  Stop-Process -Force
"""
    subprocess.run(["powershell", "-NoProfile", "-Command", ps],
                   capture_output=True, text=True, timeout=120)


def write_status(path: str, **fields) -> None:
    try:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(json.dumps({"ts": time.time(), **fields}))
    except Exception:
        pass  # status file is best-effort telemetry


def run_loop() -> None:  # pragma: no cover — subprocess/IO loop, manual-tested
    import redis
    r = redis.Redis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379/0"))
    worker_dir = os.environ.get("WORKER_DIR", WORKER_DIR_DEFAULT)
    log_dir = os.environ.get("WORKER_LOG_DIR", LOG_DIR_DEFAULT)
    status_file = os.environ.get(
        "WATCHDOG_STATUS_FILE", os.path.join(LOG_DIR_DEFAULT, "watchdog-status.json"))

    history: list[str] = []
    restart_times: list[float] = []
    halted = False
    print(f"watchdog: probing every {INTERVAL_S}s; worker={worker_dir}; logs={log_dir}",
          flush=True)
    while True:
        # The supervisor must survive ANY single bad cycle (slow PowerShell,
        # subprocess TimeoutExpired, transient Redis error) — a watchdog that
        # dies on one exception is worse than none, because it LOOKS covered.
        try:
            try:
                hb = wire.heartbeat_age_seconds(r)
            except Exception:
                hb = None
            p = worker_ctl.probe()
            status = worker_ctl.derive_status(p["master"], p["fork"], hb)
            history.append(status)
            del history[:-2]  # only the last two matter; don't grow forever
            now = time.time()
            d = decide(history, restart_times, now)
            if d.action == "restart" and not halted:
                print(f"watchdog: worker {status} twice — restarting", flush=True)
                kill_worker()
                log = launch_worker_logged(worker_dir, log_dir)
                restart_times.append(now)
                history.clear()  # fresh slate for the new worker
                print(f"watchdog: relaunched; worker log: {log}", flush=True)
            elif d.action == "halt" and not halted:
                halted = True
                print("watchdog: CRASH LOOP — 3 restarts in 10 min; halting restarts. "
                      f"Check the newest worker log in {log_dir}", flush=True)
            elif halted and status == "healthy":
                # Someone fixed it manually — resume guarding.
                halted = False
                restart_times.clear()
                print("watchdog: worker healthy again; resuming supervision", flush=True)
            write_status(status_file, status=status, action=d.action,
                         restarts_in_window=len([t for t in restart_times
                                                 if now - t <= CRASH_LOOP_WINDOW_S]),
                         halted=halted)
        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"watchdog: cycle failed ({e!r}) — retrying in {INTERVAL_S}s", flush=True)
            write_status(status_file, status="probe-error", action="wait",
                         restarts_in_window=0, halted=halted, error=str(e))
        time.sleep(INTERVAL_S)


if __name__ == "__main__":  # pragma: no cover
    run_loop()
