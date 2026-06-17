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

function extractDevices(doc: Document): { devices: string[]; plugins: string[] } {
  // Walk every <Devices> container's direct children. Iterating all containers
  // (including those nested inside racks) and deduping by name gives a complete
  // "what's in this project" list — good enough for a drag-time preview.
  const devices = new Set<string>();
  const plugins = new Set<string>();

  for (const container of descendants(doc, 'Devices')) {
    for (const dev of Array.from(container.children)) {
      const tag = dev.tagName;
      const userName = valueAttr(directChild(dev, 'UserName'))?.trim() || '';

      if (tag === 'PluginDevice') {
        const plugName =
          valueAttr(firstDescendant(dev, 'PlugName')) ??
          // AU plugins store their name under AuPluginInfo/Name.
          valueAttr(directChild(firstDescendant(dev, 'AuPluginInfo') ?? dev, 'Name'));
        const name = userName || plugName || 'Unknown Plugin';
        plugins.add(name);
        devices.add(name);
        continue;
      }

      if (tag === 'MxDeviceAudioEffect' || tag === 'MxDeviceMidi' || tag === 'MxDeviceInstrument') {
        const ref = valueAttr(firstDescendant(dev, 'Path'));
        const base = ref ? ref.split(/[\\/]/).pop()!.replace(/\.amxd$/i, '') : tag;
        devices.add(userName || base);
        continue;
      }

      // Native Ableton device.
      const friendly = NATIVE_DEVICE_NAMES[tag] ?? prettifyTag(tag);
      devices.add(userName || friendly);
    }
  }

  return { devices: Array.from(devices), plugins: Array.from(plugins) };
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
export function parseAlsXml(xml: string, domParse: DomParse = defaultDomParse): AlsPreview {
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
