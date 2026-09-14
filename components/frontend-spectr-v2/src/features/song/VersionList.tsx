import { useState } from 'react';
import type { VersionDto } from '../../api/types';
import type { VStatus } from './song-helpers';
import { sortVersionsDesc } from './song-helpers';
import { VersionRow } from './VersionRow';
import { VersionRowMenu } from './VersionRowMenu';

interface VersionListProps {
  versions: VersionDto[];
  slotA: string | null;
  slotB: string | null;
  highlight: string | null;
  onPlay: (id: string) => void;
  onReport: (version: VersionDto) => void;
  onRetry: (id: string) => void;
  onMakeCurrent: (id: string) => void;
  onReanalyze: (id: string) => void;
  onReanalyzeRef: (id: string) => void;
  onOpenListen: (id: string) => void;
  onViewGamePlan?: (id: string) => void;
  onDelete: (id: string) => void;
  onEditLabel: (id: string, label: string) => Promise<void>;
  statusMap?: Record<string, { status: VStatus; progress?: number }>;
  gamePlanIds?: ReadonlySet<string>;
}

export function VersionList({
  versions,
  slotA,
  slotB,
  highlight,
  onPlay,
  onReport,
  onRetry,
  onMakeCurrent,
  onReanalyze,
  onReanalyzeRef,
  onOpenListen,
  onViewGamePlan,
  onDelete,
  onEditLabel,
  statusMap,
  gamePlanIds,
}: VersionListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const sorted = sortVersionsDesc(versions);
  // I3: Report navigates to song.latestResult.jobId, which belongs to the
  // highest-versionNumber row. Gate canReport to that row only.
  const latestVersionId = sorted[0]?.id ?? null;
  const versionCountStr = `${versions.length} version${versions.length === 1 ? '' : 's'}`;

  const startEdit = (v: VersionDto) => {
    setEditingId(v.id);
    setEditValue(v.label ?? `Version ${v.versionNumber}`);
  };
  const cancelEdit = () => setEditingId(null);
  const saveEdit = async (v: VersionDto) => {
    const label = editValue.trim() || `Version ${v.versionNumber}`;
    try {
      await onEditLabel(v.id, label);
      setEditingId(null);
    } catch {
      // error toast already fired in onEditLabel; keep edit mode open
    }
  };

  return (
    <div className="card">
      <div className="card-hd">
        <span className="label">Versions</span>
        <span className="mono" style={{ fontSize: '10px', color: 'var(--muted)' }}>{versionCountStr} · newest first</span>
      </div>
      <div>
        {sorted.map((version, i) => {
          const statusEntry = statusMap?.[version.id];
          const vHasPlan = gamePlanIds?.has(version.id) ?? false;
          const menu = (
            <VersionRowMenu
              hasGamePlan={vHasPlan}
              onMakeCurrent={() => onMakeCurrent(version.id)}
              onEditLabel={() => startEdit(version)}
              onReanalyze={() => onReanalyze(version.id)}
              onReanalyzeRef={() => onReanalyzeRef(version.id)}
              onOpenListen={() => onOpenListen(version.id)}
              onViewGamePlan={() => onViewGamePlan?.(version.id)}
              onDelete={() => onDelete(version.id)}
            />
          );

          return (
            <VersionRow
              key={version.id}
              version={version}
              index={i}
              slotA={slotA}
              slotB={slotB}
              highlight={highlight}
              onPlay={() => onPlay(version.id)}
              onReport={() => onReport(version)}
              onRetry={() => onRetry(version.id)}
              menu={menu}
              hasGamePlan={vHasPlan}
              canReport={version.id === latestVersionId}
              {...(statusEntry?.status !== undefined ? { status: statusEntry.status } : {})}
              {...(statusEntry?.progress !== undefined ? { progress: statusEntry.progress } : {})}
              editing={editingId === version.id}
              editValue={editingId === version.id ? editValue : ''}
              onEditChange={setEditValue}
              onEditSave={() => { void saveEdit(version); }}
              onEditCancel={cancelEdit}
            />
          );
        })}
      </div>
    </div>
  );
}
