import * as Dialog from '@radix-ui/react-dialog';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { toast } from 'sonner';

import { ApiError, fetcher } from '../api/fetcher';
import { useEntitlements, useReferences, useStemProposals } from '../api/hooks';
import { extractApiError } from '../api/error-utils';
import { STEM_ROLES } from '../api/types';
import type {
  AlsUploadResponse,
  ConfirmStemsResponse,
  ReanalyzeResponse,
  ReferenceDto,
  StageStemsResponse,
  StemProposalsResponse,
  StemRawDto,
  StemRole,
} from '../api/types';
import { useFileUpload } from '../hooks/useFileUpload';
import f from '../styles/forms.module.css';
import { buildConfirmPayload } from './stems-upload-helpers';
import { buildAutoConfirmPayload, decideDispatchPath } from './unified-upload-helpers';
import s from './UploadVersionDialog.module.css';

const MAX_STEMS = 100;
const STEM_ACCEPT = ['.wav', '.flac'];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When omitted, the BFF auto-creates a Song from the mix filename. */
  songId?: string;
  /** Genre hint inherited from the current song, prefills the genre fields. */
  defaultGenre?: string;
}

interface StemRow {
  localId: string;
  file: File;
  previewUrl: string;
  serverId?: string;
  detectedRole?: StemRole | null;
  confidence?: number;
  role: StemRole;
  userPicked: boolean;
}

type Phase = 'form' | 'uploading' | 'classifying' | 'review';

let _seq = 0;
const nextLocalId = () => `u${++_seq}`;
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Poll the proposals endpoint until the worker has classified every stem. Used
// only on the review-OFF path (the review-ON path uses the useStemProposals hook).
async function waitClassified(versionId: string): Promise<StemRawDto[]> {
  for (let i = 0; i < 160; i++) {
    const data = await fetcher<StemProposalsResponse>({
      url: `/versions/${versionId}/stems`,
      method: 'GET',
    });
    if (data.classified) return data.stems;
    await delay(1500);
  }
  throw new Error('Stem classification timed out — retry from the song page.');
}

/**
 * One dialog to provide the mix (required) plus optional stems, .als, and a
 * reference, running the 7-phase analysis exactly once. The mix + .als are
 * uploaded with analyze=false; a single analysis is dispatched downstream by
 * either /stems/confirm (stems path) or /versions/{id}/analyze (no-stems path).
 */
export function UnifiedUploadDialog({ open, onOpenChange, songId, defaultGenre }: Props) {
  const [phase, setPhase] = useState<Phase>('form');
  const [mix, setMix] = useState<File | null>(null);
  const [genre, setGenre] = useState(defaultGenre ?? '');
  const [als, setAls] = useState<File | null>(null);
  const [refMode, setRefMode] = useState<'upload' | 'library'>('upload');
  const [pickedReferenceId, setPickedReferenceId] = useState('');
  const [refFile, setRefFile] = useState<File | null>(null);
  const [refTitle, setRefTitle] = useState('');
  const [refArtist, setRefArtist] = useState('');
  const [refGenre, setRefGenre] = useState(defaultGenre ?? '');
  const [stemRows, setStemRows] = useState<StemRow[]>([]);
  const [reviewStems, setReviewStems] = useState(false);
  const [perStem, setPerStem] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [versionId, setVersionId] = useState('');
  const [songIdState, setSongIdState] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [entExhausted, setEntExhausted] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Reference chosen/created for THIS analysis, carried into the stems-review
  // confirm step (which dispatches in a later tick than handleSubmit).
  const resolvedRefIdRef = useRef<string>('');
  const references = useReferences();
  const fileUpload = useFileUpload();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ents = useEntitlements();
  const proposals = useStemProposals(versionId, Boolean(versionId) && phase === 'review');

  // Review-ON: merge the worker's guesses into the rows as polling delivers them.
  useEffect(() => {
    const data = proposals.data;
    if (!data) return;
    setStemRows((prev) =>
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
  }, [proposals.data]);

  const reset = () => {
    stemRows.forEach((r) => URL.revokeObjectURL(r.previewUrl));
    audioRef.current?.pause();
    setPhase('form');
    setMix(null);
    setGenre(defaultGenre ?? '');
    setAls(null);
    setRefMode('upload');
    setPickedReferenceId('');
    resolvedRefIdRef.current = '';
    setRefFile(null);
    setRefTitle('');
    setRefArtist('');
    setRefGenre(defaultGenre ?? '');
    setStemRows([]);
    setReviewStems(false);
    setPerStem(false);
    setPlayingId(null);
    setVersionId('');
    setSongIdState('');
    setStatus('');
    setBusy(false);
    setEntExhausted(false);
  };

  const finishNavigate = (sid: string, jobId: string) => {
    onOpenChange(false);
    reset();
    void navigate({ to: '/songs/$songId/results/$jobId', params: { songId: sid, jobId } });
  };

  const addStemFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const incoming = Array.from(list).filter((file) =>
      STEM_ACCEPT.some((ext) => file.name.toLowerCase().endsWith(ext)),
    );
    if (incoming.length === 0) {
      toast.error('Only .wav / .flac stems are supported.');
      return;
    }
    setStemRows((prev) => {
      const room = MAX_STEMS - prev.length;
      if (incoming.length > room) toast.error(`Up to ${MAX_STEMS} stems.`);
      const add: StemRow[] = incoming.slice(0, room).map((file) => ({
        localId: nextLocalId(),
        file,
        previewUrl: URL.createObjectURL(file),
        role: 'other',
        userPicked: false,
      }));
      return [...prev, ...add];
    });
  };

  const onStemDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (phase === 'form') addStemFiles(e.dataTransfer.files);
  };

  const togglePlay = (row: StemRow) => {
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
    setStemRows((prev) =>
      prev.map((r) => (r.localId === localId ? { ...r, role, userPicked: true } : r)),
    );

  const removeRow = (localId: string) =>
    setStemRows((prev) => {
      const target = prev.find((r) => r.localId === localId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((r) => r.localId !== localId);
    });

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!mix) return;
    // Client-side entitlement gate (AR38: server is authoritative; this is UI hint only).
    if (ents.data?.analysesRemaining === 0) {
      setEntExhausted(true);
      return;
    }
    setEntExhausted(false);
    // A library reference that hasn't finished analyzing can't drive Phase 5 —
    // block the dispatch fail-fast rather than silently degrading the analysis.
    if (refMode === 'library' && pickedReferenceId) {
      const picked = references.data?.find((r) => r.id === pickedReferenceId);
      if (picked && !picked.analyzed) {
        toast.error('That reference is still analyzing — pick another or wait for it to finish.');
        return;
      }
    }
    setBusy(true);
    setPhase('uploading');
    try {
      // 1. Mix — deferred (no job yet).
      setStatus('Uploading mix…');
      const mixRes = await fileUpload.upload(mix, {
        ...(songId ? { song_id: songId } : {}),
        ...(genre.trim() ? { genre_hint: genre.trim() } : {}),
        analyze: false,
      });
      const vid = mixRes.versionId;
      setVersionId(vid);
      setSongIdState(mixRes.songId);

      // 2. .als — attach only.
      if (als) {
        setStatus('Attaching project…');
        const alsForm = new FormData();
        alsForm.append('file', als, als.name);
        alsForm.append('analyze', 'false');
        await fetcher<AlsUploadResponse>({
          url: `/versions/${vid}/als`,
          method: 'POST',
          body: alsForm,
        });
      }

      // 3. Reference — either a saved library track or a new upload. Either way
      //    we resolve a referenceId to drive Phase 5 in the single dispatch below.
      let referenceId = '';
      if (refMode === 'library') {
        referenceId = pickedReferenceId;
      } else if (refFile) {
        setStatus('Uploading reference…');
        const rForm = new FormData();
        rForm.append('file', refFile);
        if (refTitle.trim()) rForm.append('title', refTitle.trim());
        if (refArtist.trim()) rForm.append('artist', refArtist.trim());
        if (refGenre.trim()) rForm.append('genre', refGenre.trim());
        const ref = await fetcher<ReferenceDto>({ url: '/references/', method: 'POST', body: rForm });
        void fetcher<unknown>({ url: `/references/${ref.id}/analyze`, method: 'POST' }).catch(() => {});
        qc.invalidateQueries({ queryKey: ['references'] });
        referenceId = ref.id;
      }
      resolvedRefIdRef.current = referenceId; // carried into the review-confirm step

      // 4. The single dispatch.
      if (decideDispatchPath({ hasStems: stemRows.length > 0 }) === 'analyze') {
        setStatus('Starting analysis…');
        const r = await fetcher<ReanalyzeResponse>({
          url: referenceId
            ? `/versions/${vid}/analyze?referenceId=${encodeURIComponent(referenceId)}`
            : `/versions/${vid}/analyze`,
          method: 'POST',
        });
        qc.invalidateQueries({ queryKey: ['songs'] });
        finishNavigate(mixRes.songId, r.jobId);
        return;
      }

      // Stems path: stage → classify → (review | auto-confirm).
      setStatus('Uploading stems…');
      const stemForm = new FormData();
      for (const r of stemRows) stemForm.append('files', r.file, r.file.name);
      const staged = await fetcher<StageStemsResponse>({
        url: `/versions/${vid}/stems/stage`,
        method: 'POST',
        body: stemForm,
      });
      const stagedStems = staged.stems.slice(-stemRows.length);
      setStemRows((prev) => prev.map((r, i) => ({ ...r, serverId: stagedStems[i]?.id })));
      await fetcher<unknown>({ url: `/versions/${vid}/stems/classify`, method: 'POST' });

      if (reviewStems) {
        setStatus('');
        setBusy(false);
        setPhase('review'); // hook polls; user confirms roles
        return;
      }

      // Review OFF: wait for classification, then confirm from detected roles.
      setPhase('classifying');
      setStatus('Classifying stems…');
      const classified = await waitClassified(vid);
      const res = await fetcher<ConfirmStemsResponse>({
        url: `/versions/${vid}/stems/confirm`,
        method: 'POST',
        data: {
          stems: buildAutoConfirmPayload(classified),
          mode: 'grouped',
          ...(resolvedRefIdRef.current ? { referenceId: resolvedRefIdRef.current } : {}),
        },
      });
      qc.invalidateQueries({ queryKey: ['songs'] });
      finishNavigate(mixRes.songId, res.reanalysisJobId);
    } catch (err) {
      // Server-side entitlement gate (catches races where the client check passed but the
      // server rejects because the last slot was consumed concurrently).
      if (err instanceof ApiError && extractApiError(err.body).code === 'entitlement_exhausted') {
        setPhase('form');
        setStatus('');
        setBusy(false);
        setEntExhausted(true);
        return;
      }
      // The version may already exist un-analyzed — let the user retry from the song page.
      setPhase('form');
      setStatus('');
      setBusy(false);
      toast.error(
        err instanceof Error
          ? `${err.message} — if the track was created, retry analysis from the song page.`
          : 'Upload failed',
      );
    }
  };

  const handleConfirm = async () => {
    const payload = buildConfirmPayload(stemRows);
    if (payload.length === 0) return;
    setBusy(true);
    try {
      const res = await fetcher<ConfirmStemsResponse>({
        url: `/versions/${versionId}/stems/confirm`,
        method: 'POST',
        data: {
          stems: payload,
          mode: perStem ? 'per_stem' : 'grouped',
          ...(resolvedRefIdRef.current ? { referenceId: resolvedRefIdRef.current } : {}),
        },
      });
      qc.invalidateQueries({ queryKey: ['songs'] });
      finishNavigate(songIdState, res.reanalysisJobId);
    } catch (err) {
      setBusy(false);
      toast.error(err instanceof Error ? err.message : 'Confirm failed');
    }
  };

  const classified = proposals.data?.classified ?? false;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) reset();
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={f.dialogOverlay} />
        <Dialog.Content className={f.dialogContent}>
          <Dialog.Title className={f.dialogTitle}>
            {songId ? 'New version' : 'New track'}
          </Dialog.Title>
          <Dialog.Description className={f.dialogDescription}>
            The song/mix is required. Stems, an Ableton project, and a reference are
            optional — everything is analyzed in a single pass.
          </Dialog.Description>

          <form onSubmit={handleSubmit} className={f.field}>
            <div className={s.unifiedBody}>
              {phase === 'review' ? (
                <>
                  <p className={s.subhead}>
                    {classified ? 'Confirm stem roles' : 'Classifying stems…'}
                  </p>
                  <div className={s.stemTable}>
                    {stemRows.map((r) => (
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
                        <span className={s.stemMeta}>
                          {r.detectedRole
                            ? `${Math.round((r.confidence ?? 0) * 100)}%`
                            : '…'}
                        </span>
                      </div>
                    ))}
                  </div>
                  <label className={s.modeRow}>
                    <input
                      type="checkbox"
                      checked={perStem}
                      onChange={(e) => setPerStem(e.target.checked)}
                    />
                    Analyze every stem individually (default: group by role)
                  </label>
                </>
              ) : phase === 'uploading' || phase === 'classifying' ? (
                <p className={s.dropHint}>{status || 'Working…'}</p>
              ) : (
                <>
                  <label className={f.label}>
                    Song / mix (required)
                    <input
                      type="file"
                      accept=".wav,.flac,.mp3,audio/*"
                      onChange={(e) => setMix(e.target.files?.[0] ?? null)}
                      required
                      className={s.fileInput}
                    />
                  </label>

                  <label className={f.label}>
                    Genre hint (optional)
                    <input
                      type="text"
                      value={genre}
                      onChange={(e) => setGenre(e.target.value)}
                      placeholder="e.g. Progressive House"
                      maxLength={50}
                    />
                  </label>

                  <p className={s.subhead}>Stems (optional)</p>
                  <label
                    className={`${s.dropZone} ${dragActive ? s.dropZoneActive : ''}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragActive(true);
                    }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={onStemDrop}
                  >
                    <span>Drop stems here, or click to choose</span>
                    <span className={s.dropHint}>WAV / FLAC · up to {MAX_STEMS} files</span>
                    <input
                      type="file"
                      multiple
                      accept=".wav,.flac,audio/*"
                      onChange={(e) => addStemFiles(e.target.files)}
                      style={{ display: 'none' }}
                    />
                  </label>
                  {stemRows.length > 0 && (
                    <div className={s.stemTable}>
                      {stemRows.map((r) => (
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
                          <span className={s.stemMeta}>ready</span>
                          <button
                            type="button"
                            className={s.removeBtn}
                            onClick={() => removeRow(r.localId)}
                            aria-label="Remove stem"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {stemRows.length > 0 && (
                    <label className={s.modeRow}>
                      <input
                        type="checkbox"
                        checked={reviewStems}
                        onChange={(e) => setReviewStems(e.target.checked)}
                      />
                      Review stem roles before analyzing
                    </label>
                  )}

                  <p className={s.subhead}>Ableton project (optional)</p>
                  <label className={f.label}>
                    .als or gzip-compressed .als
                    <input
                      type="file"
                      accept=".als,.gz"
                      onChange={(e) => setAls(e.target.files?.[0] ?? null)}
                      className={s.fileInput}
                    />
                  </label>

                  <p className={s.subhead}>Reference track (optional)</p>
                  <label className={f.label}>
                    Reference source
                    <select
                      value={refMode}
                      onChange={(e) => {
                        const next = e.target.value as 'upload' | 'library';
                        setRefMode(next);
                        // Clear the opposing mode's selection so a stale file/pick
                        // doesn't linger when the user switches source.
                        if (next === 'library') setRefFile(null);
                        else setPickedReferenceId('');
                      }}
                    >
                      <option value="upload">Upload new</option>
                      <option value="library">Choose from library</option>
                    </select>
                  </label>

                  {refMode === 'library' ? (
                    references.data && references.data.length > 0 ? (
                      <label className={f.label}>
                        Saved reference
                        <select
                          value={pickedReferenceId}
                          onChange={(e) => setPickedReferenceId(e.target.value)}
                        >
                          <option value="">— none —</option>
                          {references.data.map((ref) => (
                            <option key={ref.id} value={ref.id}>
                              {ref.title}
                              {ref.artist ? ` — ${ref.artist}` : ''}
                              {ref.analyzed ? '' : ' (analyzing…)'}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <p className={s.dropHint}>
                        No saved references yet. Switch to “Upload new”, or add some in
                        your library first.
                      </p>
                    )
                  ) : (
                    <label className={f.label}>
                      Reference audio
                      <input
                        type="file"
                        accept=".wav,.flac,.mp3,audio/*"
                        onChange={(e) => setRefFile(e.target.files?.[0] ?? null)}
                        className={s.fileInput}
                      />
                    </label>
                  )}
                  {refMode === 'upload' && refFile && (
                    <>
                      <label className={f.label}>
                        Reference title (optional)
                        <input
                          type="text"
                          value={refTitle}
                          onChange={(e) => setRefTitle(e.target.value)}
                          maxLength={200}
                          placeholder="defaults to filename"
                        />
                      </label>
                      <label className={f.label}>
                        Reference artist (optional)
                        <input
                          type="text"
                          value={refArtist}
                          onChange={(e) => setRefArtist(e.target.value)}
                          maxLength={120}
                        />
                      </label>
                      <label className={f.label}>
                        Reference genre (optional)
                        <input
                          type="text"
                          value={refGenre}
                          onChange={(e) => setRefGenre(e.target.value)}
                          maxLength={50}
                        />
                      </label>
                    </>
                  )}
                </>
              )}
            </div>

            {entExhausted && (
              <p className={s.entExhaustedError} role="alert">
                You have used all your analyses for this period.{' '}
                <a href="/_app/usage">View usage</a> or{' '}
                <a href="/_app/billing">upgrade your plan</a>.
              </p>
            )}

            {fileUpload.isUploading && (
              <progress value={fileUpload.progress} max={1} className={s.progress} />
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
                  disabled={busy || !classified || buildConfirmPayload(stemRows).length === 0}
                  className={`${f.button} ${f.buttonPrimary}`}
                >
                  {busy ? 'Starting…' : 'Confirm & analyze'}
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!mix || busy}
                  className={`${f.button} ${f.buttonPrimary}`}
                >
                  {busy ? status || 'Working…' : 'Upload & analyze'}
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
