import * as Dialog from '@radix-ui/react-dialog';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { toast } from 'sonner';

import { useClassifyStems, useConfirmStems, useStemProposals } from '../api/hooks';
import { STEM_ROLES, type StemRole } from '../api/types';
import { useStemStaging } from '../hooks/useStemStaging';
import f from '../styles/forms.module.css';
import { buildConfirmPayload } from './stems-upload-helpers';
import s from './UploadVersionDialog.module.css';

const MAX_STEMS = 100;
const ACCEPT = ['.wav', '.flac'];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versionId: string;
  songId: string;
}

interface Row {
  localId: string;
  file: File;
  previewUrl: string;
  serverId?: string;
  detectedRole?: StemRole | null;
  confidence?: number;
  role: StemRole; // current selection
  userPicked: boolean; // true once the user overrides the detected role
}

type Phase = 'pick' | 'uploading' | 'classifying' | 'review';

let _seq = 0;
const nextLocalId = () => `r${++_seq}`;

export function StemsUploadDialog({ open, onOpenChange, versionId, songId }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [phase, setPhase] = useState<Phase>('pick');
  const [perStem, setPerStem] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const staging = useStemStaging(versionId);
  const classify = useClassifyStems(versionId);
  const confirm = useConfirmStems(versionId);
  const proposals = useStemProposals(versionId, phase === 'classifying' || phase === 'review');
  const navigate = useNavigate();

  // Merge classification results into rows as they arrive.
  useEffect(() => {
    const data = proposals.data;
    if (!data) return;
    setRows((prev) =>
      prev.map((r) => {
        const p = data.stems.find((x) => x.id === r.serverId);
        if (!p) return r;
        return {
          ...r,
          detectedRole: p.detectedRole,
          confidence: p.confidence,
          role: r.userPicked ? r.role : (p.detectedRole ?? r.role),
        };
      }),
    );
    if (data.classified && phase === 'classifying') setPhase('review');
  }, [proposals.data, phase]);

  const reset = () => {
    rows.forEach((r) => URL.revokeObjectURL(r.previewUrl));
    audioRef.current?.pause();
    setRows([]);
    setPhase('pick');
    setPerStem(false);
    setPlayingId(null);
  };

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const incoming = Array.from(list).filter((file) =>
      ACCEPT.some((ext) => file.name.toLowerCase().endsWith(ext)),
    );
    if (incoming.length === 0) {
      toast.error('Only .wav / .flac stems are supported.');
      return;
    }
    setRows((prev) => {
      const room = MAX_STEMS - prev.length;
      if (incoming.length > room) toast.error(`Up to ${MAX_STEMS} stems per version.`);
      const add: Row[] = incoming.slice(0, room).map((file) => ({
        localId: nextLocalId(),
        file,
        previewUrl: URL.createObjectURL(file),
        role: 'other',
        userPicked: false,
      }));
      return [...prev, ...add];
    });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (phase === 'pick') addFiles(e.dataTransfer.files);
  };

  const togglePlay = (row: Row) => {
    const a = audioRef.current;
    if (!a) return;
    if (playingId === row.localId) {
      a.pause();
      setPlayingId(null);
      return;
    }
    a.src = row.previewUrl;
    void a.play();
    setPlayingId(row.localId);
  };

  const setRole = (localId: string, role: StemRole) =>
    setRows((prev) =>
      prev.map((r) => (r.localId === localId ? { ...r, role, userPicked: true } : r)),
    );

  const removeRow = (localId: string) =>
    setRows((prev) => {
      const target = prev.find((r) => r.localId === localId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((r) => r.localId !== localId);
    });

  const handleStage = async (e: FormEvent) => {
    e.preventDefault();
    if (rows.length === 0) return;
    setPhase('uploading');
    try {
      const res = await staging.stage(rows.map((r) => r.file));
      // Newly-staged stems are the last N entries (append semantics).
      const staged = res.stems.slice(-rows.length);
      setRows((prev) => prev.map((r, i) => ({ ...r, serverId: staged[i]?.id })));
      setPhase('classifying');
      await classify.mutateAsync();
    } catch (err) {
      setPhase('pick');
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    }
  };

  const handleConfirm = async () => {
    const payload = buildConfirmPayload(rows);
    if (payload.length === 0) return;
    try {
      const res = await confirm.mutateAsync({
        stems: payload,
        mode: perStem ? 'per_stem' : 'grouped',
      });
      toast.success(`Confirmed ${payload.length} stem${payload.length === 1 ? '' : 's'} — re-analyzing.`);
      onOpenChange(false);
      reset();
      void navigate({
        to: '/songs/$songId/results/$jobId',
        params: { songId, jobId: res.reanalysisJobId },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Confirm failed');
    }
  };

  const busy = phase === 'uploading' || phase === 'classifying' || confirm.isPending;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={f.dialogOverlay} />
        <Dialog.Content className={f.dialogContent}>
          <Dialog.Title className={f.dialogTitle}>Upload stems</Dialog.Title>
          <Dialog.Description className={f.dialogDescription}>
            Drag in up to {MAX_STEMS} stems (WAV/FLAC). We&apos;ll guess each one&apos;s role —
            play them back and fix any wrong guesses before re-analyzing.
          </Dialog.Description>

          <form onSubmit={handleStage} className={f.field}>
            {phase === 'pick' && (
              <label
                className={`${s.dropZone} ${dragActive ? s.dropZoneActive : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={onDrop}
              >
                <span>Drop stems here, or click to choose</span>
                <span className={s.dropHint}>WAV / FLAC · up to {MAX_STEMS} files</span>
                <input
                  type="file"
                  multiple
                  accept=".wav,.flac,audio/*"
                  onChange={(e) => addFiles(e.target.files)}
                  style={{ display: 'none' }}
                />
              </label>
            )}

            {phase === 'uploading' && (
              <progress className={s.progress} value={staging.progress} max={1} />
            )}
            {phase === 'classifying' && (
              <p className={s.dropHint}>Classifying stems by sound…</p>
            )}

            {rows.length > 0 && (
              <div className={s.stemTable}>
                {rows.map((r) => (
                  <div key={r.localId} className={s.stemItem}>
                    <button
                      type="button"
                      className={s.playBtn}
                      onClick={() => togglePlay(r)}
                      aria-label="Preview stem"
                    >
                      {playingId === r.localId ? '❚❚' : '▶'}
                    </button>
                    <span className={s.stemName} title={r.file.name}>
                      {r.file.name}
                    </span>
                    {phase === 'review' ? (
                      <select
                        className={s.roleSelect}
                        value={r.role}
                        onChange={(e) => setRole(r.localId, e.target.value as StemRole)}
                      >
                        {STEM_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className={s.stemMeta}>
                        {r.detectedRole
                          ? `${r.detectedRole} ${Math.round((r.confidence ?? 0) * 100)}%`
                          : phase === 'classifying'
                            ? '…'
                            : 'ready'}
                      </span>
                    )}
                    {phase === 'pick' ? (
                      <button
                        type="button"
                        className={s.removeBtn}
                        onClick={() => removeRow(r.localId)}
                        aria-label="Remove stem"
                      >
                        ✕
                      </button>
                    ) : (
                      <span className={s.stemMeta}>
                        {r.detectedRole && (r.confidence ?? 0) < 0.5 ? 'check' : ''}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {phase === 'review' && (
              <label className={s.modeRow}>
                <input
                  type="checkbox"
                  checked={perStem}
                  onChange={(e) => setPerStem(e.target.checked)}
                />
                Analyze every stem individually (default: group by role)
              </label>
            )}

            <div className={f.dialogActions}>
              <Dialog.Close asChild>
                <button type="button" className={f.button} disabled={busy}>
                  Cancel
                </button>
              </Dialog.Close>
              {phase === 'review' ? (
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={busy || buildConfirmPayload(rows).length === 0}
                  className={`${f.button} ${f.buttonPrimary}`}
                >
                  {confirm.isPending ? 'Confirming…' : 'Confirm & re-analyze'}
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={rows.length === 0 || busy}
                  className={`${f.button} ${f.buttonPrimary}`}
                >
                  {phase === 'uploading'
                    ? 'Uploading…'
                    : phase === 'classifying'
                      ? 'Classifying…'
                      : `Upload ${rows.length} & classify`}
                </button>
              )}
            </div>
          </form>

          <audio ref={audioRef} onEnded={() => setPlayingId(null)} style={{ display: 'none' }} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
