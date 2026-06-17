import gzip
from pathlib import Path
import pytest
from audio_analysis.phases.phase8_als import analyze_als


def make_minimal_als(tmp_path: Path) -> Path:
    xml = b"""<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="11" MinorVersion="0">
  <LiveSet>
    <MasterTrack>
      <DeviceChain>
        <Mixer>
          <Tempo><Manual Value="140.0"/></Tempo>
        </Mixer>
      </DeviceChain>
    </MasterTrack>
    <Tracks>
      <MidiTrack Id="0">
        <Name><EffectiveName Value="Synth"/></Name>
        <DeviceChain>
          <Mixer>
            <Volume><Manual Value="0.85"/></Volume>
            <Pan><Manual Value="0.0"/></Pan>
            <Speaker><Manual Value="true"/></Speaker>
          </Mixer>
          <DeviceChain><Devices/></DeviceChain>
        </DeviceChain>
        <MidiClip>
          <Name Value="Clip 1"/>
          <CurrentStart Value="0"/>
          <CurrentEnd Value="8"/>
          <Notes>
            <KeyTrack>
              <MidiKey Value="60"/>
              <Notes>
                <MidiNoteEvent Time="0" Velocity="100" Duration="1.0" IsEnabled="true"/>
              </Notes>
            </KeyTrack>
          </Notes>
        </MidiClip>
      </MidiTrack>
    </Tracks>
    <Locators>
      <Locators>
        <Locator><Time Value="0"/><Name Value="Intro"/></Locator>
        <Locator><Time Value="64"/><Name Value="Drop"/></Locator>
      </Locators>
    </Locators>
  </LiveSet>
</Ableton>"""
    path = tmp_path / "test.als"
    with gzip.open(str(path), "wb") as f:
        f.write(xml)
    return path


def make_als_with_devices(tmp_path: Path) -> Path:
    """Two tracks: a synth with two devices, an FX track with none — so we can
    assert per-track device-name extraction AND the empty case."""
    xml = b"""<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="11" MinorVersion="0">
  <LiveSet>
    <MasterTrack>
      <DeviceChain><Mixer><Tempo><Manual Value="128.0"/></Tempo></Mixer></DeviceChain>
    </MasterTrack>
    <Tracks>
      <MidiTrack Id="0">
        <Name><EffectiveName Value="TRITON Pad"/></Name>
        <DeviceChain>
          <Mixer>
            <Volume><Manual Value="0.85"/></Volume>
            <Speaker><Manual Value="true"/></Speaker>
          </Mixer>
          <DeviceChain>
            <Devices>
              <AutoFilter><IsOn><Manual Value="true"/></IsOn></AutoFilter>
              <Reverb><IsOn><Manual Value="true"/></IsOn></Reverb>
            </Devices>
          </DeviceChain>
        </DeviceChain>
      </MidiTrack>
      <AudioTrack Id="1">
        <Name><EffectiveName Value="FX Riser"/></Name>
        <DeviceChain>
          <Mixer>
            <Volume><Manual Value="0.85"/></Volume>
            <Speaker><Manual Value="true"/></Speaker>
          </Mixer>
          <DeviceChain><Devices/></DeviceChain>
        </DeviceChain>
      </AudioTrack>
    </Tracks>
  </LiveSet>
</Ableton>"""
    path = tmp_path / "devices.als"
    with gzip.open(str(path), "wb") as f:
        f.write(xml)
    return path


def test_analyze_als_emits_per_track_device_names(tmp_path):
    """AC (a): phase8 track summaries now carry the per-track device-name list."""
    als = make_als_with_devices(tmp_path)
    tracks = analyze_als(str(als))["data"]["tracks"]
    by_name = {t["name"]: t for t in tracks}

    assert "devices" in by_name["TRITON Pad"]
    assert by_name["TRITON Pad"]["devices"] == ["Auto Filter", "Reverb"]
    assert by_name["TRITON Pad"]["device_count"] == 2
    # Empty chain → empty list, not a missing key (authoritative-map consumers
    # can rely on the key always being present).
    assert by_name["FX Riser"]["devices"] == []


def test_minimal_fixture_track_has_devices_key(tmp_path):
    """Even with no devices, every track entry carries a `devices` list."""
    als = make_minimal_als(tmp_path)
    tracks = analyze_als(str(als))["data"]["tracks"]
    assert all("devices" in t and isinstance(t["devices"], list) for t in tracks)


def test_analyze_als_returns_phase_result(tmp_path):
    als = make_minimal_als(tmp_path)
    result = analyze_als(str(als))
    assert result["phase"] == 8
    assert result["name"] == "ALS Analysis"
    assert result["status"] == "ok"
    assert result["error"] is None


def test_analyze_als_data_shape(tmp_path):
    als = make_minimal_als(tmp_path)
    result = analyze_als(str(als))
    data = result["data"]
    assert "health_score" in data
    assert "grade" in data
    assert "tempo" in data
    assert "tracks" in data
    assert "midi" in data
    assert "arrangement" in data
    # Aggregate signals surfaced for downstream verdicts/coach
    assert "plugin_list" in data
    assert "has_humanized_midi" in data
    assert "quantization_issues_count" in data
    assert "total_chord_count" in data
    assert "midi_note_count" in data
    assert "audio_clip_count" in data
    assert "total_duration_seconds" in data


def test_analyze_als_aggregate_signals_for_minimal_fixture(tmp_path):
    """Fixture is 1 MIDI track, 1 clip, 1 note (velocity 100, on-grid), 0 plugins, 0 audio clips."""
    als = make_minimal_als(tmp_path)
    data = analyze_als(str(als))["data"]
    assert data["plugin_list"] == []
    assert data["has_humanized_midi"] is False  # single velocity → robotic
    assert data["quantization_issues_count"] == 0  # note at beat 0 is on-grid
    assert data["total_chord_count"] == 0  # need 3+ simultaneous notes
    assert data["midi_note_count"] == 1
    assert data["audio_clip_count"] == 0
    # 8 beats at 140 BPM = 8/140*60 ≈ 3.43s
    assert data["total_duration_seconds"] == pytest.approx(3.43, abs=0.01)


def test_analyze_als_tempo(tmp_path):
    als = make_minimal_als(tmp_path)
    result = analyze_als(str(als))
    assert result["data"]["tempo"] == pytest.approx(140.0)


def test_analyze_als_midi_stats(tmp_path):
    als = make_minimal_als(tmp_path)
    result = analyze_als(str(als))
    midi = result["data"]["midi"]
    assert midi["total_clips"] == 1
    assert midi["total_notes"] == 1
    assert midi["empty_clips"] == 0


def test_analyze_als_arrangement_sections(tmp_path):
    als = make_minimal_als(tmp_path)
    result = analyze_als(str(als))
    arrangement = result["data"]["arrangement"]
    assert arrangement["has_markers"] is True
    assert arrangement["total_sections"] == 2
    section_names = [s["name"] for s in arrangement["sections"]]
    assert "Intro" in section_names


def test_analyze_als_none_returns_skipped():
    result = analyze_als(None)
    assert result["phase"] == 8
    assert result["status"] == "skipped"
    assert result["data"] == {}


def test_analyze_als_bad_file_returns_failed(tmp_path):
    bad_file = tmp_path / "bad.als"
    bad_file.write_bytes(b"not a gzip file")
    result = analyze_als(str(bad_file))
    assert result["phase"] == 8
    assert result["status"] == "failed"
    assert result["error"] is not None
