/**
 * Client-side Ableton Live Set (.als) preview parser.
 *
 * Ableton `.als` files are gzipped XML. The moment a user drops one onto the
 * upload dialog we gunzip + parse it in the browser (no upload round-trip) and
 * surface a compact "we understand your file" preview: tempo, time signature,
 * audio/MIDI track counts + names, and the devices/plugins used.
 *
 * This is a MINIMAL port of the authoritative Python parser at
 * `components/analysis/src/audio_analysis/als/als_parser.py` — element names,
 * XPaths and field names mirror it where reasonable. See DECISIONS.md (D1–D4).
 */

export interface AlsPreview {
  /** Project tempo (BPM). null when the file has no readable tempo. */
  tempo: number | null;
  timeSignatureNumerator: number;
  timeSignatureDenominator: number;
  /** Pretty "4/4" form for display. */
  timeSignature: string;
  /** Audio track names, in document order. */
  audioTracks: string[];
  /** MIDI track names, in document order. */
  midiTracks: string[];
  /** audioTracks.length + midiTracks.length. */
  trackCount: number;
  /** Unique device + plugin names used anywhere in the project. */
  devices: string[];
  /** Subset of `devices` that are third-party VST/AU plugins. */
  plugins: string[];
  /** Best-effort Ableton version/creator string (e.g. "Ableton Live 11.3.13"). */
  abletonVersion: string | null;
}

/** One track in the persisted project map (see {@link AlsProjectJson}). */
export interface AlsProjectTrack {
  /** Position among audio+MIDI tracks in document order (0-based). */
  index: number;
  name: string;
  type: 'audio' | 'midi';
  /** Raw Ableton palette colour index, or null when absent. */
  color: number | null;
  /** Unique device/plugin names on this track's own device chain. */
  devices: string[];
}

/**
 * The structured project map persisted alongside the analysis ("project
 * awareness"). Parsed client-side from a dropped `.als` and POSTed with the
 * upload; the BFF stores it verbatim on `song_versions.als_project_json`. See
 * DECISIONS.md (D6–D9). A superset of {@link AlsPreview} — the drag-time panel
 * is derived from it via {@link alsPreviewFromProject}.
 */
export interface AlsProjectJson {
  schemaVersion: 1;
  source: 'client-als-preview';
  tempo: number | null;
  timeSignature: string;
  timeSignatureNumerator: number;
  timeSignatureDenominator: number;
  abletonVersion: string | null;
  trackCount: number;
  tracks: AlsProjectTrack[];
  devices: string[];
  plugins: string[];
}

// Payload guards (DoS / oversized-project): keep the stored JSON bounded. The
// BFF additionally caps the serialized size.
const MAX_PROJECT_TRACKS = 250;
const MAX_DEVICES_PER_TRACK = 64;

/** A function that turns an XML string into a DOM Document. */
export type DomParse = (xml: string) => Document;

/** Thrown when a file can't be read as a Live Set. */
export class AlsParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlsParseError';
  }
}

// Native-device tag → friendly name (ported from als_parser._NATIVE_DEVICE_NAMES).
const NATIVE_DEVICE_NAMES: Record<string, string> = {
  AutoFilter: 'Auto Filter',
  Compressor2: 'Compressor',
  Eq8: 'EQ Eight',
  Saturator: 'Saturator',
  Reverb: 'Reverb',
  FilterDelay: 'Filter Delay',
  StereoGain: 'Utility',
  Overdrive: 'Overdrive',
  Redux2: 'Redux',
  Gate: 'Gate',
  GlueCompressor: 'Glue Compressor',
  MultibandDynamics: 'Multiband Dynamics',
  Resonator: 'Resonator',
  AutoPan: 'Auto Pan',
  PitchShifter: 'Pitch',
  Limiter: 'Limiter',
  Spectrum: 'Spectrum',
  Tuner: 'Tuner',
  VinylDistortion: 'Vinyl Distortion',
  LoFiImplosion: 'Lofi Implosion',
  Delay: 'Delay',
  Echo: 'Echo',
  Corpus: 'Corpus',
  FrequencyShifter: 'Frequency Shifter',
  InstrumentRack: 'Instrument Rack',
  AudioEffectRack: 'Audio Effect Rack',
  MidiEffectRack: 'MIDI Effect Rack',
  DrumRack: 'Drum Rack',
  OriginalSimpler: 'Simpler',
  MultiSampler: 'Sampler',
  UltraAnalog: 'Analog',
  Operator: 'Operator',
  Wavetable: 'Wavetable',
  Drift: 'Drift',
  Meld: 'Meld',
  Collision: 'Collision',
  Arpeggiator: 'Arpeggiator',
  Chord: 'Chord',
  NoteLength: 'Note Length',
  Scale: 'Scale',
  Velocity: 'Velocity',
  Random: 'Random',
  MidiPitchShifter: 'MIDI Pitch Shifter',
  MidiMonitor: 'MIDI Monitor',
};

const MAX_FILE_BYTES = 64 * 1024 * 1024; // 64 MB decompressed guard — previews are tiny in practice.

function defaultDomParse(xml: string): Document {
  if (typeof DOMParser === 'undefined') {
    throw new AlsParseError('DOMParser is not available in this environment');
  }
  return new DOMParser().parseFromString(xml, 'application/xml');
}

// ── tiny DOM helpers (work on any spec DOM: browser or jsdom) ──

function descendants(root: ParentNode, tag: string): Element[] {
  return Array.from((root as Element).getElementsByTagName(tag));
}

function directChild(el: Element, tag: string): Element | null {
  for (const c of Array.from(el.children)) if (c.tagName === tag) return c;
  return null;
}

function firstDescendant(root: ParentNode, tag: string): Element | null {
  return descendants(root, tag)[0] ?? null;
}

function valueAttr(el: Element | null): string | null {
  return el?.getAttribute('Value') ?? null;
}

function prettifyTag(tag: string): string {
  // Insert spaces at camelCase boundaries: "FooBar2" → "Foo Bar2".
  return tag.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

// ── field extractors ──

function extractTempo(doc: Document): number | null {
  // Mirror als_parser._get_tempo: first <Tempo> with a direct-child <Manual Value>.
  for (const tempoEl of descendants(doc, 'Tempo')) {
    const v = valueAttr(directChild(tempoEl, 'Manual'));
    if (v != null) {
      const n = Number.parseFloat(v);
      if (Number.isFinite(n) && n > 0) return Math.round(n * 100) / 100;
    }
  }
  return null;
}

function extractTimeSignature(doc: Document): [number, number] {
  // Modern Ableton: <RemoteableTimeSignature><Numerator Value/><Denominator Value/>.
  const remote = firstDescendant(doc, 'RemoteableTimeSignature');
  if (remote) {
    const num = Number.parseInt(valueAttr(directChild(remote, 'Numerator')) ?? '', 10);
    const den = Number.parseInt(valueAttr(directChild(remote, 'Denominator')) ?? '', 10);
    if (Number.isFinite(num) && Number.isFinite(den) && num > 0 && den > 0) return [num, den];
  }
  // Older Ableton: <TimeSignature><Numerator><Manual Value/></Numerator>...
  let numerator = 4;
  let denominator = 4;
  const tsEl = firstDescendant(doc, 'TimeSignature');
  if (tsEl) {
    const numBlock = directChild(tsEl, 'Numerator');
    const denBlock = directChild(tsEl, 'Denominator');
    const numV = numBlock ? valueAttr(directChild(numBlock, 'Manual')) : null;
    const denV = denBlock ? valueAttr(directChild(denBlock, 'Manual')) : null;
    const n = Number.parseInt(numV ?? '', 10);
    const d = Number.parseInt(denV ?? '', 10);
    if (Number.isFinite(n) && n > 0) numerator = n;
    if (Number.isFinite(d) && d > 0) denominator = d;
  }
  return [numerator, denominator];
}

function extractTrackName(trackEl: Element, fallback: string): string {
  // Mirror als_parser._get_track_name: first <Name> block's <EffectiveName>,
  // else <UserName>. The track's own Name block is the first one in the element.
  const nameBlocks = descendants(trackEl, 'Name');
  for (const nb of nameBlocks) {
    const eff = valueAttr(directChild(nb, 'EffectiveName'));
    if (eff && eff.trim()) return eff;
  }
  for (const nb of nameBlocks) {
    const user = valueAttr(directChild(nb, 'UserName'));
    if (user && user.trim()) return user;
  }
  return fallback;
}

function extractTrackNames(doc: Document, tag: 'AudioTrack' | 'MidiTrack', label: string): string[] {
  return descendants(doc, tag).map((el, i) => extractTrackName(el, `${label} ${i + 1}`));
}

/** Friendly name + plugin-ness for one device element (any <Devices> child). */
function deviceEntry(dev: Element): { name: string; isPlugin: boolean } {
  const tag = dev.tagName;
  const userName = valueAttr(directChild(dev, 'UserName'))?.trim() || '';

  if (tag === 'PluginDevice') {
    const plugName =
      valueAttr(firstDescendant(dev, 'PlugName')) ??
      // AU plugins store their name under AuPluginInfo/Name.
      valueAttr(directChild(firstDescendant(dev, 'AuPluginInfo') ?? dev, 'Name'));
    return { name: userName || plugName || 'Unknown Plugin', isPlugin: true };
  }

  if (tag === 'MxDeviceAudioEffect' || tag === 'MxDeviceMidi' || tag === 'MxDeviceInstrument') {
    const ref = valueAttr(firstDescendant(dev, 'Path'));
    const base = ref ? ref.split(/[\\/]/).pop()!.replace(/\.amxd$/i, '') : tag;
    return { name: userName || base, isPlugin: false };
  }

  // Native Ableton device.
  const friendly = NATIVE_DEVICE_NAMES[tag] ?? prettifyTag(tag);
  return { name: userName || friendly, isPlugin: false };
}

function extractDevices(root: ParentNode): { devices: string[]; plugins: string[] } {
  // Walk every <Devices> container's direct children. Iterating all containers
  // (including those nested inside racks) and deduping by name gives a complete
  // "what's in this project" list — good enough for a drag-time preview.
  const devices = new Set<string>();
  const plugins = new Set<string>();

  for (const container of descendants(root, 'Devices')) {
    for (const dev of Array.from(container.children)) {
      const { name, isPlugin } = deviceEntry(dev);
      devices.add(name);
      if (isPlugin) plugins.add(name);
    }
  }

  return { devices: Array.from(devices), plugins: Array.from(plugins) };
}

function extractTrackColor(trackEl: Element): number | null {
  // Mirror als_parser._get_track_color: first <Color Value="…"> in the track.
  const colorEl = firstDescendant(trackEl, 'Color');
  const v = valueAttr(colorEl);
  if (v == null) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function extractTrackDevices(trackEl: Element): string[] {
  // The track's own device chain (DeviceChain/.../Devices). Iterating every
  // <Devices> within the track element also pulls rack contents — fine for a
  // "what's on this track" read-out. Deduped, capped, in document order.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const container of descendants(trackEl, 'Devices')) {
    for (const dev of Array.from(container.children)) {
      const { name } = deviceEntry(dev);
      if (seen.has(name)) continue;
      seen.add(name);
      out.push(name);
      if (out.length >= MAX_DEVICES_PER_TRACK) return out;
    }
  }
  return out;
}

function extractProjectTracks(doc: Document): AlsProjectTrack[] {
  // Walk <Tracks> children in document order so audio/MIDI interleave the way
  // they do in the arrangement (the flat audioTracks[]/midiTracks[] used by the
  // preview lose that ordering). Only Audio/MIDI tracks are producer-meaningful
  // here — Return/Group/Master tracks are skipped.
  const container = firstDescendant(doc, 'Tracks');
  if (!container) return [];
  const out: AlsProjectTrack[] = [];
  for (const el of Array.from(container.children)) {
    const type = el.tagName === 'AudioTrack' ? 'audio' : el.tagName === 'MidiTrack' ? 'midi' : null;
    if (!type) continue;
    const index = out.length;
    out.push({
      index,
      name: extractTrackName(el, `${type === 'audio' ? 'Audio' : 'MIDI'} ${index + 1}`),
      type,
      color: extractTrackColor(el),
      devices: extractTrackDevices(el),
    });
    if (out.length >= MAX_PROJECT_TRACKS) break;
  }
  return out;
}

function extractVersion(doc: Document): string | null {
  const root = doc.documentElement;
  if (!root) return null;
  const creator = root.getAttribute('Creator');
  if (creator && creator.trim()) return creator.trim();
  const major = root.getAttribute('MajorVersion');
  const minor = root.getAttribute('MinorVersion');
  if (major || minor) return `${major ?? ''}.${minor ?? ''}`.replace(/^\.|\.$/g, '');
  return null;
}

/**
 * Parse a Live Set XML string into a preview. Pure + synchronous so it's
 * unit-testable; `domParse` is injectable for non-browser test environments.
 */
/** Parse + validate a Live Set XML string into a DOM Document, or throw. */
function toLiveSetDoc(xml: string, domParse: DomParse): Document {
  let doc: Document;
  try {
    doc = domParse(xml);
  } catch (err) {
    throw new AlsParseError(`Could not parse Live Set XML: ${(err as Error).message}`);
  }

  // DOMParser reports XML errors as a <parsererror> node rather than throwing.
  const parseError = doc.getElementsByTagName('parsererror')[0];
  if (parseError) {
    throw new AlsParseError("This doesn't look like a valid Ableton project file.");
  }

  const root = doc.documentElement;
  if (!root || (root.tagName !== 'Ableton' && descendants(doc, 'LiveSet').length === 0)) {
    throw new AlsParseError("This doesn't look like an Ableton Live Set.");
  }
  return doc;
}

export function parseAlsXml(xml: string, domParse: DomParse = defaultDomParse): AlsPreview {
  const doc = toLiveSetDoc(xml, domParse);

  const [num, den] = extractTimeSignature(doc);
  const audioTracks = extractTrackNames(doc, 'AudioTrack', 'Audio');
  const midiTracks = extractTrackNames(doc, 'MidiTrack', 'MIDI');
  const { devices, plugins } = extractDevices(doc);

  return {
    tempo: extractTempo(doc),
    timeSignatureNumerator: num,
    timeSignatureDenominator: den,
    timeSignature: `${num}/${den}`,
    audioTracks,
    midiTracks,
    trackCount: audioTracks.length + midiTracks.length,
    devices,
    plugins,
    abletonVersion: extractVersion(doc),
  };
}

/**
 * Decompress a `.als` Blob to its XML text. `.als` files are gzip; older Ableton
 * versions (and hand-gunzipped files) store raw XML, so we sniff the gzip magic
 * bytes and fall back to a plain UTF-8 decode.
 */
export async function readAlsXml(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);

  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!isGzip) {
    return new TextDecoder('utf-8').decode(bytes);
  }

  if (typeof DecompressionStream === 'undefined') {
    throw new AlsParseError('Gzip decompression is not available in this browser.');
  }

  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  const decompressed = await new Response(stream).arrayBuffer();
  if (decompressed.byteLength > MAX_FILE_BYTES) {
    throw new AlsParseError('This project is too large to preview in the browser.');
  }
  return new TextDecoder('utf-8').decode(decompressed);
}

/**
 * Read + parse a dropped/picked `.als` File into a preview. Throws
 * {@link AlsParseError} on any failure so the caller can show a graceful
 * "couldn't read this file" state.
 */
export async function parseAlsFile(file: Blob, domParse?: DomParse): Promise<AlsPreview> {
  const xml = await readAlsXml(file);
  return parseAlsXml(xml, domParse);
}

/**
 * Parse a Live Set XML string into the persisted {@link AlsProjectJson} project
 * map (per-track devices + colour, ordered track list). Pure + synchronous;
 * `domParse` is injectable for non-browser test environments.
 */
export function parseAlsProjectXml(
  xml: string,
  domParse: DomParse = defaultDomParse,
): AlsProjectJson {
  const doc = toLiveSetDoc(xml, domParse);
  const [num, den] = extractTimeSignature(doc);
  const tracks = extractProjectTracks(doc);
  const { devices, plugins } = extractDevices(doc);
  return {
    schemaVersion: 1,
    source: 'client-als-preview',
    tempo: extractTempo(doc),
    timeSignature: `${num}/${den}`,
    timeSignatureNumerator: num,
    timeSignatureDenominator: den,
    abletonVersion: extractVersion(doc),
    trackCount: tracks.length,
    tracks,
    devices,
    plugins,
  };
}

/** Read + parse a dropped/picked `.als` File into the project map. */
export async function parseAlsProjectFile(
  file: Blob,
  domParse?: DomParse,
): Promise<AlsProjectJson> {
  const xml = await readAlsXml(file);
  return parseAlsProjectXml(xml, domParse);
}

/**
 * Derive the drag-time {@link AlsPreview} from a parsed project map, so the
 * dialog parses the `.als` exactly once (project → preview) instead of twice.
 */
export function alsPreviewFromProject(project: AlsProjectJson): AlsPreview {
  const audioTracks = project.tracks.filter((t) => t.type === 'audio').map((t) => t.name);
  const midiTracks = project.tracks.filter((t) => t.type === 'midi').map((t) => t.name);
  return {
    tempo: project.tempo,
    timeSignatureNumerator: project.timeSignatureNumerator,
    timeSignatureDenominator: project.timeSignatureDenominator,
    timeSignature: project.timeSignature,
    audioTracks,
    midiTracks,
    trackCount: project.trackCount,
    devices: project.devices,
    plugins: project.plugins,
    abletonVersion: project.abletonVersion,
  };
}
