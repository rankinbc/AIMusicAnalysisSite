from workerdash.worker_ctl import derive_status, _docker_exe


def test_healthy():
    assert derive_status(True, True, 3.0) == "healthy"


def test_half_dead_fork_missing_but_heartbeat_fresh():
    assert derive_status(True, False, 3.0) == "half-dead"
    assert derive_status(False, True, 3.0) == "half-dead"


def test_dead_no_processes():
    assert derive_status(False, False, 3.0) == "dead"
    assert derive_status(False, False, None) == "dead"


def test_dead_stale_heartbeat_even_with_processes():
    assert derive_status(True, True, 120.0) == "dead"


def test_docker_exe_rejects_zero_byte_stub(tmp_path, monkeypatch):
    """Verify that _docker_exe() rejects zero-size stubs (System32 shadow)."""
    from workerdash import worker_ctl

    # Create a 0-byte stub (the System32 shadow)
    stub = tmp_path / "docker.exe"
    stub.touch()  # 0 bytes

    # Create a real docker executable
    real = tmp_path / "real" / "docker.exe"
    real.parent.mkdir()
    real.write_bytes(b"MZ")  # Fake PE header

    # Mock shutil.which to return the stub
    original_which = worker_ctl.shutil.which

    def mock_which(name):
        if name in ("docker.exe", "docker"):
            return str(stub)
        return original_which(name)

    monkeypatch.setattr(worker_ctl.shutil, "which", mock_which)

    # The zero-byte stub should be rejected
    result = _docker_exe()
    assert result != str(stub), "Zero-byte stub should be rejected"


# ── Worker pool split (docs/STARTUP.md problem #3b) ─────────────────────────
# One worker = one thread and Dramatiq has no cross-queue priority, so an
# all-queues worker parks every coach reply behind whatever batch job is
# running. The dashboard's restart must keep the coach-only pool, not
# silently collapse back to a single all-queues worker.

def test_worker_pools_cover_every_queue_once_and_coach_is_alone():
    from workerdash import wire, worker_ctl
    pools = worker_ctl.WORKER_POOLS
    assert ("coach",) in pools
    flat = [q for pool in pools for q in pool]
    assert sorted(flat) == sorted(wire.QUEUES)


def test_restart_launches_one_worker_per_pool(tmp_path, monkeypatch):
    from workerdash import worker_ctl
    scripts = []
    monkeypatch.setattr(worker_ctl, "_ps", lambda s: scripts.append(s) or "")
    assert worker_ctl.restart(str(tmp_path)) == {"ok": True}
    launches = [s for s in scripts if "--queues" in s]
    assert len(launches) == len(worker_ctl.WORKER_POOLS)
    assert any(s.rstrip('"').endswith("--queues coach") for s in launches)
    assert not any("coach" in s and "analysis-paid" in s for s in launches)


def test_probe_flags_a_missing_fork_even_when_another_worker_is_whole(monkeypatch):
    from workerdash import worker_ctl
    lines = "\n".join([
        "python.exe -m dramatiq app.dramatiq_app --queues coach",
        "python.exe -c from multiprocessing.spawn import spawn_main --multiprocessing-fork",
        "python.exe -m dramatiq app.dramatiq_app --queues analysis-paid analysis-free maintenance",
    ])
    monkeypatch.setattr(worker_ctl, "_ps", lambda s: lines)
    p = worker_ctl.probe()
    assert p["master"] is True and p["fork"] is False  # → derive_status: half-dead
