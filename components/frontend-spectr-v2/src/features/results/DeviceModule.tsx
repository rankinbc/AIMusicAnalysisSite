import { MANIFEST, moduleParams, type ModuleState } from './fix-rack-helpers';
import s from './RackView.module.css';

interface Props {
  id: string;
  state: ModuleState | undefined;
}

/** One read-only device card: glyph + label + on-dot + param rows. Lifted from
 *  FixRackPanel's module grid so every rack surface renders modules identically.
 *  Metadata (glyph/accent/label/param schema) comes from RACK_MANIFEST. */
export function DeviceModule({ id, state }: Props) {
  const man = MANIFEST.get(id);
  const rows = moduleParams(id, state ?? {});
  return (
    <div className={s.mod} style={{ ['--ac' as string]: man?.accent ?? 'var(--muted)' }}>
      <div className={s.modHead}>
        <span className={s.modGlyph}>{man?.glyph ?? '·'}</span>
        <span className={s.modLabel}>{man?.label ?? id}</span>
        <span className={`${s.dot} ${s.on}`} title="enabled in the chain" />
      </div>
      {rows.length > 0 && (
        <div className={s.modParams}>
          {rows.map((p, i) => (
            <div key={i} className={s.param}>
              <span className={s.paramLabel}>{p.label}</span>
              <span className={`mono ${s.paramVal}`}>{p.val}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
