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
