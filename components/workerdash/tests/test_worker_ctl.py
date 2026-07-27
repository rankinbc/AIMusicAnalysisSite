from workerdash.worker_ctl import derive_status


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
