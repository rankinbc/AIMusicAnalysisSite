import { STAGES, type StageId } from './stageRegistry';
import s from './StageSelect.module.css';

interface Props {
  value: StageId;
  onChange: (id: StageId) => void;
}

export function StageSelect({ value, onChange }: Props) {
  return (
    <div className={s.pillbar} role="radiogroup" aria-label="Visualizer stage">
      {STAGES.map((st) => (
        <button
          key={st.id}
          type="button"
          role="radio"
          aria-checked={value === st.id}
          aria-label={st.label}
          title={st.label}
          className={s.btn}
          data-active={value === st.id}
          onClick={() => onChange(st.id)}
        >
          {st.icon}
        </button>
      ))}
    </div>
  );
}
