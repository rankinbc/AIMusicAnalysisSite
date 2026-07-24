import { RackView } from './RackView';

interface Props {
  name: string;
  chain: unknown;
  moduleCount: number;
  onClose: () => void;
}

/** Modal showing one preset's / Coach Mix's device chain via the shared RackView
 *  — same renderer as every preset row, because it is the same rack schema. */
export function PresetChainModal({ name, chain, moduleCount, onClose }: Props) {
  return (
    <div className="modal-scrim" onClick={onClose} role="presentation">
      <div
        className="modal"
        style={{ width: 'min(820px, 100%)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Preset ${name}`}
      >
        <div className="modal-hd">
          <div className="mt">
            <div className="mk">Preset · rack</div>
            <div className="mn">
              {name} <span className="mono">{moduleCount} devices</span>
            </div>
          </div>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <RackView chain={chain} />
        </div>
      </div>
    </div>
  );
}
