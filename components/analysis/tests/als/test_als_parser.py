import gzip
from pathlib import Path
import pytest
from audio_analysis.als.als_parser import ALSParser, ALSProject
from audio_analysis.als.midi_analyzer import MIDIAnalyzer, MIDIAnalysisResult
from audio_analysis.als.health_scorer import score_health, HealthResult


def make_minimal_als(tmp_path: Path) -> Path:
    xml = b"""<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="11" MinorVersion="0">
  <LiveSet>
    <MasterTrack>
      <DeviceChain>
        <Mixer>
          <Tempo><Manual Value="138.0"/></Tempo>
          <TimeSignature>
            <Numerator><Manual Value="4"/></Numerator>
            <Denominator><Manual Value="4"/></Denominator>
          </TimeSignature>
        </Mixer>
      </DeviceChain>
    </MasterTrack>
    <Tracks>
      <MidiTrack Id="0">
        <Name><EffectiveName Value="Lead"/></Name>
        <DeviceChain>
          <Mixer>
            <Volume><Manual Value="0.85"/></Volume>
            <Pan><Manual Value="0.0"/></Pan>
            <Speaker><Manual Value="true"/></Speaker>
          </Mixer>
          <DeviceChain><Devices/></DeviceChain>
        </DeviceChain>
        <MidiClip>
          <Name Value="Lead Clip"/>
          <CurrentStart Value="0"/>
          <CurrentEnd Value="8"/>
          <Notes>
            <KeyTrack>
              <MidiKey Value="60"/>
              <Notes>
                <MidiNoteEvent Time="0" Velocity="100" Duration="0.5" IsEnabled="true"/>
                <MidiNoteEvent Time="1" Velocity="90" Duration="0.5" IsEnabled="true"/>
                <MidiNoteEvent Time="2" Velocity="95" Duration="0.5" IsEnabled="true"/>
              </Notes>
            </KeyTrack>
          </Notes>
        </MidiClip>
      </MidiTrack>
      <AudioTrack Id="1">
        <Name><EffectiveName Value="Kick"/></Name>
        <DeviceChain>
          <Mixer>
            <Volume><Manual Value="0.85"/></Volume>
            <Pan><Manual Value="0.0"/></Pan>
            <Speaker><Manual Value="true"/></Speaker>
          </Mixer>
          <DeviceChain><Devices/></DeviceChain>
        </DeviceChain>
      </AudioTrack>
    </Tracks>
    <Locators>
      <Locators>
        <Locator><Time Value="0"/><Name Value="Intro"/></Locator>
        <Locator><Time Value="64"/><Name Value="Drop"/></Locator>
        <Locator><Time Value="128"/><Name Value="Breakdown"/></Locator>
        <Locator><Time Value="192"/><Name Value="Outro"/></Locator>
      </Locators>
    </Locators>
  </LiveSet>
</Ableton>"""
    path = tmp_path / "test.als"
    with gzip.open(str(path), "wb") as f:
        f.write(xml)
    return path


def test_parse_returns_alsproject(tmp_path):
    als = make_minimal_als(tmp_path)
    parser = ALSParser()
    project = parser.parse(str(als))
    assert isinstance(project, ALSProject)


def test_parse_extracts_tempo(tmp_path):
    als = make_minimal_als(tmp_path)
    parser = ALSParser()
    project = parser.parse(str(als))
    assert project.tempo == pytest.approx(138.0)


def test_parse_extracts_tracks(tmp_path):
    als = make_minimal_als(tmp_path)
    parser = ALSParser()
    project = parser.parse(str(als))
    track_names = [t.name for t in project.tracks]
    assert "Lead" in track_names
    assert "Kick" in track_names


def test_parse_extracts_midi_notes(tmp_path):
    als = make_minimal_als(tmp_path)
    parser = ALSParser()
    project = parser.parse(str(als))
    lead = next(t for t in project.tracks if t.name == "Lead")
    assert len(lead.midi_clips) == 1
    assert len(lead.midi_clips[0].notes) == 3


def test_parse_extracts_locators(tmp_path):
    als = make_minimal_als(tmp_path)
    parser = ALSParser()
    project = parser.parse(str(als))
    assert project.project_structure is not None
    locator_names = [loc.name for loc in project.project_structure.locators]
    assert "Intro" in locator_names
    assert "Drop" in locator_names


def test_parse_missing_file_raises():
    parser = ALSParser()
    with pytest.raises(FileNotFoundError):
        parser.parse("/nonexistent/path/test.als")


def test_midi_analyzer_returns_result(tmp_path):
    als = make_minimal_als(tmp_path)
    parser = ALSParser()
    project = parser.parse(str(als))
    analyzer = MIDIAnalyzer()
    result = analyzer.analyze(project)
    assert isinstance(result, MIDIAnalysisResult)


def test_midi_analyzer_counts_clips(tmp_path):
    als = make_minimal_als(tmp_path)
    parser = ALSParser()
    project = parser.parse(str(als))
    analyzer = MIDIAnalyzer()
    result = analyzer.analyze(project)
    assert result.total_midi_clips == 1
    assert result.total_notes == 3
    assert result.total_empty_clips == 0


def test_midi_analyzer_detects_arrangement(tmp_path):
    als = make_minimal_als(tmp_path)
    parser = ALSParser()
    project = parser.parse(str(als))
    analyzer = MIDIAnalyzer()
    result = analyzer.analyze(project)
    assert result.arrangement is not None
    assert result.arrangement.has_arrangement_markers is True
    assert result.arrangement.total_sections == 4


def test_health_scorer_returns_result(tmp_path):
    als = make_minimal_als(tmp_path)
    parser = ALSParser()
    project = parser.parse(str(als))
    result = score_health(project)
    assert isinstance(result, HealthResult)


def test_health_scorer_clean_project_scores_high(tmp_path):
    als = make_minimal_als(tmp_path)
    parser = ALSParser()
    project = parser.parse(str(als))
    result = score_health(project)
    assert result.score >= 80
    assert result.grade in ("A", "B")


def test_health_scorer_fields(tmp_path):
    als = make_minimal_als(tmp_path)
    parser = ALSParser()
    project = parser.parse(str(als))
    result = score_health(project)
    assert result.total_devices >= 0
    assert result.disabled_devices >= 0
    assert 0.0 <= result.clutter_pct <= 100.0
    assert isinstance(result.track_summaries, list)
