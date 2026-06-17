import { gzipSync } from 'node:zlib';

import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { AlsParseError, parseAlsFile, parseAlsXml, readAlsXml } from '../alsPreview';

// jsdom DOMParser injected for the node test env (production uses native DOMParser).
const { window } = new JSDOM('');
const domParse = (xml: string) => new window.DOMParser().parseFromString(xml, 'application/xml');

// A realistic-enough Ableton Live Set: tempo, modern time signature, two audio
// tracks, one MIDI track, a native device (EQ Eight), a VST plugin (Serum), and
// a Max for Live device — covering every extractor path.
const SAMPLE_ALS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="11.0_11300" Creator="Ableton Live 11.3.13">
  <LiveSet>
    <MasterTrack>
      <DeviceChain>
        <Mixer>
          <Tempo>
            <LomId Value="0" />
            <Manual Value="124" />
          </Tempo>
        </Mixer>
      </DeviceChain>
    </MasterTrack>
    <Transport>
      <TimeSignature>
        <RemoteableTimeSignature>
          <Numerator Value="7" />
          <Denominator Value="8" />
        </RemoteableTimeSignature>
      </TimeSignature>
    </Transport>
    <Tracks>
      <AudioTrack Id="8">
        <Name>
          <EffectiveName Value="Lead Vocal" />
          <UserName Value="Lead Vocal" />
        </Name>
        <DeviceChain>
          <DeviceChain>
            <Devices>
              <Eq8>
                <UserName Value="" />
              </Eq8>
            </Devices>
          </DeviceChain>
        </DeviceChain>
      </AudioTrack>
      <AudioTrack Id="9">
        <Name>
          <EffectiveName Value="Reese Bass" />
        </Name>
        <DeviceChain>
          <DeviceChain>
            <Devices>
              <PluginDevice>
                <PluginDesc>
                  <VstPluginInfo>
                    <PlugName Value="Serum" />
                  </VstPluginInfo>
                </PluginDesc>
              </PluginDevice>
            </Devices>
          </DeviceChain>
        </DeviceChain>
      </AudioTrack>
      <MidiTrack Id="10">
        <Name>
          <EffectiveName Value="Pluck Arp" />
        </Name>
        <DeviceChain>
          <DeviceChain>
            <Devices>
              <MxDeviceInstrument>
                <SourceContext />
                <FileRef>
                  <Path Value="C:\\Packs\\Granulator.amxd" />
                </FileRef>
              </MxDeviceInstrument>
            </Devices>
          </DeviceChain>
        </DeviceChain>
      </MidiTrack>
    </Tracks>
  </LiveSet>
</Ableton>`;

describe('parseAlsXml', () => {
  it('extracts tempo, time signature, tracks, devices, plugins and version', () => {
    const p = parseAlsXml(SAMPLE_ALS_XML, domParse);

    expect(p.tempo).toBe(124);
    expect(p.timeSignatureNumerator).toBe(7);
    expect(p.timeSignatureDenominator).toBe(8);
    expect(p.timeSignature).toBe('7/8');

    expect(p.audioTracks).toEqual(['Lead Vocal', 'Reese Bass']);
    expect(p.midiTracks).toEqual(['Pluck Arp']);
    expect(p.trackCount).toBe(3);

    expect(p.devices).toContain('EQ Eight');
    expect(p.devices).toContain('Serum');
    expect(p.devices).toContain('Granulator'); // M4L name from FileRef basename, .amxd stripped
    expect(p.plugins).toEqual(['Serum']);

    expect(p.abletonVersion).toBe('Ableton Live 11.3.13');
  });

  it('falls back to default 4/4 and null tempo when absent', () => {
    const p = parseAlsXml('<Ableton><LiveSet><Tracks /></LiveSet></Ableton>', domParse);
    expect(p.tempo).toBeNull();
    expect(p.timeSignature).toBe('4/4');
    expect(p.trackCount).toBe(0);
    expect(p.devices).toEqual([]);
  });

  it('reads the older <Numerator><Manual> time-signature shape', () => {
    const xml = `<Ableton><LiveSet><TimeSignature>
      <Numerator><Manual Value="3" /></Numerator>
      <Denominator><Manual Value="4" /></Denominator>
    </TimeSignature><Tracks /></LiveSet></Ableton>`;
    const p = parseAlsXml(xml, domParse);
    expect(p.timeSignature).toBe('3/4');
  });

  it('names unnamed tracks with a positional fallback', () => {
    const xml = `<Ableton><LiveSet><Tracks>
      <AudioTrack><Name><EffectiveName Value="" /></Name></AudioTrack>
      <AudioTrack><Name /></AudioTrack>
    </Tracks></LiveSet></Ableton>`;
    const p = parseAlsXml(xml, domParse);
    expect(p.audioTracks).toEqual(['Audio 1', 'Audio 2']);
  });

  it('rejects non-Ableton XML', () => {
    expect(() => parseAlsXml('<foo><bar /></foo>', domParse)).toThrow(AlsParseError);
  });

  it('rejects malformed XML reported as a parsererror node', () => {
    // jsdom emits a <parsererror> element for broken XML rather than throwing.
    expect(() => parseAlsXml('<Ableton><unclosed>', domParse)).toThrow(AlsParseError);
  });
});

describe('readAlsXml', () => {
  it('gunzips a gzipped .als', async () => {
    const gz = gzipSync(Buffer.from(SAMPLE_ALS_XML, 'utf-8'));
    const blob = new Blob([gz]);
    const xml = await readAlsXml(blob);
    expect(xml).toContain('<Ableton');
    expect(xml).toContain('Reese Bass');
  });

  it('reads a non-gzipped (older / hand-decompressed) .als as plain text', async () => {
    const blob = new Blob([SAMPLE_ALS_XML]);
    const xml = await readAlsXml(blob);
    expect(xml).toContain('Pluck Arp');
  });
});

describe('parseAlsFile', () => {
  it('end-to-end: gzip blob → preview', async () => {
    const gz = gzipSync(Buffer.from(SAMPLE_ALS_XML, 'utf-8'));
    const blob = new Blob([gz]);
    const p = await parseAlsFile(blob, domParse);
    expect(p.tempo).toBe(124);
    expect(p.audioTracks).toContain('Reese Bass');
  });
});
