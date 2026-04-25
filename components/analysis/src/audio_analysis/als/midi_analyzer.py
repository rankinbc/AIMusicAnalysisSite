"""
MIDI and Arrangement Analyzer Module

Analyzes MIDI data in Ableton Live Sets for:
- Empty clips (clips with no notes)
- Very short clips (< 1 beat duration)
- Duplicate clips (same notes in different clips)
- Empty tracks (tracks with no content)
- Arrangement structure from locators/markers

Integrates with als_parser.py to provide detailed MIDI analysis.
"""

from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple
from hashlib import md5

from audio_analysis.als.als_parser import (
    ALSProject, Track, MIDIClip, Locator,
    MIDIAnalysis, ALSParser
)


# ==================== DATA CLASSES ====================


@dataclass
class ClipIssue:
    """An issue detected with a MIDI clip."""
    track_name: str
    clip_name: str
    issue_type: str  # 'empty', 'very_short', 'duplicate', 'low_velocity', 'quantization'
    severity: str  # 'warning', 'suggestion'
    description: str
    fix_suggestion: str
    clip_start: float = 0.0  # Position in beats
    clip_duration: float = 0.0


@dataclass
class TrackIssue:
    """An issue detected with a track."""
    track_name: str
    issue_type: str  # 'no_content', 'all_clips_empty', 'all_clips_muted'
    severity: str  # 'warning', 'suggestion'
    description: str
    fix_suggestion: str


@dataclass
class ArrangementSection:
    """A section of the arrangement between locators."""
    name: str
    start_beat: float
    end_beat: float
    duration_beats: float
    duration_bars: float  # Calculated based on time signature


@dataclass
class ArrangementAnalysis:
    """Analysis of the arrangement structure."""
    locators: List[Locator]
    sections: List[ArrangementSection]
    has_arrangement_markers: bool
    total_sections: int
    suggested_structure: Optional[str] = None  # 'verse-chorus', 'intro-buildup-drop', etc.


@dataclass
class MIDIClipStats:
    """Statistics for a single MIDI clip."""
    clip_name: str
    track_name: str
    note_count: int
    duration_beats: float
    is_empty: bool
    is_very_short: bool  # < 1 beat
    unique_pitches: int
    velocity_range: Tuple[int, int]  # (min, max)
    average_velocity: float
    note_hash: str  # Hash for duplicate detection


@dataclass
class MIDITrackStats:
    """Statistics for MIDI content on a track."""
    track_name: str
    track_type: str
    total_clips: int
    total_notes: int
    empty_clips: int
    short_clips: int
    has_content: bool
    clip_stats: List[MIDIClipStats] = field(default_factory=list)


@dataclass
class MIDIAnalysisResult:
    """Complete MIDI analysis result for a project."""
    # Summary stats
    total_midi_tracks: int
    total_midi_clips: int
    total_notes: int
    total_empty_clips: int
    total_short_clips: int
    total_duplicate_clips: int
    tracks_without_content: int

    # Detailed data
    track_stats: List[MIDITrackStats]
    clip_issues: List[ClipIssue]
    track_issues: List[TrackIssue]
    duplicate_groups: List[List[Tuple[str, str]]]  # Groups of (track_name, clip_name)

    # Arrangement
    arrangement: Optional[ArrangementAnalysis]

    # From als_parser analysis
    per_track_analysis: Dict[str, MIDIAnalysis] = field(default_factory=dict)


# ==================== ANALYZER CLASS ====================


class MIDIAnalyzer:
    """Analyzes MIDI content and arrangement in Ableton projects."""

    # Thresholds
    SHORT_CLIP_THRESHOLD = 1.0  # Clips shorter than 1 beat are "very short"
    VERY_SHORT_CLIP_THRESHOLD = 0.25  # Clips shorter than 1/4 beat are likely errors
    LOW_VELOCITY_THRESHOLD = 30  # Velocity below this is flagged
    MIN_NOTES_FOR_DUPLICATE = 3  # Clips need at least this many notes to be considered duplicates

    def __init__(self, verbose: bool = False):
        self.verbose = verbose

    def analyze(self, project: ALSProject) -> MIDIAnalysisResult:
        """
        Analyze MIDI content in an Ableton project.

        Args:
            project: Parsed ALSProject from als_parser

        Returns:
            MIDIAnalysisResult with complete analysis
        """
        track_stats = []
        clip_issues = []
        track_issues = []
        all_clip_hashes: Dict[str, List[Tuple[str, str]]] = {}  # hash -> [(track, clip)]

        total_notes = 0
        total_clips = 0
        total_empty = 0
        total_short = 0
        tracks_without_content = 0

        # Analyze each track
        for track in project.tracks:
            if track.track_type == 'midi':
                stats, issues, hashes = self._analyze_midi_track(track, project.tempo)
                track_stats.append(stats)
                clip_issues.extend(issues)

                # Aggregate clip hashes for duplicate detection
                for clip_hash, track_name, clip_name in hashes:
                    if clip_hash not in all_clip_hashes:
                        all_clip_hashes[clip_hash] = []
                    all_clip_hashes[clip_hash].append((track_name, clip_name))

                total_notes += stats.total_notes
                total_clips += stats.total_clips
                total_empty += stats.empty_clips
                total_short += stats.short_clips

                # Check for tracks without content
                if not stats.has_content:
                    tracks_without_content += 1
                    track_issues.append(TrackIssue(
                        track_name=track.track_name if hasattr(track, 'track_name') else track.name,
                        issue_type='no_content',
                        severity='suggestion',
                        description=f"Track '{track.name}' has no MIDI content",
                        fix_suggestion="Add MIDI content or delete the track to reduce clutter"
                    ))

        # Find duplicate clips (same notes in multiple clips)
        duplicate_groups = []
        total_duplicates = 0
        for clip_hash, locations in all_clip_hashes.items():
            if len(locations) > 1:
                duplicate_groups.append(locations)
                total_duplicates += len(locations) - 1  # -1 because one is the "original"

                # Create issues for duplicates
                for track_name, clip_name in locations[1:]:  # Skip first (original)
                    clip_issues.append(ClipIssue(
                        track_name=track_name,
                        clip_name=clip_name,
                        issue_type='duplicate',
                        severity='suggestion',
                        description=f"Clip '{clip_name}' has identical notes to another clip",
                        fix_suggestion="Consider consolidating duplicate clips or using linked clips"
                    ))

        # Analyze arrangement structure
        arrangement = self._analyze_arrangement(project)

        return MIDIAnalysisResult(
            total_midi_tracks=len([t for t in project.tracks if t.track_type == 'midi']),
            total_midi_clips=total_clips,
            total_notes=total_notes,
            total_empty_clips=total_empty,
            total_short_clips=total_short,
            total_duplicate_clips=total_duplicates,
            tracks_without_content=tracks_without_content,
            track_stats=track_stats,
            clip_issues=clip_issues,
            track_issues=track_issues,
            duplicate_groups=duplicate_groups,
            arrangement=arrangement,
            per_track_analysis=project.midi_analysis
        )

    def _analyze_midi_track(
        self,
        track: Track,
        tempo: float
    ) -> Tuple[MIDITrackStats, List[ClipIssue], List[Tuple[str, str, str]]]:
        """
        Analyze a single MIDI track.

        Returns:
            Tuple of (track_stats, issues, clip_hashes)
            clip_hashes is list of (hash, track_name, clip_name)
        """
        issues = []
        clip_stats_list = []
        clip_hashes = []

        total_notes = 0
        empty_clips = 0
        short_clips = 0

        for clip in track.midi_clips:
            clip_stat = self._analyze_clip(clip, track.name)
            clip_stats_list.append(clip_stat)

            total_notes += clip_stat.note_count

            # Track issues
            if clip_stat.is_empty:
                empty_clips += 1
                issues.append(ClipIssue(
                    track_name=track.name,
                    clip_name=clip.name,
                    issue_type='empty',
                    severity='warning',
                    description=f"Empty MIDI clip '{clip.name}' on track '{track.name}'",
                    fix_suggestion="Delete empty clips or add MIDI content",
                    clip_start=clip.start_time,
                    clip_duration=clip.end_time - clip.start_time
                ))
            elif clip_stat.is_very_short:
                short_clips += 1
                issues.append(ClipIssue(
                    track_name=track.name,
                    clip_name=clip.name,
                    issue_type='very_short',
                    severity='suggestion',
                    description=f"Very short clip '{clip.name}' ({clip_stat.duration_beats:.2f} beats)",
                    fix_suggestion="Extend the clip or consolidate with adjacent clips",
                    clip_start=clip.start_time,
                    clip_duration=clip_stat.duration_beats
                ))

            # Check for low velocity
            if clip_stat.note_count > 0 and clip_stat.average_velocity < self.LOW_VELOCITY_THRESHOLD:
                issues.append(ClipIssue(
                    track_name=track.name,
                    clip_name=clip.name,
                    issue_type='low_velocity',
                    severity='suggestion',
                    description=f"Low average velocity ({clip_stat.average_velocity:.0f}) in '{clip.name}'",
                    fix_suggestion="Consider increasing velocities for better dynamics"
                ))

            # Collect hash for duplicate detection
            if clip_stat.note_count >= self.MIN_NOTES_FOR_DUPLICATE:
                clip_hashes.append((clip_stat.note_hash, track.name, clip.name))

        has_content = total_notes > 0

        return (
            MIDITrackStats(
                track_name=track.name,
                track_type=track.track_type,
                total_clips=len(track.midi_clips),
                total_notes=total_notes,
                empty_clips=empty_clips,
                short_clips=short_clips,
                has_content=has_content,
                clip_stats=clip_stats_list
            ),
            issues,
            clip_hashes
        )

    def _analyze_clip(self, clip: MIDIClip, track_name: str) -> MIDIClipStats:
        """Analyze a single MIDI clip and return stats."""
        notes = [n for n in clip.notes if not n.mute]
        note_count = len(notes)
        duration = clip.end_time - clip.start_time

        # Calculate stats
        if note_count > 0:
            velocities = [n.velocity for n in notes]
            pitches = set(n.pitch for n in notes)
            vel_min = min(velocities)
            vel_max = max(velocities)
            avg_vel = sum(velocities) / len(velocities)

            # Create hash for duplicate detection
            # Hash based on sorted (pitch, relative_time, duration, velocity)
            note_data = sorted([
                (n.pitch, round(n.start_time, 3), round(n.duration, 3), n.velocity)
                for n in notes
            ])
            note_hash = md5(str(note_data).encode()).hexdigest()
        else:
            pitches = set()
            vel_min = 0
            vel_max = 0
            avg_vel = 0.0
            note_hash = "empty"

        return MIDIClipStats(
            clip_name=clip.name,
            track_name=track_name,
            note_count=note_count,
            duration_beats=duration,
            is_empty=note_count == 0,
            is_very_short=duration < self.SHORT_CLIP_THRESHOLD,
            unique_pitches=len(pitches),
            velocity_range=(vel_min, vel_max),
            average_velocity=avg_vel,
            note_hash=note_hash
        )

    def _analyze_arrangement(self, project: ALSProject) -> ArrangementAnalysis:
        """Analyze the arrangement structure from locators."""
        locators = []
        if project.project_structure:
            locators = project.project_structure.locators

        if not locators:
            return ArrangementAnalysis(
                locators=[],
                sections=[],
                has_arrangement_markers=False,
                total_sections=0,
                suggested_structure=None
            )

        # Sort locators by time
        sorted_locators = sorted(locators, key=lambda loc: loc.time)

        # Create sections between locators
        sections = []
        time_sig = project.time_signature_numerator

        for i in range(len(sorted_locators)):
            start = sorted_locators[i].time
            name = sorted_locators[i].name

            # End is next locator or end of project
            if i + 1 < len(sorted_locators):
                end = sorted_locators[i + 1].time
            else:
                end = project.total_duration_beats

            duration_beats = end - start
            duration_bars = duration_beats / time_sig

            sections.append(ArrangementSection(
                name=name,
                start_beat=start,
                end_beat=end,
                duration_beats=duration_beats,
                duration_bars=duration_bars
            ))

        # Try to detect arrangement structure
        suggested = self._detect_structure_pattern(sections)

        return ArrangementAnalysis(
            locators=sorted_locators,
            sections=sections,
            has_arrangement_markers=True,
            total_sections=len(sections),
            suggested_structure=suggested
        )

    def _detect_structure_pattern(self, sections: List[ArrangementSection]) -> Optional[str]:
        """Try to detect common arrangement patterns from section names."""
        if not sections:
            return None

        names_lower = [s.name.lower() for s in sections]

        # Common trance/EDM patterns
        edm_keywords = {'intro', 'buildup', 'build', 'drop', 'breakdown', 'outro'}
        has_edm = any(any(kw in name for kw in edm_keywords) for name in names_lower)

        # Common song patterns
        song_keywords = {'verse', 'chorus', 'bridge', 'pre-chorus', 'prechorus', 'hook'}
        has_song = any(any(kw in name for kw in song_keywords) for name in names_lower)

        if has_edm:
            return 'intro-buildup-drop'
        elif has_song:
            return 'verse-chorus'
        elif len(sections) >= 3:
            return 'sectioned'

        return None


# ==================== HELPER FUNCTIONS ====================


def analyze_midi(als_path: str, verbose: bool = False) -> MIDIAnalysisResult:
    """
    Quick function to analyze MIDI in an ALS file.

    Args:
        als_path: Path to the .als file
        verbose: Enable verbose output

    Returns:
        MIDIAnalysisResult with complete analysis
    """
    parser = ALSParser(verbose=verbose)
    project = parser.parse(als_path)

    analyzer = MIDIAnalyzer(verbose=verbose)
    return analyzer.analyze(project)


def get_midi_issues(analysis: MIDIAnalysisResult) -> List[Dict]:
    """
    Convert MIDI analysis issues to a standard issue format.

    Returns issues compatible with ScanResultIssue format.
    """
    issues = []

    # Clip issues
    for issue in analysis.clip_issues:
        issues.append({
            'track_name': issue.track_name,
            'severity': issue.severity,
            'category': 'midi_' + issue.issue_type,
            'description': issue.description,
            'fix_suggestion': issue.fix_suggestion
        })

    # Track issues
    for issue in analysis.track_issues:
        issues.append({
            'track_name': issue.track_name,
            'severity': issue.severity,
            'category': 'midi_' + issue.issue_type,
            'description': issue.description,
            'fix_suggestion': issue.fix_suggestion
        })

    return issues
