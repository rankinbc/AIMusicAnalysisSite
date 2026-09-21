from types import SimpleNamespace
from app.account_deletion_actor import _collect_storage_keys
from app.retention_actor import _version_keys, is_shared_key
def _v(path): return SimpleNamespace(file_path=path, reference_path=None, als_file_path=None, stem_paths=None, stem_paths_raw=None)
def test_everything_under_audio_demo_is_shared():
    assert is_shared_key("audio/demo/source.wav")
    assert is_shared_key("audio/demo/snapshot/source.flac")
    assert is_shared_key("audio/demo/snapshot/spectrogram.webp")
def test_user_objects_and_lookalikes_are_not_shared():
    assert not is_shared_key("audio/upload/j1/source.wav")
    assert not is_shared_key("audio/demolition/x.wav")   # prefix must end at the slash
    assert not is_shared_key(None) and not is_shared_key("")
def test_version_keys_never_returns_snapshot_audio():
    assert _version_keys(_v("audio/demo/snapshot/source.flac")) == []
    assert _version_keys(_v("audio/upload/j1/source.wav")) == ["audio/upload/j1/source.wav"]
class _Result:
    def __init__(self, rows): self._rows = rows
    def all(self): return self._rows
class _Session:
    def __init__(self, batches): self._batches = list(batches)
    def execute(self, *_a, **_k): return _Result(self._batches.pop(0))
def test_account_deletion_never_collects_demo_audio_or_images():
    analysis = SimpleNamespace(job_id="j1", spectrogram_image_path="audio/demo/snapshot/spectrogram.webp",
                               waveform_image_path=None, waveform_peaks_path="audio/demo/snapshot/peaks.json")
    s = _Session([[_v("audio/demo/snapshot/source.flac"), _v("audio/upload/j1/source.wav")], [analysis], []])
    assert _collect_storage_keys(s, "uid") == ["audio/upload/j1/source.wav", "reports/j1.json"]
