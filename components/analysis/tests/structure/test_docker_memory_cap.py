import subprocess
import pytest
from audio_analysis.structure import docker_allin1 as mod

# The suite's autouse `_no_real_allin1_docker` fixture (tests/conftest.py) stubs
# DockerAllin1.analyze to "unavailable" so nothing shells out to the real
# container. These tests drive the wrapper with a fully faked subprocess, so
# they opt out the same way components/analysis/tests/structure/test_docker_allin1.py
# does — never a real `docker run`.
pytestmark = pytest.mark.uses_docker_wrapper

def _runner(monkeypatch, tmp_path, returncode=0, stdout='{"bpm": 120, "segments": []}', stderr=""):
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"RIFF")
    seen = {}
    d = mod.DockerAllin1()
    monkeypatch.setattr(d, "ensure_available", lambda: None)
    def fake_run(cmd, *, timeout):
        seen["cmd"] = cmd
        return subprocess.CompletedProcess(cmd, returncode, stdout, stderr)
    monkeypatch.setattr(d, "_run", staticmethod(fake_run))
    return d, audio, seen

def test_the_container_is_memory_capped_with_no_swap(monkeypatch, tmp_path):
    monkeypatch.delenv("ALLIN1_MEMORY_LIMIT", raising=False)
    d, audio, seen = _runner(monkeypatch, tmp_path)
    try:
        d.analyze(audio)
    except Exception:
        pass  # result parsing is not under test
    cmd = seen["cmd"]
    assert cmd[cmd.index("--memory") + 1] == "6g"
    assert cmd[cmd.index("--memory-swap") + 1] == "6g"        # equal → the container cannot swap the VM to death
    assert cmd.index("--memory") < cmd.index(d.image_name)    # flags precede the image

def test_the_cap_is_env_tunable(monkeypatch, tmp_path):
    monkeypatch.setenv("ALLIN1_MEMORY_LIMIT", "3g")
    d, audio, seen = _runner(monkeypatch, tmp_path)
    try:
        d.analyze(audio)
    except Exception:
        pass
    assert seen["cmd"][seen["cmd"].index("--memory") + 1] == "3g"

def test_an_oom_kill_is_reported_as_such(monkeypatch, tmp_path):
    d, audio, _ = _runner(monkeypatch, tmp_path, returncode=137, stdout="", stderr="Killed")
    with pytest.raises(mod.Allin1OutOfMemory):
        d.analyze(audio)
