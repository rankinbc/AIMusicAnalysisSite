"""Top-level conftest. Re-exports stem fixtures so they're visible to all test dirs."""
import pytest

from tests.stems.conftest import synth_stem_files, synth_stems_dir  # noqa: F401


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "uses_docker_wrapper: opt out of the autouse allin1-Docker stub "
        "(for tests that exercise DockerAllin1 directly with a fake subprocess)",
    )


@pytest.fixture(autouse=True)
def _no_real_allin1_docker(request, monkeypatch):
    """Keep the unit suite from shelling out to the `allin1:latest` Docker
    container during Phase 1.

    Once the image is built on the dev box, ``DockerAllin1.analyze`` would run
    a real ~60-90 s analysis per test (and choke on the 2 s synthetic tones).
    Force it to the "unavailable" path so structure detection is deterministic
    and offline. Real Docker analysis is covered by the manual/integration
    end-to-end check, not unit tests.

    Tests marked ``uses_docker_wrapper`` opt out so they can drive the wrapper
    with a stubbed subprocess.
    """
    if request.node.get_closest_marker("uses_docker_wrapper"):
        return

    from audio_analysis.structure import docker_allin1

    def _unavailable(self, *args, **kwargs):
        raise docker_allin1.Allin1Unavailable("structure detection disabled in unit tests")

    monkeypatch.setattr(docker_allin1.DockerAllin1, "analyze", _unavailable)
