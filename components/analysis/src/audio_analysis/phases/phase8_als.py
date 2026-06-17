from typing import Optional
from audio_analysis.als.als_parser import ALSParser
from audio_analysis.als.midi_analyzer import MIDIAnalyzer
from audio_analysis.als.health_scorer import score_health


def analyze_als(als_path: Optional[str]) -> dict:
    if als_path is None:
        return {"phase": 8, "name": "ALS Analysis", "status": "skipped", "data": {}, "error": None}

    try:
        parser = ALSParser()
        project = parser.parse(als_path)

        midi_analyzer = MIDIAnalyzer()
        midi_result = midi_analyzer.analyze(project)

        health = score_health(project)

        tracks = [
            {
                "name": t.name,
                "type": t.track_type,
                "device_count": t.device_count,
                "disabled_count": t.disabled_count,
                "muted": t.muted,
                # Per-track device names — the authoritative track→devices map the
                # verdict layer grounds track/device-specific advice on.
                "devices": list(t.devices),
            }
            for t in health.track_summaries
        ]

        midi_issues = [
            {
                "track": issue.track_name,
                "clip": issue.clip_name,
                "type": issue.issue_type,
                "severity": issue.severity,
                "description": issue.description,
                "fix": issue.fix_suggestion,
            }
            for issue in midi_result.clip_issues
        ] + [
            {
                "track": issue.track_name,
                "clip": None,
                "type": issue.issue_type,
                "severity": issue.severity,
                "description": issue.description,
                "fix": issue.fix_suggestion,
            }
            for issue in midi_result.track_issues
        ]

        arrangement: dict = {"has_markers": False, "total_sections": 0, "sections": [], "pattern": None}
        if midi_result.arrangement:
            arr = midi_result.arrangement
            arrangement = {
                "has_markers": arr.has_arrangement_markers,
                "total_sections": arr.total_sections,
                "pattern": arr.suggested_structure,
                "sections": [
                    {
                        "name": s.name,
                        "start_beat": s.start_beat,
                        "end_beat": s.end_beat,
                        "duration_bars": round(s.duration_bars, 1),
                    }
                    for s in arr.sections
                ],
            }

        data = {
            "health_score": health.score,
            "grade": health.grade,
            "tempo": project.tempo,
            "ableton_version": project.ableton_version,
            "time_signature": f"{project.time_signature_numerator}/{project.time_signature_denominator}",
            "total_devices": health.total_devices,
            "disabled_devices": health.disabled_devices,
            "clutter_pct": health.clutter_pct,
            "plugin_list": project.plugin_list,
            "has_humanized_midi": project.has_humanized_midi,
            "quantization_issues_count": project.quantization_issues_count,
            "total_chord_count": project.total_chord_count,
            "midi_note_count": project.midi_note_count,
            "audio_clip_count": project.audio_clip_count,
            "total_duration_seconds": round(project.total_duration_seconds, 2),
            "tracks": tracks,
            "midi": {
                "total_clips": midi_result.total_midi_clips,
                "total_notes": midi_result.total_notes,
                "empty_clips": midi_result.total_empty_clips,
                "short_clips": midi_result.total_short_clips,
                "duplicate_clips": midi_result.total_duplicate_clips,
                "tracks_without_content": midi_result.tracks_without_content,
                "issues": midi_issues,
            },
            "arrangement": arrangement,
        }

        return {"phase": 8, "name": "ALS Analysis", "status": "ok", "data": data, "error": None}

    except Exception as exc:
        return {"phase": 8, "name": "ALS Analysis", "status": "failed", "data": {}, "error": str(exc)}
