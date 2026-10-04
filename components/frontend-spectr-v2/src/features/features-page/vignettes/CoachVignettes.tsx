/* Coach-side vignettes, each modelled on its real surface: the report's
 * "Ask the Coach" panel, the Specialist Team dialog, and a Coach Mix preset
 * in the Send-to-Listen card. All three draw on real sample-report content
 * (the how-it-works page's verbatim coach exchange and Coach Mix chain; the
 * product's own specialist catalog). */
import { useState } from 'react';

import { COACH_MODES } from '../features-content';
import { SAMPLE_SPECIALIST_FINDINGS, TEAM_GROUPS } from '../vignette-data';
import { DEMO_ANSWER, DEMO_EVIDENCE, DEMO_QUESTION } from '../../how-it-works/coach-showcase-content';
import { DEMO_CHAIN, DEMO_DROPPED, DEMO_EQ_BANDS } from '../../how-it-works/daw-chain';
import { groupColor, SPECIALIST_CATALOG } from '../../results/helpers/specialists';
import { Coach } from '../../../ui/Coach';
import { SpecialistBot } from '../../../ui/SpecialistBot';
import k from './kit.module.css';
import s from './coach-vignettes.module.css';

const RAN = Object.keys(SAMPLE_SPECIALIST_FINDINGS).length;

export function CoachVignette() {
  return (
    <div className={s.chat}>
      <div className={s.chatHead}>
        <span className={s.avatar} aria-hidden="true"><Coach size={30} glow={false} /></span>
        <div className={s.chatTitle}>
          <span className={k.lbl} data-tone="cyan">● Ask the Coach</span>
          <span className={s.chatSub}>I know everything about this song.</span>
        </div>
        <span className={`${k.seg} ${k.push}`} role="img" aria-label="Coach mode: Normal">
          {COACH_MODES.map((m) => (
            <span key={m} className={k.segItem} data-on={m === 'Normal'}>{m}</span>
          ))}
        </span>
      </div>

      <div className={s.thread}>
        <p className={s.msgUser}>{DEMO_QUESTION}</p>
        <div className={s.msgCoach}>
          <span className={s.msgAvatar} aria-hidden="true"><Coach size={22} glow={false} /></span>
          <p className={s.msgText}>{DEMO_ANSWER}</p>
          <ul className={s.cites} aria-label="Measurements the Coach cited">
            {DEMO_EVIDENCE.map((e) => (
              <li key={e.label} className={k.chip}>{e.label}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className={s.composer} aria-hidden="true">
        <span className={s.input}>Ask the coach about this mix…</span>
        <span className={s.send}>➤</span>
      </div>
      <p className={`mono ${s.chatFoot}`}>grounded · {RAN} specialists ran</p>
    </div>
  );
}

type Group = (typeof TEAM_GROUPS)[number];
const GROUP_TONE: Record<Group, string> = {
  Spectrum: 'cyan', Loudness: 'orange', Dynamics: 'yellow', Stereo: 'blue', Stems: 'green',
};

export function TeamVignette() {
  const [group, setGroup] = useState<Group>('Loudness');
  const shown = SPECIALIST_CATALOG.filter((sp) => (TEAM_GROUPS as readonly string[]).includes(sp.group));
  const locked = shown.filter((sp) => sp.group === 'Stems').length;
  return (
    <div className={s.team}>
      <div className={s.teamHead}>
        <span className={k.lbl}>AI Coach · on-demand</span>
        <span className={s.teamTitle}>Specialist Team</span>
      </div>

      <div className={s.groups} role="group" aria-label="Specialist groups">
        {TEAM_GROUPS.map((g) => (
          <button key={g} type="button" className={s.group} aria-pressed={group === g} onClick={() => setGroup(g)}>
            <span className={s.groupDot} data-tone={GROUP_TONE[g]} aria-hidden="true" />
            {g}
            <span className={s.groupCount}>{shown.filter((sp) => sp.group === g).length}</span>
          </button>
        ))}
      </div>

      <ul className={s.roster}>
        {shown.filter((sp) => sp.group === group).map((sp) => {
          const findings = SAMPLE_SPECIALIST_FINDINGS[sp.slug];
          const isLocked = sp.group === 'Stems';
          return (
            <li key={sp.slug} className={s.specialist}>
              <span className={s.specialistIcon} aria-hidden="true">
                <SpecialistBot size={22} color={groupColor(sp.group)} glow={false} label={sp.label} />
              </span>
              <span className={s.specialistName}>{sp.label}</span>
              <span className={s.specialistState}>
                {findings != null ? 'Picked for this track' : isLocked ? 'Needs stems' : 'Not run yet'}
              </span>
              {findings != null
                ? <span className={`mono ${s.specialistCount}`}>{findings} findings</span>
                : <span className={k.chip}>{isLocked ? 'Locked' : 'Run'}</span>}
            </li>
          );
        })}
      </ul>

      <p className={s.teamFoot}>
        <b>{RAN}</b> ran · <b>{shown.length - RAN - locked}</b> available · stem specialists locked
      </p>
    </div>
  );
}

const EQ_BAND = DEMO_EQ_BANDS[0];
const TILE_SUMMARY: Record<string, string> = {
  eq: EQ_BAND?.type === 'bell' ? `${EQ_BAND.freqHz} −${Math.abs(EQ_BAND.gainDb).toFixed(2)}` : '',
  limiter: DEMO_CHAIN.find((d) => d.id === 'limiter')?.params.slice(0, 2).map((p) => p.value).join(' · ') ?? '',
  trim: DEMO_CHAIN.find((d) => d.id === 'trim')?.params[0]?.value ?? '',
};

export function CoachMixVignette() {
  return (
    <div className={s.mix}>
      <div className={k.row}>
        <span className={k.lbl}>Send to Listen</span>
        <span className={`${k.lbl} ${k.push}`}>1 preset</span>
      </div>
      <div className={s.preset}>
        <span className={s.presetIcon} aria-hidden="true"><Coach size={24} glow={false} /></span>
        <span className={s.presetName}>Coach Mix</span>
        <span className={`mono ${s.presetMeta}`}>{DEMO_CHAIN.length} devices</span>
        <span className={k.btn} data-tone="solid">▶ Listen</span>
      </div>

      <div className={k.tiles} aria-hidden="true">
        {DEMO_CHAIN.map((d) => (
          <div key={d.id} className={k.tile} data-on="true" data-tone={d.id === 'limiter' ? 'red' : undefined}>
            <span className={k.tileName}>{d.module}</span>
            <span className={k.tilePower}>ON</span>
            <span className={k.tileSummary}>{TILE_SUMMARY[d.id]}</span>
          </div>
        ))}
        <div className={k.tile}>
          <span className={k.tileName}>Compressor</span>
          <span className={k.tilePower}>OFF</span>
          <span className={k.tileSummary}>left out</span>
        </div>
      </div>

      <ol className={s.whys} aria-label="Why each device is in the chain">
        {DEMO_CHAIN.map((d) => (
          <li key={d.id}>
            <span className={s.whyDevice}>{d.daw}</span> {d.why}
          </li>
        ))}
      </ol>
      <p className={s.dropped}>
        <span className={k.lbl}>Left out · {DEMO_DROPPED.device}</span>
        {DEMO_DROPPED.rationale}
      </p>
    </div>
  );
}
