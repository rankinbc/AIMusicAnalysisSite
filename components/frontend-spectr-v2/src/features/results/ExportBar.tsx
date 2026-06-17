import { useState } from 'react';

import { moveToMarkdown, type Move } from './move-model';
import { ExportModal } from './ExportModal';
import s from './ExportBar.module.css';

interface ExportBarProps {
  committed: Move[];
  trackName: string;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'game-plan';
}

export function ExportBar({ committed, trackName }: ExportBarProps) {
  const [preview, setPreview] = useState(false);

  const download = () => {
    const md = moveToMarkdown(committed, trackName);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slugify(trackName)}-game-plan.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className={s.bar}>
        <span className={s.icon} aria-hidden>
          ⇣
        </span>
        <div className={s.copy}>
          <span className={s.title}>Export Game Plan</span>
          <span className={s.sub}>
            {committed.length} committed move{committed.length === 1 ? '' : 's'} → a checklist for your
            notes app
          </span>
        </div>
        <button type="button" className="btn sm" onClick={() => setPreview(true)}>
          Preview
        </button>
        <button
          type="button"
          className="btn sm primary"
          onClick={download}
          disabled={committed.length === 0}
        >
          ⇣ Export .md
        </button>
      </div>

      {preview && (
        <ExportModal
          committed={committed}
          trackName={trackName}
          onClose={() => setPreview(false)}
          onDownload={() => {
            download();
            setPreview(false);
          }}
        />
      )}
    </>
  );
}
