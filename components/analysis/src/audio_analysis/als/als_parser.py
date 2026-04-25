"""
ALS Parser Module

Parses Ableton Live Set (.als) files to extract:
- Project tempo and time signature
- Track information (names, types, colors)
- MIDI clip data
- Audio clip references
- Device/plugin information

Ableton .als files are gzipped XML documents.
"""

import gzip
import xml.etree.ElementTree as ET
from pathlib import Path
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple
import math
import base64
import struct


@dataclass
class MIDINote:
    """Represents a single MIDI note."""
    pitch: int  # 0-127
    velocity: int  # 0-127
    start_time: float  # In beats
    duration: float  # In beats
    mute: bool = False


@dataclass
class MIDIClip:
    """Represents a MIDI clip."""
    name: str
    start_time: float  # Position in arrangement (beats)
    end_time: float
    loop_start: float
    loop_end: float
    notes: List[MIDINote] = field(default_factory=list)


@dataclass
class AudioClip:
    """Represents an audio clip reference."""
    name: str
    file_path: Optional[str]
    start_time: float
    end_time: float
    warp_mode: Optional[str]
    original_tempo: Optional[float]


@dataclass
class Track:
    """Represents a track in the project."""
    id: int
    name: str
    track_type: str  # 'midi', 'audio', 'return', 'master', 'group'
    color: Optional[int]
    is_muted: bool
    is_solo: bool
    volume_db: float
    pan: float  # -1 to 1
    midi_clips: List[MIDIClip] = field(default_factory=list)
    audio_clips: List[AudioClip] = field(default_factory=list)
    devices: List[str] = field(default_factory=list)


@dataclass
class QuantizationError:
    """A note that's off the grid."""
    track_name: str
    pitch: int
    time: float  # Actual position in beats
    nearest_grid: float  # Where it should be
    error_beats: float  # Distance from grid
    severity: str  # 'minor' (<0.03 beats), 'notable' (<0.1), 'severe' (>0.1)


@dataclass
class ChordEvent:
    """Simultaneous notes forming a chord."""
    time: float
    pitches: List[int]
    chord_name: Optional[str]  # 'Am', 'C', 'Gmaj7', etc.
    duration: float


@dataclass
class MIDIAnalysis:
    """Analysis results for MIDI data in a clip or track."""
    track_name: str
    note_count: int
    velocity_mean: float
    velocity_std: float
    velocity_range: Tuple[int, int]  # (min, max)
    humanization_score: str  # 'robotic', 'slightly_humanized', 'natural'
    quantization_errors: List[QuantizationError] = field(default_factory=list)
    note_density_per_bar: float = 0.0
    chord_count: int = 0
    chords: List[ChordEvent] = field(default_factory=list)
    swing_ratio: Optional[float] = None  # 0.5 = straight, 0.67 = triplet swing


@dataclass
class Locator:
    """Arrangement locator/marker."""
    time: float  # Position in beats
    name: str


@dataclass
class Scene:
    """Session View scene."""
    index: int
    name: str
    tempo: Optional[float] = None  # Scene-specific tempo


@dataclass
class TempoChange:
    """Tempo automation point."""
    time: float  # Position in beats
    tempo: float  # BPM


@dataclass
class ProjectStructure:
    """Song structure information."""
    locators: List[Locator] = field(default_factory=list)
    scenes: List[Scene] = field(default_factory=list)
    tempo_automation: List[TempoChange] = field(default_factory=list)
    has_tempo_changes: bool = False


@dataclass
class ALSProject:
    """Represents a parsed Ableton Live Set."""
    file_path: str
    ableton_version: str
    tempo: float
    time_signature_numerator: int
    time_signature_denominator: int
    tracks: List[Track]
    total_duration_beats: float
    total_duration_seconds: float
    sample_rate: int
    midi_note_count: int
    audio_clip_count: int
    plugin_list: List[str]
    # New fields for enhanced analysis
    midi_analysis: Dict[str, MIDIAnalysis] = field(default_factory=dict)  # track_name -> analysis
    project_structure: Optional[ProjectStructure] = None
    total_chord_count: int = 0
    has_humanized_midi: bool = False
    quantization_issues_count: int = 0


class ALSParser:
    """Parser for Ableton Live Set (.als) files."""

    def __init__(self, verbose: bool = False):
        self.verbose = verbose

    def parse(self, als_path: str) -> ALSProject:
        """
        Parse an Ableton .als file.

        Args:
            als_path: Path to the .als file

        Returns:
            ALSProject with all extracted information
        """
        path = Path(als_path)
        if not path.exists():
            raise FileNotFoundError(f"ALS file not found: {als_path}")

        if path.suffix.lower() != '.als':
            raise ValueError(f"Not an ALS file: {als_path}")

        # Read and decompress the file
        try:
            with gzip.open(als_path, 'rb') as f:
                xml_content = f.read()
        except gzip.BadGzipFile:
            # Some older versions might not be gzipped
            with open(als_path, 'rb') as f:
                xml_content = f.read()

        # Parse XML
        root = ET.fromstring(xml_content)

        # Extract project information
        ableton_version = self._get_version(root)
        tempo = self._get_tempo(root)
        time_sig = self._get_time_signature(root)
        sample_rate = self._get_sample_rate(root)

        # Parse tracks
        tracks = self._parse_tracks(root)

        # Calculate totals
        total_duration_beats = self._calculate_duration(tracks)
        total_duration_seconds = (total_duration_beats / tempo) * 60 if tempo > 0 else 0

        midi_note_count = sum(
            len(clip.notes)
            for track in tracks
            for clip in track.midi_clips
        )

        audio_clip_count = sum(len(track.audio_clips) for track in tracks)

        # Get plugin list
        plugins = self._get_plugins(root)

        # Parse project structure (locators, scenes, tempo automation)
        project_structure = self._parse_project_structure(root)

        # Analyze MIDI tracks
        midi_analysis: Dict[str, MIDIAnalysis] = {}
        total_chord_count = 0
        humanized_count = 0
        total_quant_errors = 0
        midi_track_count = 0

        for track in tracks:
            if track.track_type == 'midi' and track.midi_clips:
                midi_track_count += 1
                analysis = self.analyze_midi_track(
                    track,
                    time_sig_num=time_sig[0],
                    grid_resolution=0.25  # 16th notes
                )
                if analysis:
                    midi_analysis[track.name] = analysis
                    total_chord_count += analysis.chord_count
                    total_quant_errors += len(analysis.quantization_errors)
                    if analysis.humanization_score in ('slightly_humanized', 'natural'):
                        humanized_count += 1

        has_humanized = humanized_count > 0

        return ALSProject(
            file_path=str(path.absolute()),
            ableton_version=ableton_version,
            tempo=tempo,
            time_signature_numerator=time_sig[0],
            time_signature_denominator=time_sig[1],
            tracks=tracks,
            total_duration_beats=total_duration_beats,
            total_duration_seconds=total_duration_seconds,
            sample_rate=sample_rate,
            midi_note_count=midi_note_count,
            audio_clip_count=audio_clip_count,
            plugin_list=plugins,
            midi_analysis=midi_analysis,
            project_structure=project_structure,
            total_chord_count=total_chord_count,
            has_humanized_midi=has_humanized,
            quantization_issues_count=total_quant_errors
        )

    def _get_version(self, root: ET.Element) -> str:
        """Extract Ableton version from the XML."""
        # Look for version info in various places
        ableton_elem = root.find(".//Ableton")
        if ableton_elem is not None:
            major = ableton_elem.get("MajorVersion", "")
            minor = ableton_elem.get("MinorVersion", "")
            if major or minor:
                return f"{major}.{minor}"

        # Try alternative location
        for elem in root.iter():
            if "Creator" in elem.attrib:
                return elem.attrib["Creator"]

        return "Unknown"

    def _get_tempo(self, root: ET.Element) -> float:
        """Extract project tempo."""
        # Try multiple paths where tempo might be stored
        tempo_paths = [
            ".//Tempo/Manual",
            ".//MasterTrack/DeviceChain/Mixer/Tempo/Manual",
            ".//Transport/Tempo/Manual",
            ".//LiveSet/MasterTrack//Tempo/Manual"
        ]

        for path in tempo_paths:
            elem = root.find(path)
            if elem is not None and "Value" in elem.attrib:
                try:
                    return float(elem.attrib["Value"])
                except ValueError:
                    continue

        # Default tempo
        return 120.0

    def _get_time_signature(self, root: ET.Element) -> Tuple[int, int]:
        """Extract time signature."""
        numerator = 4
        denominator = 4

        # Look for time signature
        num_elem = root.find(".//TimeSignature/Numerator/Manual")
        if num_elem is not None and "Value" in num_elem.attrib:
            try:
                numerator = int(num_elem.attrib["Value"])
            except ValueError:
                pass

        denom_elem = root.find(".//TimeSignature/Denominator/Manual")
        if denom_elem is not None and "Value" in denom_elem.attrib:
            try:
                denominator = int(denom_elem.attrib["Value"])
            except ValueError:
                pass

        return (numerator, denominator)

    def _get_sample_rate(self, root: ET.Element) -> int:
        """Extract sample rate."""
        elem = root.find(".//SampleRate/Manual")
        if elem is not None and "Value" in elem.attrib:
            try:
                return int(float(elem.attrib["Value"]))
            except ValueError:
                pass
        return 44100  # Default

    def _parse_tracks(self, root: ET.Element) -> List[Track]:
        """Parse all tracks from the project."""
        tracks = []

        # Parse MIDI tracks
        for i, track_elem in enumerate(root.findall(".//MidiTrack")):
            track = self._parse_midi_track(track_elem, i)
            if track:
                tracks.append(track)

        # Parse Audio tracks
        for i, track_elem in enumerate(root.findall(".//AudioTrack")):
            track = self._parse_audio_track(track_elem, i + len(tracks))
            if track:
                tracks.append(track)

        # Parse Return tracks
        for i, track_elem in enumerate(root.findall(".//ReturnTrack")):
            track = self._parse_return_track(track_elem, i)
            if track:
                tracks.append(track)

        # Parse Group tracks
        for i, track_elem in enumerate(root.findall(".//GroupTrack")):
            track = self._parse_group_track(track_elem, i)
            if track:
                tracks.append(track)

        return tracks

    def _parse_midi_track(self, track_elem: ET.Element, index: int) -> Optional[Track]:
        """Parse a MIDI track."""
        try:
            name = self._get_track_name(track_elem, f"MIDI {index + 1}")
            color = self._get_track_color(track_elem)
            is_muted, is_solo = self._get_mute_solo(track_elem)
            volume_db, pan = self._get_volume_pan(track_elem)

            # Parse MIDI clips
            midi_clips = []
            for clip_elem in track_elem.findall(".//MidiClip"):
                clip = self._parse_midi_clip(clip_elem)
                if clip:
                    midi_clips.append(clip)

            # Get devices
            devices = self._get_track_devices(track_elem)

            return Track(
                id=index,
                name=name,
                track_type='midi',
                color=color,
                is_muted=is_muted,
                is_solo=is_solo,
                volume_db=volume_db,
                pan=pan,
                midi_clips=midi_clips,
                devices=devices
            )
        except Exception as e:
            if self.verbose:
                print(f"Error parsing MIDI track: {e}")
            return None

    def _parse_audio_track(self, track_elem: ET.Element, index: int) -> Optional[Track]:
        """Parse an Audio track."""
        try:
            name = self._get_track_name(track_elem, f"Audio {index + 1}")
            color = self._get_track_color(track_elem)
            is_muted, is_solo = self._get_mute_solo(track_elem)
            volume_db, pan = self._get_volume_pan(track_elem)

            # Parse Audio clips
            audio_clips = []
            for clip_elem in track_elem.findall(".//AudioClip"):
                clip = self._parse_audio_clip(clip_elem)
                if clip:
                    audio_clips.append(clip)

            # Get devices
            devices = self._get_track_devices(track_elem)

            return Track(
                id=index,
                name=name,
                track_type='audio',
                color=color,
                is_muted=is_muted,
                is_solo=is_solo,
                volume_db=volume_db,
                pan=pan,
                audio_clips=audio_clips,
                devices=devices
            )
        except Exception as e:
            if self.verbose:
                print(f"Error parsing Audio track: {e}")
            return None

    def _parse_return_track(self, track_elem: ET.Element, index: int) -> Optional[Track]:
        """Parse a Return track."""
        try:
            name = self._get_track_name(track_elem, f"Return {chr(65 + index)}")
            color = self._get_track_color(track_elem)
            is_muted, is_solo = self._get_mute_solo(track_elem)
            volume_db, pan = self._get_volume_pan(track_elem)
            devices = self._get_track_devices(track_elem)

            return Track(
                id=100 + index,  # Use high IDs for returns
                name=name,
                track_type='return',
                color=color,
                is_muted=is_muted,
                is_solo=is_solo,
                volume_db=volume_db,
                pan=pan,
                devices=devices
            )
        except Exception as e:
            if self.verbose:
                print(f"Error parsing Return track: {e}")
            return None

    def _parse_group_track(self, track_elem: ET.Element, index: int) -> Optional[Track]:
        """Parse a Group track."""
        try:
            name = self._get_track_name(track_elem, f"Group {index + 1}")
            color = self._get_track_color(track_elem)
            is_muted, is_solo = self._get_mute_solo(track_elem)
            volume_db, pan = self._get_volume_pan(track_elem)

            return Track(
                id=200 + index,  # Use high IDs for groups
                name=name,
                track_type='group',
                color=color,
                is_muted=is_muted,
                is_solo=is_solo,
                volume_db=volume_db,
                pan=pan
            )
        except Exception as e:
            if self.verbose:
                print(f"Error parsing Group track: {e}")
            return None

    def _get_track_name(self, track_elem: ET.Element, default: str) -> str:
        """Extract track name."""
        name_elem = track_elem.find(".//Name/EffectiveName")
        if name_elem is not None and "Value" in name_elem.attrib:
            return name_elem.attrib["Value"]

        user_name = track_elem.find(".//Name/UserName")
        if user_name is not None and "Value" in user_name.attrib:
            name = user_name.attrib["Value"]
            if name:
                return name

        return default

    def _get_track_color(self, track_elem: ET.Element) -> Optional[int]:
        """Extract track color index."""
        color_elem = track_elem.find(".//Color")
        if color_elem is not None and "Value" in color_elem.attrib:
            try:
                return int(color_elem.attrib["Value"])
            except ValueError:
                pass
        return None

    def _get_mute_solo(self, track_elem: ET.Element) -> Tuple[bool, bool]:
        """Extract mute and solo state."""
        is_muted = False
        is_solo = False

        mute_elem = track_elem.find(".//DeviceChain/Mixer/Speaker/Manual")
        if mute_elem is not None and "Value" in mute_elem.attrib:
            is_muted = mute_elem.attrib["Value"].lower() == "false"

        solo_elem = track_elem.find(".//DeviceChain/Mixer/Solo/Manual")
        if solo_elem is not None and "Value" in solo_elem.attrib:
            is_solo = solo_elem.attrib["Value"].lower() == "true"

        return (is_muted, is_solo)

    def _get_volume_pan(self, track_elem: ET.Element) -> Tuple[float, float]:
        """Extract volume and pan values."""
        volume_db = 0.0
        pan = 0.0

        vol_elem = track_elem.find(".//DeviceChain/Mixer/Volume/Manual")
        if vol_elem is not None and "Value" in vol_elem.attrib:
            try:
                # Ableton uses 0-1 scale, convert to dB
                vol_linear = float(vol_elem.attrib["Value"])
                if vol_linear > 0:
                    volume_db = 20 * (vol_linear - 0.85) / 0.15  # Approximate conversion
                else:
                    volume_db = -float('inf')
            except ValueError:
                pass

        pan_elem = track_elem.find(".//DeviceChain/Mixer/Pan/Manual")
        if pan_elem is not None and "Value" in pan_elem.attrib:
            try:
                pan = float(pan_elem.attrib["Value"])
            except ValueError:
                pass

        return (volume_db, pan)

    def _get_track_devices(self, track_elem: ET.Element) -> List[str]:
        """Extract list of devices/plugins on the track."""
        devices = []

        # Look for various device types
        device_chain = track_elem.find(".//DeviceChain/DeviceChain/Devices")
        if device_chain is None:
            device_chain = track_elem.find(".//DeviceChain/Devices")

        if device_chain is not None:
            for device in device_chain:
                # Get device name
                name = device.tag
                if name not in ['Devices']:
                    # Try to get a more specific name
                    user_name = device.find(".//UserName")
                    if user_name is not None and "Value" in user_name.attrib:
                        name = user_name.attrib["Value"] or name
                    devices.append(name)

        return devices

    def _parse_midi_clip(self, clip_elem: ET.Element) -> Optional[MIDIClip]:
        """Parse a MIDI clip and its notes."""
        try:
            name = clip_elem.find(".//Name")
            clip_name = name.attrib.get("Value", "Unnamed") if name is not None else "Unnamed"

            # Get clip position
            start = float(clip_elem.find(".//CurrentStart").attrib.get("Value", 0))
            end = float(clip_elem.find(".//CurrentEnd").attrib.get("Value", start + 4))

            loop_start = start
            loop_end = end

            loop_elem = clip_elem.find(".//Loop")
            if loop_elem is not None:
                ls = loop_elem.find("LoopStart")
                le = loop_elem.find("LoopEnd")
                if ls is not None:
                    loop_start = float(ls.attrib.get("Value", loop_start))
                if le is not None:
                    loop_end = float(le.attrib.get("Value", loop_end))

            # Parse notes
            notes = []
            notes_elem = clip_elem.find(".//Notes")
            if notes_elem is not None:
                for key_track in notes_elem.findall(".//KeyTrack"):
                    pitch_elem = key_track.find("MidiKey")
                    pitch = int(pitch_elem.attrib.get("Value", 60)) if pitch_elem is not None else 60

                    for note_elem in key_track.findall(".//MidiNoteEvent"):
                        note = MIDINote(
                            pitch=pitch,
                            velocity=int(float(note_elem.attrib.get("Velocity", 100))),
                            start_time=float(note_elem.attrib.get("Time", 0)),
                            duration=float(note_elem.attrib.get("Duration", 0.25)),
                            mute=note_elem.attrib.get("IsEnabled", "true").lower() == "false"
                        )
                        notes.append(note)

            return MIDIClip(
                name=clip_name,
                start_time=start,
                end_time=end,
                loop_start=loop_start,
                loop_end=loop_end,
                notes=notes
            )
        except Exception as e:
            if self.verbose:
                print(f"Error parsing MIDI clip: {e}")
            return None

    def _parse_audio_clip(self, clip_elem: ET.Element) -> Optional[AudioClip]:
        """Parse an audio clip reference."""
        try:
            name_elem = clip_elem.find(".//Name")
            clip_name = name_elem.attrib.get("Value", "Unnamed") if name_elem is not None else "Unnamed"

            start = float(clip_elem.find(".//CurrentStart").attrib.get("Value", 0))
            end = float(clip_elem.find(".//CurrentEnd").attrib.get("Value", start + 4))

            # Get file reference
            file_path = None
            file_ref = clip_elem.find(".//SampleRef/FileRef/Path")
            if file_ref is not None and "Value" in file_ref.attrib:
                file_path = file_ref.attrib["Value"]

            # Get warp mode
            warp_mode = None
            warp_elem = clip_elem.find(".//WarpMode")
            if warp_elem is not None and "Value" in warp_elem.attrib:
                warp_modes = {
                    "0": "Beats", "1": "Tones", "2": "Texture",
                    "3": "Re-Pitch", "4": "Complex", "6": "Complex Pro"
                }
                warp_mode = warp_modes.get(warp_elem.attrib["Value"], "Unknown")

            return AudioClip(
                name=clip_name,
                file_path=file_path,
                start_time=start,
                end_time=end,
                warp_mode=warp_mode,
                original_tempo=None
            )
        except Exception as e:
            if self.verbose:
                print(f"Error parsing audio clip: {e}")
            return None

    def _calculate_duration(self, tracks: List[Track]) -> float:
        """Calculate total project duration in beats."""
        max_end = 0.0

        for track in tracks:
            for clip in track.midi_clips:
                if clip.end_time > max_end:
                    max_end = clip.end_time

            for clip in track.audio_clips:
                if clip.end_time > max_end:
                    max_end = clip.end_time

        return max_end if max_end > 0 else 16.0  # Default 4 bars

    def _get_plugins(self, root: ET.Element) -> List[str]:
        """Get list of all plugins used in the project."""
        plugins = set()

        # Look for VST plugins
        for elem in root.iter():
            if "PluginDesc" in elem.tag or "VstPluginInfo" in elem.tag:
                name = elem.find(".//PlugName")
                if name is not None and "Value" in name.attrib:
                    plugins.add(name.attrib["Value"])

            # AU plugins
            if "AuPluginInfo" in elem.tag:
                name = elem.find(".//Name")
                if name is not None and "Value" in name.attrib:
                    plugins.add(name.attrib["Value"])

        return sorted(list(plugins))

    # ==================== MIDI ANALYSIS METHODS ====================

    def analyze_midi_track(self, track: Track, time_sig_num: int = 4,
                          grid_resolution: float = 0.25) -> Optional[MIDIAnalysis]:
        """
        Analyze MIDI data in a track for humanization, quantization errors, etc.

        Args:
            track: Track object with midi_clips
            time_sig_num: Time signature numerator (beats per bar)
            grid_resolution: Grid resolution in beats (0.25 = 16th notes)

        Returns:
            MIDIAnalysis with all metrics, or None if no MIDI data
        """
        if not track.midi_clips:
            return None

        # Collect all notes from all clips
        all_notes: List[MIDINote] = []
        for clip in track.midi_clips:
            all_notes.extend(clip.notes)

        if not all_notes:
            return None

        # Extract velocities
        velocities = [n.velocity for n in all_notes if not n.mute]
        if not velocities:
            return None

        # Velocity statistics
        vel_mean = sum(velocities) / len(velocities)
        vel_variance = sum((v - vel_mean) ** 2 for v in velocities) / len(velocities)
        vel_std = math.sqrt(vel_variance)
        vel_min = min(velocities)
        vel_max = max(velocities)

        # Humanization score based on velocity variation
        if len(set(velocities)) == 1:
            humanization = 'robotic'  # Single velocity value
        elif vel_std < 5:
            humanization = 'robotic'
        elif vel_std < 15:
            humanization = 'slightly_humanized'
        else:
            humanization = 'natural'

        # Quantization error detection
        quant_errors = self._detect_quantization_errors(
            all_notes, track.name, grid_resolution
        )

        # Note density (notes per bar)
        if all_notes:
            max_time = max(n.start_time + n.duration for n in all_notes)
            num_bars = max(1, max_time / time_sig_num)
            note_density = len(all_notes) / num_bars
        else:
            note_density = 0.0

        # Chord detection
        chords = self._detect_chords(all_notes)

        # Swing ratio
        swing = self._calculate_swing_ratio(all_notes, grid_resolution)

        return MIDIAnalysis(
            track_name=track.name,
            note_count=len(all_notes),
            velocity_mean=round(vel_mean, 1),
            velocity_std=round(vel_std, 1),
            velocity_range=(vel_min, vel_max),
            humanization_score=humanization,
            quantization_errors=quant_errors,
            note_density_per_bar=round(note_density, 1),
            chord_count=len(chords),
            chords=chords,
            swing_ratio=swing
        )

    def _detect_quantization_errors(self, notes: List[MIDINote], track_name: str,
                                   grid_resolution: float = 0.25) -> List[QuantizationError]:
        """
        Find notes that are off the quantization grid.

        Args:
            notes: List of MIDI notes
            track_name: Name of the track for reporting
            grid_resolution: Grid resolution in beats

        Returns:
            List of QuantizationError objects for off-grid notes
        """
        errors = []

        for note in notes:
            if note.mute:
                continue

            # Find nearest grid position
            grid_pos = round(note.start_time / grid_resolution) * grid_resolution
            error_beats = abs(note.start_time - grid_pos)

            # Only report if significantly off-grid
            if error_beats > 0.01:  # More than 1/100 of a beat
                if error_beats >= 0.1:
                    severity = 'severe'
                elif error_beats >= 0.03:
                    severity = 'notable'
                else:
                    severity = 'minor'

                errors.append(QuantizationError(
                    track_name=track_name,
                    pitch=note.pitch,
                    time=round(note.start_time, 3),
                    nearest_grid=round(grid_pos, 3),
                    error_beats=round(error_beats, 3),
                    severity=severity
                ))

        return errors

    def _detect_chords(self, notes: List[MIDINote],
                       time_threshold: float = 0.05) -> List[ChordEvent]:
        """
        Detect simultaneous notes that form chords.

        Args:
            notes: List of MIDI notes
            time_threshold: Max time difference for notes to be considered simultaneous

        Returns:
            List of ChordEvent objects
        """
        if not notes:
            return []

        # Sort notes by start time
        sorted_notes = sorted(notes, key=lambda n: n.start_time)

        chords = []
        i = 0

        while i < len(sorted_notes):
            # Find all notes starting within threshold
            chord_notes = [sorted_notes[i]]
            j = i + 1

            while j < len(sorted_notes):
                if sorted_notes[j].start_time - sorted_notes[i].start_time <= time_threshold:
                    chord_notes.append(sorted_notes[j])
                    j += 1
                else:
                    break

            # If 3+ notes, it's a chord
            if len(chord_notes) >= 3:
                pitches = sorted(set(n.pitch for n in chord_notes))
                min_duration = min(n.duration for n in chord_notes)
                chord_name = self._identify_chord(pitches)

                chords.append(ChordEvent(
                    time=round(chord_notes[0].start_time, 3),
                    pitches=pitches,
                    chord_name=chord_name,
                    duration=round(min_duration, 3)
                ))

            i = j if j > i + 1 else i + 1

        return chords

    def _identify_chord(self, pitches: List[int]) -> Optional[str]:
        """
        Identify chord name from MIDI pitches.

        Args:
            pitches: Sorted list of MIDI pitch values

        Returns:
            Chord name (e.g., 'C', 'Am', 'Gmaj7') or None
        """
        if len(pitches) < 3:
            return None

        # Note names
        note_names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

        # Get intervals from root
        root = pitches[0] % 12
        intervals = sorted(set((p - pitches[0]) % 12 for p in pitches))

        root_name = note_names[root]

        # Common chord patterns (intervals from root)
        chord_types = {
            (0, 4, 7): '',         # Major
            (0, 3, 7): 'm',        # Minor
            (0, 4, 7, 11): 'maj7', # Major 7th
            (0, 3, 7, 10): 'm7',   # Minor 7th
            (0, 4, 7, 10): '7',    # Dominant 7th
            (0, 3, 6): 'dim',      # Diminished
            (0, 4, 8): 'aug',      # Augmented
            (0, 5, 7): 'sus4',     # Suspended 4th
            (0, 2, 7): 'sus2',     # Suspended 2nd
        }

        interval_tuple = tuple(intervals)
        chord_suffix = chord_types.get(interval_tuple)

        if chord_suffix is not None:
            return f"{root_name}{chord_suffix}"

        # Try matching without all notes (partial match)
        for pattern, suffix in chord_types.items():
            if all(i in intervals for i in pattern):
                return f"{root_name}{suffix}"

        return f"{root_name}?"  # Unknown chord type

    def _calculate_swing_ratio(self, notes: List[MIDINote],
                               grid_resolution: float = 0.25) -> Optional[float]:
        """
        Calculate swing ratio based on off-beat timing.

        Swing ratio: timing of off-beats relative to on-beats
        - 0.5 = straight (8th notes evenly spaced)
        - 0.67 = triplet swing (2:1 ratio)
        - 0.6 = light swing

        Args:
            notes: List of MIDI notes
            grid_resolution: Grid resolution in beats

        Returns:
            Swing ratio (0.5-0.75) or None if insufficient data
        """
        if len(notes) < 10:
            return None

        # Find off-beat notes (on the "and" of each beat)
        off_beat_positions = []

        for note in notes:
            if note.mute:
                continue

            # Position within beat
            beat_pos = note.start_time % 1.0

            # Off-beat if around 0.5 (straight) or shifted for swing
            if 0.3 < beat_pos < 0.8:
                off_beat_positions.append(beat_pos)

        if len(off_beat_positions) < 5:
            return None

        # Average off-beat position
        avg_offbeat = sum(off_beat_positions) / len(off_beat_positions)

        # Convert to swing ratio (0.5 = straight)
        swing_ratio = round(avg_offbeat, 2)

        # Clamp to reasonable range
        if 0.45 <= swing_ratio <= 0.75:
            return swing_ratio

        return 0.5  # Default to straight if outlier

    # ==================== PROJECT STRUCTURE METHODS ====================

    def _parse_locators(self, root: ET.Element) -> List[Locator]:
        """
        Parse arrangement locators/markers.

        Args:
            root: XML root element

        Returns:
            List of Locator objects sorted by time
        """
        locators = []

        # Try multiple paths for locators
        locator_paths = [
            ".//Locators/Locators/Locator",
            ".//Locators/Locator",
            ".//LiveSet/Locators/Locators/Locator"
        ]

        for path in locator_paths:
            for loc_elem in root.findall(path):
                try:
                    time_elem = loc_elem.find("Time")
                    name_elem = loc_elem.find("Name")

                    if time_elem is not None and "Value" in time_elem.attrib:
                        time = float(time_elem.attrib["Value"])
                        name = ""

                        if name_elem is not None and "Value" in name_elem.attrib:
                            name = name_elem.attrib["Value"]

                        if not name:
                            name = f"Marker {len(locators) + 1}"

                        locators.append(Locator(time=time, name=name))
                except Exception:
                    continue

            if locators:
                break

        # Sort by time
        return sorted(locators, key=lambda l: l.time)

    def _parse_scenes(self, root: ET.Element) -> List[Scene]:
        """
        Parse Session View scenes.

        Args:
            root: XML root element

        Returns:
            List of Scene objects
        """
        scenes = []

        scene_paths = [
            ".//Scenes/Scene",
            ".//LiveSet/Scenes/Scene"
        ]

        for path in scene_paths:
            for i, scene_elem in enumerate(root.findall(path)):
                try:
                    name = f"Scene {i + 1}"
                    tempo = None

                    # Get scene name
                    name_elem = scene_elem.find(".//Name")
                    if name_elem is not None and "Value" in name_elem.attrib:
                        scene_name = name_elem.attrib["Value"]
                        if scene_name:
                            name = scene_name

                    # Get scene tempo
                    tempo_elem = scene_elem.find(".//Tempo")
                    if tempo_elem is not None and "Value" in tempo_elem.attrib:
                        try:
                            tempo = float(tempo_elem.attrib["Value"])
                        except ValueError:
                            pass

                    scenes.append(Scene(index=i, name=name, tempo=tempo))
                except Exception:
                    continue

            if scenes:
                break

        return scenes

    def _parse_tempo_automation(self, root: ET.Element) -> List[TempoChange]:
        """
        Parse tempo automation points.

        Args:
            root: XML root element

        Returns:
            List of TempoChange objects sorted by time
        """
        tempo_changes = []

        # Look for tempo automation in various locations
        automation_paths = [
            ".//MasterTrack//Tempo//Automation//Events//FloatEvent",
            ".//MasterTrack//Tempo//AutomationEnvelope//Automation//Events//FloatEvent",
            ".//Tempo//Automation//Events//FloatEvent"
        ]

        for path in automation_paths:
            for event in root.findall(path):
                try:
                    time = float(event.attrib.get("Time", 0))
                    value = float(event.attrib.get("Value", 120))

                    tempo_changes.append(TempoChange(time=time, tempo=value))
                except Exception:
                    continue

            if tempo_changes:
                break

        # Sort by time
        return sorted(tempo_changes, key=lambda t: t.time)

    def _parse_project_structure(self, root: ET.Element) -> ProjectStructure:
        """
        Parse all project structure information.

        Args:
            root: XML root element

        Returns:
            ProjectStructure with locators, scenes, and tempo automation
        """
        locators = self._parse_locators(root)
        scenes = self._parse_scenes(root)
        tempo_automation = self._parse_tempo_automation(root)

        return ProjectStructure(
            locators=locators,
            scenes=scenes,
            tempo_automation=tempo_automation,
            has_tempo_changes=len(tempo_automation) > 1
        )

    def export_midi(self, project: ALSProject, output_dir: str) -> List[str]:
        """
        Export MIDI data from the project to .mid files.

        Args:
            project: Parsed ALS project
            output_dir: Directory to save MIDI files

        Returns:
            List of exported file paths
        """
        # Note: Full MIDI export would require mido library
        # This is a placeholder for the functionality
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        exported = []

        for track in project.tracks:
            if track.midi_clips:
                # Log what we would export
                midi_file = output_path / f"{track.name.replace(' ', '_')}.mid"
                exported.append(str(midi_file))

        return exported


def parse_als(als_path: str) -> ALSProject:
    """Quick function to parse an ALS file."""
    parser = ALSParser()
    return parser.parse(als_path)
