"""
Spatial Analyzer

Analyzes spatial characteristics including:
- 3D spatial perception (height, depth, width consistency)
- Surround compatibility (mono compatibility, phase coherence)
- Playback optimization (headphone/speaker scores)

Based on ai-music-mix-analyzer implementation, adapted for AbletonAIAnalysis.
"""

import numpy as np
import librosa
from dataclasses import dataclass, field
from typing import List


@dataclass
class SpatialInfo:
    """3D spatial perception analysis results."""
    height_score: float             # 0-100 (vertical perception from high frequencies)
    depth_score: float              # 0-100 (front-to-back perception)
    width_consistency: float        # 0-100 (stereo image stability over time)
    analysis: List[str] = field(default_factory=list)


@dataclass
class SurroundInfo:
    """Surround compatibility analysis results."""
    mono_compatibility: float       # 0-100 (how well mix translates to mono)
    phase_score: float              # 0-100 (phase coherence)
    is_atmos_ready: bool            # Whether mix is suitable for spatial audio
    analysis: List[str] = field(default_factory=list)


@dataclass
class PlaybackInfo:
    """Playback optimization analysis results."""
    headphone_score: float          # 0-100 (headphone listening quality)
    speaker_score: float            # 0-100 (speaker translation quality)
    crossfeed_safe: bool            # Whether extreme stereo is present
    bass_translation: str           # 'good', 'weak', 'excessive'
    analysis: List[str] = field(default_factory=list)


class SpatialAnalyzer:
    """
    Analyzes spatial characteristics of audio files.

    Provides three analysis modes:
    - 3D spatial: Height, depth, and width consistency perception
    - Surround: Mono compatibility and phase coherence
    - Playback: Headphone and speaker optimization
    """

    def __init__(self, config=None):
        """
        Initialize the spatial analyzer.

        Args:
            config: Optional configuration object with spatial analysis settings
        """
        self.config = config

        # Load settings from config or use defaults
        if config:
            if hasattr(config, 'spatial'):
                spatial_cfg = config.spatial
                self.good_height_range = spatial_cfg.get('good_height_range', [30, 70])
                self.good_depth_range = spatial_cfg.get('good_depth_range', [30, 70])
                self.width_consistency_threshold = spatial_cfg.get('width_consistency_threshold', 70)
            else:
                self._set_defaults()

            if hasattr(config, 'surround'):
                surround_cfg = config.surround
                self.mono_safe_threshold = surround_cfg.get('mono_safe_threshold', 70)
                self.phase_safe_threshold = surround_cfg.get('phase_safe_threshold', 60)
            else:
                self.mono_safe_threshold = 70
                self.phase_safe_threshold = 60

            if hasattr(config, 'playback'):
                playback_cfg = config.playback
                self.crossfeed_factor = playback_cfg.get('headphone_crossfeed_factor', 0.4)
                self.bass_threshold = playback_cfg.get('speaker_bass_threshold', 100)
            else:
                self.crossfeed_factor = 0.4
                self.bass_threshold = 100
        else:
            self._set_defaults()

    def _set_defaults(self):
        """Set default configuration values."""
        self.good_height_range = [30, 70]
        self.good_depth_range = [30, 70]
        self.width_consistency_threshold = 70
        self.mono_safe_threshold = 70
        self.phase_safe_threshold = 60
        self.crossfeed_factor = 0.4
        self.bass_threshold = 100

    def analyze_3d(self, y: np.ndarray, sr: int) -> SpatialInfo:
        """
        Analyze 3D spatial perception characteristics.

        Args:
            y: Audio time series (mono or stereo)
            sr: Sample rate

        Returns:
            SpatialInfo with height, depth, and width consistency scores
        """
        analysis = []

        # Ensure stereo for spatial analysis
        if len(y.shape) == 1:
            y = np.vstack([y, y])  # Duplicate mono to stereo
            analysis.append("Mono audio - limited 3D spatial analysis available")

        left = y[0] if len(y.shape) > 1 else y
        right = y[1] if len(y.shape) > 1 and y.shape[0] > 1 else y

        # Calculate height score (based on high frequency energy)
        height_score = self._calculate_height_score(left, right, sr)

        # Calculate depth score (based on dynamics and reverb characteristics)
        depth_score = self._calculate_depth_score(left, right, sr)

        # Calculate width consistency (stereo correlation stability over time)
        width_consistency = self._calculate_width_consistency(left, right, sr)

        # Generate analysis
        if height_score < self.good_height_range[0]:
            analysis.append(f"Low height perception ({height_score:.0f}%) - add presence/air frequencies for more vertical dimension")
        elif height_score > self.good_height_range[1]:
            analysis.append(f"High frequency emphasis ({height_score:.0f}%) - mix may sound thin or harsh")
        else:
            analysis.append(f"Good height perception ({height_score:.0f}%)")

        if depth_score < self.good_depth_range[0]:
            analysis.append(f"Flat depth perception ({depth_score:.0f}%) - consider adding reverb/delay for depth")
        elif depth_score > self.good_depth_range[1]:
            analysis.append(f"Deep/washy mix ({depth_score:.0f}%) - may benefit from less reverb")
        else:
            analysis.append(f"Good depth perception ({depth_score:.0f}%)")

        if width_consistency < self.width_consistency_threshold:
            analysis.append(f"Unstable stereo image ({width_consistency:.0f}%) - stereo width varies significantly")
        else:
            analysis.append(f"Stable stereo image ({width_consistency:.0f}%)")

        return SpatialInfo(
            height_score=height_score,
            depth_score=depth_score,
            width_consistency=width_consistency,
            analysis=analysis
        )

    def analyze_surround(self, y: np.ndarray, sr: int) -> SurroundInfo:
        """
        Analyze surround and mono compatibility.

        Args:
            y: Audio time series (mono or stereo)
            sr: Sample rate

        Returns:
            SurroundInfo with mono compatibility and phase scores
        """
        analysis = []

        # Handle mono input
        if len(y.shape) == 1:
            return SurroundInfo(
                mono_compatibility=100.0,
                phase_score=100.0,
                is_atmos_ready=True,
                analysis=["Mono audio - perfect mono compatibility"]
            )

        left = y[0]
        right = y[1] if y.shape[0] > 1 else y[0]

        # Calculate mono compatibility
        mono_compatibility = self._calculate_mono_compatibility(left, right)

        # Calculate phase score
        phase_score = self._calculate_phase_score(left, right)

        # Determine Atmos readiness
        is_atmos_ready = mono_compatibility >= 60 and phase_score >= 50

        # Generate analysis
        if mono_compatibility < 40:
            analysis.append(f"CRITICAL: Poor mono compatibility ({mono_compatibility:.0f}%) - mix will collapse in mono playback")
        elif mono_compatibility < self.mono_safe_threshold:
            analysis.append(f"Moderate mono compatibility ({mono_compatibility:.0f}%) - some elements may cancel in mono")
        else:
            analysis.append(f"Good mono compatibility ({mono_compatibility:.0f}%)")

        if phase_score < 30:
            analysis.append(f"CRITICAL: Phase issues detected ({phase_score:.0f}%) - check for inverted channels or stereo widening")
        elif phase_score < self.phase_safe_threshold:
            analysis.append(f"Phase concerns ({phase_score:.0f}%) - some phase cancellation present")
        else:
            analysis.append(f"Good phase coherence ({phase_score:.0f}%)")

        if is_atmos_ready:
            analysis.append("Mix is suitable for spatial audio formats (Atmos, Sony 360)")
        else:
            analysis.append("Mix may have issues in spatial audio formats - improve mono compatibility first")

        return SurroundInfo(
            mono_compatibility=mono_compatibility,
            phase_score=phase_score,
            is_atmos_ready=is_atmos_ready,
            analysis=analysis
        )

    def analyze_playback(self, y: np.ndarray, sr: int) -> PlaybackInfo:
        """
        Analyze playback optimization for headphones and speakers.

        Args:
            y: Audio time series (mono or stereo)
            sr: Sample rate

        Returns:
            PlaybackInfo with headphone/speaker scores and recommendations
        """
        analysis = []

        # Handle mono input
        if len(y.shape) == 1:
            y = np.vstack([y, y])

        left = y[0]
        right = y[1] if y.shape[0] > 1 else y[0]

        # Calculate headphone score (crossfeed simulation)
        headphone_score, crossfeed_safe = self._calculate_headphone_score(left, right)

        # Calculate speaker score (bass management)
        speaker_score, bass_translation = self._calculate_speaker_score(y, sr)

        # Generate analysis
        if headphone_score < 50:
            analysis.append(f"Headphone concerns ({headphone_score:.0f}%) - extreme stereo separation may cause fatigue")
        elif headphone_score < 70:
            analysis.append(f"Moderate headphone compatibility ({headphone_score:.0f}%)")
        else:
            analysis.append(f"Good headphone compatibility ({headphone_score:.0f}%)")

        if not crossfeed_safe:
            analysis.append("Wide stereo elements may cause disorientation on headphones")

        if speaker_score < 50:
            analysis.append(f"Poor speaker translation ({speaker_score:.0f}%) - bass may not translate to small speakers")
        elif speaker_score < 70:
            analysis.append(f"Moderate speaker translation ({speaker_score:.0f}%)")
        else:
            analysis.append(f"Good speaker translation ({speaker_score:.0f}%)")

        if bass_translation == 'weak':
            analysis.append("Bass may be inaudible on laptop/phone speakers")
        elif bass_translation == 'excessive':
            analysis.append("Excessive low frequencies may overwhelm small speakers")
        else:
            analysis.append("Bass translation should work across most playback systems")

        return PlaybackInfo(
            headphone_score=headphone_score,
            speaker_score=speaker_score,
            crossfeed_safe=crossfeed_safe,
            bass_translation=bass_translation,
            analysis=analysis
        )

    def _calculate_height_score(self, left: np.ndarray, right: np.ndarray, sr: int) -> float:
        """
        Calculate height perception score based on high frequency content.

        Higher frequencies are psychoacoustically perceived as "higher" in space.
        """
        try:
            # Combine to mono for frequency analysis
            mono = (left + right) / 2

            # Calculate spectral centroid
            centroid = librosa.feature.spectral_centroid(y=mono, sr=sr)
            avg_centroid = np.mean(centroid)

            # Also check high frequency energy
            D = np.abs(librosa.stft(mono))
            freqs = librosa.fft_frequencies(sr=sr)

            # High frequency range (>8kHz)
            high_mask = freqs > 8000
            if np.any(high_mask):
                high_energy = np.sum(D[high_mask, :] ** 2)
                total_energy = np.sum(D ** 2)
                high_ratio = high_energy / (total_energy + 1e-10)
            else:
                high_ratio = 0

            # Combine centroid and high ratio for height score
            # Normalize centroid to 0-100 (typical range 1000-5000 Hz)
            centroid_score = min(100, max(0, (avg_centroid - 1000) / 40))

            # High ratio contributes to height
            high_score = min(100, high_ratio * 500)

            height_score = centroid_score * 0.6 + high_score * 0.4

            return float(min(100, max(0, height_score)))

        except Exception:
            return 50.0

    def _calculate_depth_score(self, left: np.ndarray, right: np.ndarray, sr: int) -> float:
        """
        Calculate depth perception score based on dynamics and reverb characteristics.

        Lower correlation + dynamic variation suggests more depth.
        """
        try:
            # Calculate correlation
            correlation = np.corrcoef(left, right)[0, 1]

            # Calculate RMS variation (dynamic range proxy)
            mono = (left + right) / 2
            rms = librosa.feature.rms(y=mono)[0]
            rms_std = np.std(rms) / (np.mean(rms) + 1e-10)

            # Lower correlation = more depth potential
            correlation_depth = (1 - abs(correlation)) * 50

            # Higher RMS variation = more depth
            dynamics_depth = min(50, rms_std * 200)

            depth_score = correlation_depth + dynamics_depth

            return float(min(100, max(0, depth_score)))

        except Exception:
            return 50.0

    def _calculate_width_consistency(self, left: np.ndarray, right: np.ndarray, sr: int) -> float:
        """
        Calculate stereo width consistency over time.

        Measures how stable the stereo image is throughout the track.
        """
        try:
            # Calculate windowed correlation
            window_size = int(sr * 2)  # 2-second windows
            hop_size = int(sr * 0.5)   # 500ms hop

            correlations = []
            for start in range(0, len(left) - window_size, hop_size):
                end = start + window_size
                window_left = left[start:end]
                window_right = right[start:end]

                corr = np.corrcoef(window_left, window_right)[0, 1]
                correlations.append(corr)

            if len(correlations) < 2:
                return 100.0

            # Calculate consistency as inverse of standard deviation
            corr_std = np.std(correlations)

            # Lower std = more consistent
            # Typical std range: 0.0 (perfectly consistent) to 0.3 (very inconsistent)
            consistency = max(0, 100 - corr_std * 300)

            return float(consistency)

        except Exception:
            return 75.0

    def _calculate_mono_compatibility(self, left: np.ndarray, right: np.ndarray) -> float:
        """
        Calculate mono compatibility score.

        Simulates mono summing and checks for energy loss.
        """
        try:
            # Create mono sum
            mono = (left + right) / 2

            # Calculate energies
            stereo_energy = np.sum(left ** 2) + np.sum(right ** 2)
            mono_energy = np.sum(mono ** 2) * 2  # Scale for comparison

            # Ratio of preserved energy
            if stereo_energy > 0:
                preservation_ratio = mono_energy / stereo_energy
            else:
                return 100.0

            # Also check correlation
            correlation = np.corrcoef(left, right)[0, 1]

            # Combine preservation and correlation
            preservation_score = min(100, preservation_ratio * 100)
            correlation_score = max(0, min(100, (correlation + 1) * 50))

            mono_compatibility = preservation_score * 0.4 + correlation_score * 0.6

            return float(mono_compatibility)

        except Exception:
            return 75.0

    def _calculate_phase_score(self, left: np.ndarray, right: np.ndarray) -> float:
        """
        Calculate phase coherence score.

        Detects potential phase cancellation issues.
        """
        try:
            # Calculate correlation
            correlation = np.corrcoef(left, right)[0, 1]

            # Negative correlation = phase issues
            if correlation < 0:
                phase_score = max(0, (correlation + 1) * 50)  # 0-50 for negative correlation
            else:
                phase_score = 50 + correlation * 50  # 50-100 for positive correlation

            return float(phase_score)

        except Exception:
            return 75.0

    def _calculate_headphone_score(self, left: np.ndarray, right: np.ndarray) -> tuple:
        """
        Calculate headphone listening score.

        Simulates crossfeed effect to detect extreme stereo.

        Returns:
            Tuple of (score, crossfeed_safe)
        """
        try:
            # Apply crossfeed
            crossfed_left = left * (1 - self.crossfeed_factor) + right * self.crossfeed_factor
            crossfed_right = right * (1 - self.crossfeed_factor) + left * self.crossfeed_factor

            # Correlate original with crossfed
            left_corr = np.corrcoef(left, crossfed_left)[0, 1]
            right_corr = np.corrcoef(right, crossfed_right)[0, 1]

            avg_corr = (left_corr + right_corr) / 2

            # Higher correlation = better headphone compatibility
            headphone_score = max(0, min(100, avg_corr * 100))

            # Check for extreme stereo (low correlation between L/R)
            lr_corr = np.corrcoef(left, right)[0, 1]
            crossfeed_safe = lr_corr > -0.3

            return (float(headphone_score), crossfeed_safe)

        except Exception:
            return (75.0, True)

    def _calculate_speaker_score(self, y: np.ndarray, sr: int) -> tuple:
        """
        Calculate speaker translation score.

        Focuses on bass management for small speakers.

        Returns:
            Tuple of (score, bass_translation)
        """
        try:
            # Get mono for frequency analysis
            if len(y.shape) > 1:
                mono = librosa.to_mono(y)
            else:
                mono = y

            # Calculate bass energy
            D = np.abs(librosa.stft(mono))
            freqs = librosa.fft_frequencies(sr=sr)

            # Sub-bass (<60Hz) - won't translate to small speakers
            sub_mask = freqs < 60
            # Bass (60-200Hz) - limited on small speakers
            bass_mask = (freqs >= 60) & (freqs < 200)
            # Mid-bass (200-400Hz) - better translation
            midbass_mask = (freqs >= 200) & (freqs < 400)

            total_energy = np.sum(D ** 2)

            if total_energy > 0:
                sub_ratio = np.sum(D[sub_mask, :] ** 2) / total_energy if np.any(sub_mask) else 0
                bass_ratio = np.sum(D[bass_mask, :] ** 2) / total_energy if np.any(bass_mask) else 0
                midbass_ratio = np.sum(D[midbass_mask, :] ** 2) / total_energy if np.any(midbass_mask) else 0
            else:
                return (75.0, 'good')

            # Score based on bass distribution
            # Ideal: not too much sub, good bass, good midbass
            sub_penalty = min(30, sub_ratio * 200)  # Penalty for excessive sub
            bass_score = min(50, bass_ratio * 150)   # Reward for audible bass
            midbass_score = min(30, midbass_ratio * 100)  # Reward for midbass

            speaker_score = 70 - sub_penalty + bass_score * 0.3 + midbass_score * 0.3

            # Determine bass translation category
            if sub_ratio + bass_ratio < 0.1:
                bass_translation = 'weak'
            elif sub_ratio > 0.15:
                bass_translation = 'excessive'
            else:
                bass_translation = 'good'

            return (float(max(0, min(100, speaker_score))), bass_translation)

        except Exception:
            return (75.0, 'good')
