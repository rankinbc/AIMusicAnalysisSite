"""Audio-content classifier + grouped/per-stem analyzers (bulk-stem upload)."""
from audio_analysis.stems import analyze_grouped, analyze_per_stem, classify_stems
from audio_analysis.stems.types import StemProposal, StemRole


def test_classify_stems_separates_roles_by_content(synth_stem_files):
    # Content-only (rename-agnostic): the classifier must separate the four roles
    # from their sound alone, not their filenames.
    order = ["kick", "bass", "hats", "vocals"]
    props = classify_stems([synth_stem_files[r] for r in order])
    assert all(isinstance(p, StemProposal) for p in props)
    assert props[0].role == StemRole.KICK
    assert props[1].role == StemRole.BASS
    assert props[2].role == StemRole.HATS
    assert props[3].role == StemRole.VOCALS
    assert all(p.confidence > 0 for p in props)
    assert all("spectral" in p.evidence for p in props)


def test_classify_missing_file_is_other_not_raise(tmp_path):
    props = classify_stems([tmp_path / "nope.wav"])
    assert props[0].role == StemRole.OTHER
    assert props[0].confidence == 0.0


def test_analyze_grouped_handles_multiple_stems_per_role(synth_stem_files):
    groups = {
        StemRole.KICK: [synth_stem_files["kick"]],
        StemRole.DRUMS: [synth_stem_files["kick"], synth_stem_files["hats"]],  # summed bus
        StemRole.BASS: [synth_stem_files["bass"]],
    }
    res = analyze_grouped(groups)
    assert set(res.per_stem.keys()) == {StemRole.KICK, StemRole.DRUMS, StemRole.BASS}
    assert res.per_stem[StemRole.DRUMS].duration_s > 0


def test_analyze_per_stem_lists_each_stem(synth_stem_files):
    stems = [
        ("kick1", StemRole.KICK, synth_stem_files["kick"]),
        ("bass1", StemRole.BASS, synth_stem_files["bass"]),
        ("hats1", StemRole.HATS, synth_stem_files["hats"]),
    ]
    out = analyze_per_stem(stems)
    assert out["stem_count"] == 3
    assert {row["id"] for row in out["per_stem_list"]} == {"kick1", "bass1", "hats1"}
    assert out["truncated"] is False
