"""Story 5.7 / AR33 — .als subprocess isolation.

analyze_als() runs the real parse in a spawned child with a wall-clock
timeout (terminate() enforced) and a POSIX address-space cap. These tests
drive the child through the env-var test seam (ALS_ISOLATION_TEST_MODE) —
the ONLY spawn-safe injection point, since the child re-imports the module
fresh and cannot see monkeypatched parent state.
"""

from audio_analysis.phases.phase8_als import _analyze_als_impl, analyze_als

from .test_phase8_als import make_minimal_als


def test_isolated_result_matches_inprocess_impl(tmp_path):
    """Success parity: the subprocess round-trip returns exactly what the
    in-process impl produces (golden-snapshot safety)."""
    als = make_minimal_als(tmp_path)
    assert analyze_als(str(als)) == _analyze_als_impl(str(als))


def test_none_path_skips_without_spawn(monkeypatch):
    """No .als → early skipped return; the child (which would sleep forever
    under this seam) is never spawned."""
    monkeypatch.setenv("ALS_ISOLATION_TEST_MODE", "sleep")
    monkeypatch.setenv("ALS_PARSE_TIMEOUT_S", "3600")
    result = analyze_als(None)
    assert result["status"] == "skipped"
    assert result["error"] is None



def test_timeout_returns_typed_failure(tmp_path, monkeypatch):
    """A hung parse is terminated at the deadline and degrades to a typed
    phase failure — the job survives (AC3)."""
    als = make_minimal_als(tmp_path)
    monkeypatch.setenv("ALS_ISOLATION_TEST_MODE", "sleep")
    monkeypatch.setenv("ALS_PARSE_TIMEOUT_S", "2")
    result = analyze_als(str(als))
    assert result["phase"] == 8
    assert result["status"] == "failed"
    assert result["error"] == "als_isolation_timeout"
    assert result["data"] == {}



def test_child_crash_returns_typed_failure(tmp_path, monkeypatch):
    """A hard child death (os._exit — models segfault/OOM-kill) degrades to
    a typed phase failure instead of raising in the parent."""
    als = make_minimal_als(tmp_path)
    monkeypatch.setenv("ALS_ISOLATION_TEST_MODE", "crash")
    result = analyze_als(str(als))
    assert result["phase"] == 8
    assert result["status"] == "failed"
    assert result["error"] == "als_isolation_crashed"
    assert result["data"] == {}


def test_parse_error_still_typed_failure(tmp_path):
    """A catchable parse error inside the child comes back as the impl's own
    failed result (pre-isolation semantics preserved through the pipe)."""
    bad = tmp_path / "bad.als"
    bad.write_bytes(b"not gzip at all")
    result = analyze_als(str(bad))
    assert result["status"] == "failed"
    assert result["error"]  # parser's message, not an isolation sentinel
    assert not str(result["error"]).startswith("als_isolation")
