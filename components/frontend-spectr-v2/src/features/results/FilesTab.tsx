import { useState } from 'react';

import { getAccessToken } from '../../api/fetcher';
import { useVersionFiles } from '../../api/hooks';
import type { VersionFileType } from '../../api/types';
import type { SongHeaderInputs } from './SongHeader';
import s from './FilesTab.module.css';

interface FilesTabProps {
  versionId: string;
  inputs?: SongHeaderInputs;
  onAddInputs?: () => void;
  onReanalyze?: () => void;
  reanalyzing?: boolean;
}

const INPUT_ROWS: { key: keyof SongHeaderInputs; label: string }[] = [
  { key: 'mix', label: 'Primary mix' },
  { key: 'stems', label: 'Stems' },
  { key: 'als', label: 'Ableton project' },
  { key: 'reference', label: 'Reference track' },
];

const TYPE_LABEL: Record<VersionFileType, string> = {
  mix: 'Mix audio',
  als: 'Ableton project',
  stem: 'Stem',
  reference: 'Reference track',
};

const TYPE_ICON: Record<VersionFileType, string> = {
  mix: '♫',
  als: '⎇',
  stem: '∿',
  reference: '◎',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function downloadPath(versionId: string, type: VersionFileType, stemId: string | null): string {
  switch (type) {
    case 'mix':
      return `/versions/${versionId}/audio`;
    case 'als':
      return `/versions/${versionId}/als`;
    case 'reference':
      return `/versions/${versionId}/reference`;
    case 'stem':
      return `/versions/${versionId}/stems/${stemId}/audio`;
  }
}

async function triggerDownload(apiPath: string, filename: string) {
  const token = getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  // Story 3.3: this URL may 302 to S3/R2. fetch strips Authorization on the
  // cross-origin hop (spec) — but `credentials:'include'` would turn the S3
  // request into credentialed CORS, which the bucket CORS does not (and
  // should not) allow. The BFF hop is same-origin, so no cookies are needed.
  const res = await fetch(`/api${apiPath}`, { headers });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function FilesTab({
  versionId,
  inputs,
  onAddInputs,
  onReanalyze,
  reanalyzing,
}: FilesTabProps) {
  const { data, isLoading, isError } = useVersionFiles(versionId);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const inputsHeader = inputs && (
    <section className={s.inputs}>
      <div className={s.inputsHd}>
        <span className={s.sectionLabel}>Inputs</span>
        <span className={s.sectionSub}>what we analyzed</span>
      </div>
      <ul className={s.inputList}>
        {INPUT_ROWS.map(({ key, label }) => {
          const present = inputs[key];
          return (
            <li key={key} className={s.inputRow} data-present={present || undefined}>
              <span className={s.inputName}>{label}</span>
              {present ? (
                <span className={s.parsed}>✓ analyzed</span>
              ) : (
                <button type="button" className="btn sm" onClick={onAddInputs}>
                  Add
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div className={s.fileActions}>
        <button
          type="button"
          className="btn primary sm"
          onClick={() => onReanalyze?.()}
          disabled={!onReanalyze || reanalyzing}
        >
          ↺ {reanalyzing ? 'Re-analyzing…' : 'Re-analyze'}
        </button>
        <button type="button" className="btn sm" onClick={onAddInputs}>
          Add files to deepen
        </button>
      </div>
    </section>
  );

  const handleDownload = async (
    type: VersionFileType,
    filename: string,
    stemId: string | null,
  ) => {
    const key = `${type}:${stemId ?? ''}`;
    setDownloading(key);
    setDownloadError(null);
    try {
      await triggerDownload(downloadPath(versionId, type, stemId), filename);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(null);
    }
  };

  const downloads = isLoading ? (
    <div className={s.state}>Loading files…</div>
  ) : isError || !data ? (
    <div className={s.state}>Could not load file list.</div>
  ) : data.files.length === 0 ? (
    <div className={s.state}>No downloadable files for this version.</div>
  ) : (
    <>
      {downloadError && <div className={s.errorBanner}>{downloadError}</div>}
      <ul className={s.list}>
        {data.files.map((f, i) => {
          const key = `${f.type}:${f.stemId ?? i}`;
          const isBusy = downloading === `${f.type}:${f.stemId ?? ''}`;
          return (
            <li key={key} className={s.row}>
              <span className={s.icon} aria-hidden>
                {TYPE_ICON[f.type]}
              </span>
              <span className={s.info}>
                <span className={s.name}>{f.filename}</span>
                <span className={s.meta}>
                  <span className="pill">{TYPE_LABEL[f.type]}</span>
                  {f.sizeBytes !== null && (
                    <span className={s.size}>{formatBytes(f.sizeBytes)}</span>
                  )}
                </span>
              </span>
              {f.available ? (
                <button
                  type="button"
                  className="btn sm"
                  disabled={isBusy}
                  onClick={() => void handleDownload(f.type, f.filename, f.stemId)}
                >
                  {isBusy ? 'Downloading…' : '⇣ Download'}
                </button>
              ) : (
                <span className={s.expired}>Expired</span>
              )}
            </li>
          );
        })}
      </ul>
      <p className={s.note}>
        Files are stored locally in development. In production, signed URLs expire after 7 days.
      </p>
    </>
  );

  return (
    <div className={s.root}>
      {inputsHeader}
      <section className={s.downloads}>
        <div className={s.inputsHd}>
          <span className={s.sectionLabel}>Downloads</span>
        </div>
        {downloads}
      </section>
    </div>
  );
}
