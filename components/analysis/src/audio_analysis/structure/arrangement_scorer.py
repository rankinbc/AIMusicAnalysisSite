"""
Arrangement Scorer Module

Scores song arrangement against trance genre conventions, producing a 0-100 score
with specific issues and actionable suggestions.

Usage:
    from audio_analysis.structure.arrangement_scorer import ArrangementScorer
    from audio_analysis.structure.phase1_adapter import adapt

    structure = adapt(phase1_structure_dict, bpm=128.0, duration_seconds=180.0)
    scorer = ArrangementScorer()
    score = scorer.score(structure)

    print(f"Arrangement Score: {score.overall_score}/100 ({score.grade})")
"""

from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple, Any
from enum import Enum
import json

from audio_analysis.structure.models import StructureResult, Section, SectionType


class IssueSeverity(Enum):
    """Severity levels for arrangement issues."""
    CRITICAL = "CRITICAL"
    WARNING = "WARNING"
    SUGGESTION = "SUGGESTION"


@dataclass
class SectionScore:
    """Score and issues for a single section."""
    section_type: str           # intro, buildup, drop, breakdown, outro, unknown
    start_time: float           # Start time in seconds
    end_time: float             # End time in seconds
    duration_bars: int          # Duration in bars
    length_score: float         # 0-100 score for length compliance
    eight_bar_compliant: bool   # Is divisible by 8?
    issues: List[str]           # List of issues for this section

    @property
    def duration_seconds(self) -> float:
        return self.end_time - self.start_time

    @property
    def time_range_formatted(self) -> str:
        """Format time range as MM:SS-MM:SS."""
        start_mins = int(self.start_time // 60)
        start_secs = int(self.start_time % 60)
        end_mins = int(self.end_time // 60)
        end_secs = int(self.end_time % 60)
        return f"{start_mins}:{start_secs:02d}-{end_mins}:{end_secs:02d}"


@dataclass
class ArrangementIssue:
    """A specific arrangement issue with fix suggestion."""
    severity: IssueSeverity
    message: str
    section: Optional[str]      # Which section this applies to (or None for global)
    fix: str                    # Actionable fix suggestion

    def to_dict(self) -> Dict:
        return {
            "severity": self.severity.value,
            "message": self.message,
            "section": self.section,
            "fix": self.fix
        }


@dataclass
class ArrangementScore:
    """Complete arrangement scoring result."""
    # Overall score and grade
    overall_score: float        # 0-100 weighted score
    grade: str                  # A/B/C/D/F

    # Component scores (0-100 each)
    structure_score: float      # Has expected sections?
    length_score: float         # Section lengths correct?
    eight_bar_score: float      # Divisible by 8?
    energy_contrast_score: float  # Drop vs breakdown contrast
    flow_score: float           # Logical progression?

    # Detailed breakdown
    component_scores: Dict[str, float] = field(default_factory=dict)
    section_scores: List[SectionScore] = field(default_factory=list)
    issues: List[ArrangementIssue] = field(default_factory=list)
    suggestions: List[str] = field(default_factory=list)

    # Metadata
    total_bars: int = 0
    section_count: int = 0
    detected_tempo: float = 0.0

    # Section presence
    has_intro: bool = False
    has_buildup: bool = False
    has_drop: bool = False
    has_breakdown: bool = False
    has_outro: bool = False

    # Energy metrics
    drop_energy_db: Optional[float] = None
    breakdown_energy_db: Optional[float] = None
    energy_contrast_db: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        # Calculate total duration from sections
        total_duration = 0.0
        if self.section_scores:
            total_duration = max(s.end_time for s in self.section_scores)

        return {
            "overall_score": round(self.overall_score, 1),
            "grade": self.grade,
            "total_duration": round(total_duration, 2),
            "component_scores": {k: round(v, 1) for k, v in self.component_scores.items()},
            "structure_score": round(self.structure_score, 1),
            "length_score": round(self.length_score, 1),
            "eight_bar_score": round(self.eight_bar_score, 1),
            "energy_contrast_score": round(self.energy_contrast_score, 1),
            "flow_score": round(self.flow_score, 1),
            "section_scores": [
                {
                    "section_type": s.section_type,
                    "start_time": round(s.start_time, 2),
                    "end_time": round(s.end_time, 2),
                    "duration": round(s.duration_seconds, 2),
                    "bars": s.duration_bars,
                    "score": round(s.length_score, 1),
                    "time_range": s.time_range_formatted,
                    "eight_bar_compliant": s.eight_bar_compliant,
                    "checks": [
                        {"name": "Length OK", "passed": s.length_score >= 70},
                        {"name": "8-bar rule", "passed": s.eight_bar_compliant}
                    ],
                    "issues": s.issues
                }
                for s in self.section_scores
            ],
            "issues": [
                {
                    "severity": i.severity.value,
                    "message": i.message,
                    "section": i.section,
                    "fix_suggestion": i.fix
                }
                for i in self.issues
            ],
            "suggestions": self.suggestions,
            "metadata": {
                "total_bars": self.total_bars,
                "section_count": self.section_count,
                "detected_tempo": round(self.detected_tempo, 1) if self.detected_tempo else None,
                "has_intro": self.has_intro,
                "has_buildup": self.has_buildup,
                "has_drop": self.has_drop,
                "has_breakdown": self.has_breakdown,
                "has_outro": self.has_outro,
                "energy_contrast_db": round(self.energy_contrast_db, 1) if self.energy_contrast_db else None
            }
        }

    def to_json(self, indent: int = 2) -> str:
        """Convert to JSON string."""
        return json.dumps(self.to_dict(), indent=indent)


class ArrangementScorer:
    """
    Scores arrangement structure against trance genre conventions.

    The scorer evaluates:
    1. Structure: Does the track have expected sections (intro, drop, breakdown, outro)?
    2. Length: Are section lengths within acceptable ranges?
    3. Eight-bar rule: Are all sections divisible by 8 bars?
    4. Energy contrast: Is there sufficient contrast between drops and breakdowns?
    5. Flow: Does energy progress logically through the track?
    """

    # Default weights (can be overridden by config)
    DEFAULT_WEIGHTS = {
        'structure': 0.25,
        'length': 0.20,
        'eight_bar': 0.15,
        'energy_contrast': 0.25,
        'flow': 0.15,
    }

    # Default section length conventions (in bars)
    DEFAULT_SECTION_LENGTHS = {
        'intro': {'min': 16, 'max': 64, 'standard': 32},
        'buildup': {'min': 8, 'max': 32, 'standard': 16},
        'drop': {'min': 16, 'max': 64, 'standard': 32},
        'breakdown': {'min': 16, 'max': 64, 'standard': 32},
        'outro': {'min': 16, 'max': 64, 'standard': 32},
    }

    # Default grade thresholds
    DEFAULT_GRADES = {
        'A': 85,
        'B': 70,
        'C': 55,
        'D': 40,
    }

    def __init__(self, config=None):
        """
        Initialize the arrangement scorer.

        Args:
            config: Optional configuration (dict or AnalyzerConfig object).
                   Looks for 'trance_arrangement' key with custom settings.
        """
        # Handle both dict and AnalyzerConfig types
        arr_config = {}
        if config is not None:
            # Try to get trance_arrangement section
            if hasattr(config, '__getitem__'):
                # Works for both dict and AnalyzerConfig (via __getitem__)
                try:
                    arr_config = config['trance_arrangement'] or {}
                except (KeyError, TypeError):
                    arr_config = {}
            elif isinstance(config, dict):
                arr_config = config.get('trance_arrangement', {})

        # Helper to safely get nested values
        def get_config(d, key, default):
            if isinstance(d, dict):
                return d.get(key, default)
            return default

        # Load weights
        self.weights = get_config(arr_config, 'weights', self.DEFAULT_WEIGHTS)

        # Load section length conventions
        self.section_lengths = get_config(arr_config, 'section_lengths', self.DEFAULT_SECTION_LENGTHS)

        # Load grade thresholds
        self.grades = get_config(arr_config, 'grades', self.DEFAULT_GRADES)

        # Load other settings
        self.bar_multiple = get_config(arr_config, 'bar_multiple', 8)
        self.required_sections = get_config(arr_config, 'required_sections',
                                             ['intro', 'drop', 'breakdown', 'outro'])
        self.preferred_sections = get_config(arr_config, 'preferred_sections', ['buildup'])

        # Energy contrast settings
        energy_config = get_config(arr_config, 'energy_contrast', {})
        self.contrast_min_db = get_config(energy_config, 'drop_vs_breakdown_min_db', 6.0)
        self.contrast_target_db = get_config(energy_config, 'drop_vs_breakdown_target_db', 10.0)

        # Severity thresholds
        severity_config = get_config(arr_config, 'severity', {})
        self.contrast_critical_db = get_config(severity_config, 'contrast_critical_db', 3.0)
        self.contrast_warning_db = get_config(severity_config, 'contrast_warning_db', 6.0)
        self.length_way_off_multiplier = get_config(severity_config, 'length_way_off_multiplier', 2.0)
        self.eight_bar_penalty = get_config(severity_config, 'eight_bar_violation_penalty', 15)

    def score(self, structure: StructureResult) -> ArrangementScore:
        """
        Score the arrangement structure against trance conventions.

        Args:
            structure: StructureResult from StructureDetector.detect()

        Returns:
            ArrangementScore with overall score, component scores, and issues
        """
        if getattr(structure, "deferred", False):
            return self._pending_score()

        if not getattr(structure, "available", True):
            return self._unavailable_score(
                structure.error_message or "Structure detection unavailable"
            )

        if not structure.success or not structure.sections:
            return self._empty_score("Structure detection failed or no sections found")

        sections = structure.sections

        # Calculate component scores
        structure_score, structure_issues = self._score_structure(sections)
        length_score, length_issues, section_scores = self._score_lengths(sections, structure.tempo_bpm)
        eight_bar_score, eight_bar_issues = self._score_eight_bar_rule(sections)
        energy_contrast_score, energy_issues, energy_metrics = self._score_energy_contrast(sections)
        flow_score, flow_issues = self._score_flow(sections)

        # Combine all issues
        all_issues = structure_issues + length_issues + eight_bar_issues + energy_issues + flow_issues

        # Sort issues by severity
        all_issues.sort(key=lambda x: 0 if x.severity == IssueSeverity.CRITICAL
                                       else 1 if x.severity == IssueSeverity.WARNING
                                       else 2)

        # Calculate weighted overall score
        overall_score = (
            self.weights['structure'] * structure_score +
            self.weights['length'] * length_score +
            self.weights['eight_bar'] * eight_bar_score +
            self.weights['energy_contrast'] * energy_contrast_score +
            self.weights['flow'] * flow_score
        )

        # Clamp to 0-100
        overall_score = max(0, min(100, overall_score))

        # Determine grade
        grade = self._get_grade(overall_score)

        # Generate suggestions
        suggestions = self._generate_suggestions(
            structure_score, length_score, eight_bar_score,
            energy_contrast_score, flow_score, sections
        )

        # Determine section presence
        section_types = {s.section_type for s in sections}

        return ArrangementScore(
            overall_score=overall_score,
            grade=grade,
            structure_score=structure_score,
            length_score=length_score,
            eight_bar_score=eight_bar_score,
            energy_contrast_score=energy_contrast_score,
            flow_score=flow_score,
            component_scores={
                'structure': structure_score,
                'length': length_score,
                'eight_bar': eight_bar_score,
                'energy_contrast': energy_contrast_score,
                'flow': flow_score,
            },
            section_scores=section_scores,
            issues=all_issues,
            suggestions=suggestions,
            total_bars=structure.total_bars,
            section_count=len(sections),
            detected_tempo=structure.tempo_bpm,
            has_intro=SectionType.INTRO in section_types,
            has_buildup=SectionType.BUILDUP in section_types,
            has_drop=SectionType.DROP in section_types,
            has_breakdown=SectionType.BREAKDOWN in section_types,
            has_outro=SectionType.OUTRO in section_types,
            drop_energy_db=energy_metrics.get('drop_energy_db'),
            breakdown_energy_db=energy_metrics.get('breakdown_energy_db'),
            energy_contrast_db=energy_metrics.get('contrast_db'),
        )

    def _empty_score(self, reason: str) -> ArrangementScore:
        """Return an empty score when analysis fails."""
        return ArrangementScore(
            overall_score=0,
            grade="F",
            structure_score=0,
            length_score=0,
            eight_bar_score=0,
            energy_contrast_score=0,
            flow_score=0,
            issues=[ArrangementIssue(
                severity=IssueSeverity.CRITICAL,
                message=reason,
                section=None,
                fix="Ensure audio file is valid and long enough for structure detection"
            )],
        )

    def _pending_score(self) -> ArrangementScore:
        """Return a 'pending' score while structure detection runs in the
        background. Grade ``"…"`` signals to the UI that the real arrangement
        score is still coming (not a failure, not a final 'not assessed')."""
        return ArrangementScore(
            overall_score=0,
            grade="…",
            structure_score=0,
            length_score=0,
            eight_bar_score=0,
            energy_contrast_score=0,
            flow_score=0,
            issues=[ArrangementIssue(
                severity=IssueSeverity.SUGGESTION,
                message="Arrangement analysis in progress — structure detection is "
                        "running in the background.",
                section=None,
                fix="",
            )],
        )

    def _unavailable_score(self, reason: str) -> ArrangementScore:
        """Return a 'not assessed' score when structure detection couldn't run.

        Distinct from :meth:`_empty_score`: this is a tooling limitation (Docker
        / the allin1 image isn't set up), NOT a flaw in the track. Grade is
        ``"N/A"`` and the single issue is informational, so the arrangement
        isn't punished with a failing grade and a critical "fix your track"
        message it didn't earn.
        """
        return ArrangementScore(
            overall_score=0,
            grade="N/A",
            structure_score=0,
            length_score=0,
            eight_bar_score=0,
            energy_contrast_score=0,
            flow_score=0,
            issues=[ArrangementIssue(
                severity=IssueSeverity.SUGGESTION,
                message=f"Arrangement not assessed — {reason}",
                section=None,
                fix="Build the allin1 Docker image (docker build -t allin1:latest "
                    "docker/allin1) and ensure Docker is running to enable "
                    "arrangement analysis."
            )],
        )

    def _score_structure(self, sections: List[Section]) -> Tuple[float, List[ArrangementIssue]]:
        """
        Score based on presence of expected sections.

        Returns:
            Tuple of (score 0-100, list of issues)
        """
        issues = []
        score = 0

        # Get section types present
        section_types = {s.section_type for s in sections}

        # Points for required sections
        points_per_required = 100 / len(self.required_sections) if self.required_sections else 25

        for req_section in self.required_sections:
            section_enum = self._str_to_section_type(req_section)
            if section_enum in section_types:
                score += points_per_required
            else:
                issues.append(ArrangementIssue(
                    severity=IssueSeverity.WARNING,
                    message=f"Missing {req_section} section",
                    section=None,
                    fix=f"Add a clear {req_section} section to complete the trance structure"
                ))

        # Bonus for preferred sections (up to 10% bonus)
        for pref_section in self.preferred_sections:
            section_enum = self._str_to_section_type(pref_section)
            if section_enum in section_types:
                score = min(100, score + 5)  # Small bonus

        # Check for buildup before drop
        drops = [s for s in sections if s.section_type == SectionType.DROP]
        buildups = [s for s in sections if s.section_type == SectionType.BUILDUP]

        if drops and not buildups:
            issues.append(ArrangementIssue(
                severity=IssueSeverity.SUGGESTION,
                message="No buildup detected before drops",
                section="drop",
                fix="Add a 16-bar buildup section before each drop for maximum impact"
            ))

        return score, issues

    def _score_lengths(self, sections: List[Section], tempo_bpm: float
                       ) -> Tuple[float, List[ArrangementIssue], List[SectionScore]]:
        """
        Score based on section lengths matching conventions.

        Returns:
            Tuple of (score 0-100, list of issues, list of SectionScore)
        """
        issues = []
        section_scores = []
        total_score = 0
        scored_sections = 0

        for section in sections:
            section_type_str = section.section_type.value

            # Get conventions for this section type
            conventions = self.section_lengths.get(section_type_str)

            if conventions is None:
                # Unknown section type - give neutral score
                section_scores.append(SectionScore(
                    section_type=section_type_str,
                    start_time=section.start_time,
                    end_time=section.end_time,
                    duration_bars=section.duration_bars,
                    length_score=50,
                    eight_bar_compliant=section.duration_bars % self.bar_multiple == 0,
                    issues=[]
                ))
                continue

            min_bars = conventions['min']
            max_bars = conventions['max']
            standard_bars = conventions['standard']
            duration_bars = section.duration_bars

            # Calculate score
            section_issues = []

            if min_bars <= duration_bars <= max_bars:
                # Within acceptable range
                # Score based on how close to standard
                deviation = abs(duration_bars - standard_bars)
                max_deviation = max(standard_bars - min_bars, max_bars - standard_bars)

                if max_deviation > 0:
                    closeness = 1 - (deviation / max_deviation)
                    length_section_score = 70 + (30 * closeness)  # 70-100
                else:
                    length_section_score = 100
            elif duration_bars < min_bars:
                # Too short
                shortfall = min_bars - duration_bars
                if shortfall > min_bars * 0.5:  # Way too short
                    length_section_score = 20
                    issues.append(ArrangementIssue(
                        severity=IssueSeverity.CRITICAL,
                        message=f"{section_type_str.title()} at {section.time_range_formatted} is only {duration_bars} bars (min: {min_bars})",
                        section=section_type_str,
                        fix=f"Extend to at least {min_bars} bars, ideally {standard_bars} bars"
                    ))
                else:
                    length_section_score = 40
                    issues.append(ArrangementIssue(
                        severity=IssueSeverity.WARNING,
                        message=f"{section_type_str.title()} is {duration_bars} bars (recommended: {min_bars}-{max_bars})",
                        section=section_type_str,
                        fix=f"Consider extending to {standard_bars} bars for better DJ compatibility"
                    ))
                section_issues.append(f"Too short ({duration_bars} vs min {min_bars})")
            else:
                # Too long
                excess = duration_bars - max_bars
                if excess > max_bars * 0.5:  # Way too long
                    length_section_score = 30
                    issues.append(ArrangementIssue(
                        severity=IssueSeverity.WARNING,
                        message=f"{section_type_str.title()} is {duration_bars} bars (max recommended: {max_bars})",
                        section=section_type_str,
                        fix=f"Consider shortening to {standard_bars} bars to maintain energy"
                    ))
                else:
                    length_section_score = 50
                    issues.append(ArrangementIssue(
                        severity=IssueSeverity.SUGGESTION,
                        message=f"{section_type_str.title()} is slightly long at {duration_bars} bars",
                        section=section_type_str,
                        fix=f"Standard length is {standard_bars} bars"
                    ))
                section_issues.append(f"Long ({duration_bars} vs max {max_bars})")

            section_scores.append(SectionScore(
                section_type=section_type_str,
                start_time=section.start_time,
                end_time=section.end_time,
                duration_bars=duration_bars,
                length_score=length_section_score,
                eight_bar_compliant=duration_bars % self.bar_multiple == 0,
                issues=section_issues
            ))

            total_score += length_section_score
            scored_sections += 1

        # Average score across sections
        final_score = total_score / scored_sections if scored_sections > 0 else 0

        return final_score, issues, section_scores

    def _score_eight_bar_rule(self, sections: List[Section]) -> Tuple[float, List[ArrangementIssue]]:
        """
        Score based on all sections being divisible by 8 bars.

        Returns:
            Tuple of (score 0-100, list of issues)
        """
        issues = []
        violations = 0

        for section in sections:
            if section.duration_bars > 0 and section.duration_bars % self.bar_multiple != 0:
                violations += 1
                issues.append(ArrangementIssue(
                    severity=IssueSeverity.WARNING,
                    message=f"{section.section_type.value.title()} at {section.time_range_formatted} is {section.duration_bars} bars (not divisible by {self.bar_multiple})",
                    section=section.section_type.value,
                    fix=f"Adjust to {self._nearest_multiple(section.duration_bars, self.bar_multiple)} bars"
                ))

        # Calculate score
        if len(sections) == 0:
            return 0, issues

        compliant = len(sections) - violations
        score = (compliant / len(sections)) * 100

        # Apply penalties for violations
        penalty = violations * self.eight_bar_penalty
        score = max(0, score - penalty)

        return score, issues

    def _score_energy_contrast(self, sections: List[Section]
                                ) -> Tuple[float, List[ArrangementIssue], Dict]:
        """
        Score based on energy contrast between drops and breakdowns.

        Returns:
            Tuple of (score 0-100, list of issues, energy metrics dict)
        """
        issues = []
        metrics = {}

        # Find drops and breakdowns
        drops = [s for s in sections if s.section_type == SectionType.DROP]
        breakdowns = [s for s in sections if s.section_type == SectionType.BREAKDOWN]

        if not drops or not breakdowns:
            # Can't calculate contrast without both
            if drops and not breakdowns:
                issues.append(ArrangementIssue(
                    severity=IssueSeverity.WARNING,
                    message="No breakdown detected - can't calculate energy contrast",
                    section=None,
                    fix="Add a breakdown section (remove kick, filter bass, reduce track count)"
                ))
            return 50, issues, metrics  # Neutral score

        # Use confidence as proxy for energy (higher confidence = clearer section = better energy)
        # In real implementation, would use RMS from section audio
        # For now, we'll use a simplified approach based on section detection confidence

        # Get average "energy" (using confidence as proxy)
        drop_confidence = sum(d.confidence for d in drops) / len(drops)
        breakdown_confidence = sum(b.confidence for b in breakdowns) / len(breakdowns)

        # Convert confidence difference to pseudo-dB (0-1 confidence -> 0-20 dB range)
        # In production, this would use actual RMS values
        metrics['drop_energy_db'] = -10 - (1 - drop_confidence) * 10  # Proxy RMS
        metrics['breakdown_energy_db'] = -20 - (1 - breakdown_confidence) * 10  # Proxy RMS
        metrics['contrast_db'] = abs(metrics['drop_energy_db'] - metrics['breakdown_energy_db'])

        contrast_db = metrics['contrast_db']

        # Score based on contrast
        if contrast_db >= self.contrast_target_db:
            score = 100
        elif contrast_db >= self.contrast_min_db:
            # Linear interpolation between min and target
            score = 70 + ((contrast_db - self.contrast_min_db) /
                         (self.contrast_target_db - self.contrast_min_db)) * 30
        elif contrast_db >= self.contrast_critical_db:
            score = 40 + ((contrast_db - self.contrast_critical_db) /
                         (self.contrast_min_db - self.contrast_critical_db)) * 30
            issues.append(ArrangementIssue(
                severity=IssueSeverity.WARNING,
                message=f"Energy contrast is {contrast_db:.1f}dB (target: {self.contrast_target_db}dB)",
                section="drop",
                fix="Remove more elements from breakdown (mute kick, filter bass) to increase contrast"
            ))
        else:
            score = contrast_db / self.contrast_critical_db * 40
            issues.append(ArrangementIssue(
                severity=IssueSeverity.CRITICAL,
                message=f"Drop has weak impact - only {contrast_db:.1f}dB contrast with breakdown",
                section="drop",
                fix="Strip breakdown to bare essentials: pads + melody only. Mute kick, filter bass at 200Hz"
            ))

        return score, issues, metrics

    def _score_flow(self, sections: List[Section]) -> Tuple[float, List[ArrangementIssue]]:
        """
        Score based on logical energy flow through the track.

        Returns:
            Tuple of (score 0-100, list of issues)
        """
        issues = []
        score = 100

        if len(sections) < 2:
            return 50, issues  # Can't evaluate flow with < 2 sections

        # Check for logical transitions
        for i in range(len(sections) - 1):
            current = sections[i]
            next_section = sections[i + 1]

            current_type = current.section_type
            next_type = next_section.section_type

            # Expected transitions in trance:
            # intro -> buildup or verse
            # buildup -> drop
            # drop -> breakdown
            # breakdown -> buildup or outro
            # outro (terminal)

            good_transitions = {
                SectionType.INTRO: [SectionType.BUILDUP, SectionType.BREAKDOWN, SectionType.DROP],
                SectionType.BUILDUP: [SectionType.DROP],
                SectionType.DROP: [SectionType.BREAKDOWN, SectionType.BUILDUP, SectionType.OUTRO],
                SectionType.BREAKDOWN: [SectionType.BUILDUP, SectionType.DROP, SectionType.OUTRO],
                SectionType.OUTRO: [],  # Terminal
            }

            expected = good_transitions.get(current_type, [])

            if next_type not in expected and expected:
                # Unexpected transition
                score -= 10
                issues.append(ArrangementIssue(
                    severity=IssueSeverity.SUGGESTION,
                    message=f"Unusual transition: {current_type.value} -> {next_type.value}",
                    section=current_type.value,
                    fix=f"Consider adding a {expected[0].value if expected else 'buildup'} between these sections"
                ))

        # Check for buildup before drops
        for i, section in enumerate(sections):
            if section.section_type == SectionType.DROP:
                if i > 0 and sections[i-1].section_type != SectionType.BUILDUP:
                    score -= 15
                    issues.append(ArrangementIssue(
                        severity=IssueSeverity.WARNING,
                        message=f"Drop at {section.time_range_formatted} has no buildup",
                        section="drop",
                        fix="Add a 16-bar buildup before the drop with rising snare rolls and filtered elements"
                    ))

        # Ensure score stays in range
        score = max(0, min(100, score))

        return score, issues

    def _generate_suggestions(self, structure_score: float, length_score: float,
                              eight_bar_score: float, energy_contrast_score: float,
                              flow_score: float, sections: List[Section]) -> List[str]:
        """Generate prioritized suggestions based on scores."""
        suggestions = []

        # Find weakest component
        scores = {
            'structure': structure_score,
            'length': length_score,
            'eight_bar': eight_bar_score,
            'energy_contrast': energy_contrast_score,
            'flow': flow_score,
        }

        weakest = min(scores, key=scores.get)

        if scores[weakest] < 70:
            if weakest == 'structure':
                suggestions.append("Focus on adding missing sections (intro, drop, breakdown, outro)")
            elif weakest == 'length':
                suggestions.append("Adjust section lengths to match trance conventions (32-bar sections)")
            elif weakest == 'eight_bar':
                suggestions.append("Ensure all sections are divisible by 8 bars for DJ mixing")
            elif weakest == 'energy_contrast':
                suggestions.append("Increase contrast by stripping breakdowns (remove kick, filter bass)")
            elif weakest == 'flow':
                suggestions.append("Add buildups before drops and ensure logical section progression")

        # Track-specific suggestions
        section_types = {s.section_type for s in sections}

        if SectionType.BUILDUP not in section_types:
            suggestions.append("Add 16-bar buildups with rising snare rolls before each drop")

        if len([s for s in sections if s.section_type == SectionType.DROP]) < 2:
            suggestions.append("Consider adding a second drop for extended mix versions")

        return suggestions

    def _get_grade(self, score: float) -> str:
        """Convert numeric score to letter grade."""
        if score >= self.grades['A']:
            return 'A'
        elif score >= self.grades['B']:
            return 'B'
        elif score >= self.grades['C']:
            return 'C'
        elif score >= self.grades['D']:
            return 'D'
        else:
            return 'F'

    def _nearest_multiple(self, value: int, multiple: int) -> int:
        """Find the nearest multiple of a number."""
        lower = (value // multiple) * multiple
        upper = lower + multiple
        if value - lower < upper - value:
            return lower if lower > 0 else multiple
        return upper

    def _str_to_section_type(self, section_str: str) -> SectionType:
        """Convert string to SectionType enum."""
        mapping = {
            'intro': SectionType.INTRO,
            'buildup': SectionType.BUILDUP,
            'drop': SectionType.DROP,
            'breakdown': SectionType.BREAKDOWN,
            'outro': SectionType.OUTRO,
        }
        return mapping.get(section_str.lower(), SectionType.UNKNOWN)


def score_arrangement(structure: StructureResult, config: Optional[Dict] = None) -> ArrangementScore:
    """
    Convenience function to score arrangement.

    Args:
        structure: StructureResult from structure detection
        config: Optional configuration dict

    Returns:
        ArrangementScore with full analysis
    """
    scorer = ArrangementScorer(config=config)
    return scorer.score(structure)
