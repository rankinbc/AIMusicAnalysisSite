import { FixRackPanel } from './FixRackPanel';
import type { FixRackGenPhase } from './useFixRackGeneration';

interface CoachMixModalProps {
  jobId: string;
  versionId: string | null;
  trackName: string;
  committedCount: number;
  genPhase: FixRackGenPhase;
  onGenerate: () => void;
  onClose: () => void;
}

// The compiled Fix Rack (né "Coach Mix" — relabeled, story 12.6) shown full-width in a modal (the sidebar only carries a
// compact entry — the rack needs room). Reuses FixRackPanel for the actual rack.
export function CoachMixModal({
  jobId,
  versionId,
  trackName,
  committedCount,
  genPhase,
  onGenerate,
  onClose,
}: CoachMixModalProps) {
  return (
    <div className="modal-scrim" onClick={onClose} role="presentation">
      <div
        className="modal"
        style={{ width: 'min(620px, 100%)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Fix Rack"
      >
        <div className="modal-hd">
          <div className="mt">
            <div className="mk">Fix Rack · calculated rack</div>
            <div className="mn">{trackName}</div>
          </div>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <FixRackPanel
            jobId={jobId}
            versionId={versionId}
            committedCount={committedCount}
            genPhase={genPhase}
            onGenerate={onGenerate}
          />
        </div>
      </div>
    </div>
  );
}
