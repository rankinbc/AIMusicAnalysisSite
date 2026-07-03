import * as Dialog from '@radix-ui/react-dialog';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { toast } from 'sonner';

import { capture } from '../lib/analytics';

import { ApiError, fetcher } from '../api/fetcher';
import {
  useCreateSong,
  useEntitlements,
  useReferences,
  useSongs,
  useStemProposals,
} from '../api/hooks';
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
import { useMixUpload } from '../hooks/useMixUpload';
import { uploadAttachmentPresigned } from '../features/upload/attachment-upload-helpers';
import { AlsPreviewPanel } from '../features/upload/AlsPreviewPanel';
import {
  AlsParseError,
  alsPreviewFromProject,
  parseAlsProjectFile,
  type AlsPreview,
  type AlsProjectJson,
} from '../features/upload/alsPreview';
import f from '../styles/forms.module.css';
import { BlurLock } from './BlurLock';
import { buildConfirmPayload } from './stems-upload-helpers';
import { UpgradeSheet } from './UpgradeSheet';
import {
  buildAutoConfirmPayload,
  decideDispatchPath,
  decideSongAssociation,
  GENRE_HINTS,
} from './unified-upload-helpers';
import s from './UploadVersionDialog.module.css';

const MAX_STEMS = 100;
const STEM_ACCEPT = ['.wav', '.flac'];
const AUDIO_ACCEPT = ['.wav', '.flac', '.mp3', '.aiff', '.aif', '.m4a', '.ogg'];
const ALS_ACCEPT = ['.als', '.gz'];

const NEW_SONG = '__new__';
const CUSTOM_GENRE = '__custom__';

const hasExt = (name: string, exts: string[]) =>
  exts.some((ext) => name.toLowerCase().endsWith(ext));

/** First dropped/picked file whose extension is allowed (single-file zones). */
const firstMatching = (list: FileList | null, exts: string[]): File | null => {
  if (!list) return null;
  for (const file of Array.from(list)) if (hasExt(file.name, exts)) return file;
  return null;
};

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
// Treat a prefilled genre that isn't one of the curated hints as a custom value.
const isCustomGenre = (g: string) => Boolean(g) && !(GENRE_HINTS as readonly string[]).includes(g);

export function UnifiedUploadDialog({ open, onOpenChange, songId, defaultGenre }: Props) {
  const [phase, setPhase] = useState<Phase>('form');
  const [mix, setMix] = useState<File | null>(null);
  const [genre, setGenre] = useState(defaultGenre ?? '');
  const [genreCustom, setGenreCustom] = useState(() => isCustomGenre(defaultGenre ?? ''));
  // Song association (only used when no songId prop): '__new__' or an existing song id.
  const [songChoice, setSongChoice] = useState<string>(NEW_SONG);
  const [newSongName, setNewSongName] = useState('');
  const [als, setAls] = useState<File | null>(null);
  // Client-side .als parse ("we understand your file" trust moment) — the full
  // project map is POSTed with the upload (project awareness); the preview panel
  // is derived from it (single parse).
  const [alsPreview, setAlsPreview] = useState<AlsPreview | null>(null);
  const [alsProject, setAlsProject] = useState<AlsProjectJson | null>(null);
  const [alsParsing, setAlsParsing] = useState(false);
  const [alsPreviewError, setAlsPreviewError] = useState<string | null>(null);
  // "Advanced" disclosure for the de-emphasized stems zone (closed by default).
  const [showStems, setShowStems] = useState(false);
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
  const [mixDrag, setMixDrag] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [versionId, setVersionId] = useState('');
  const [songIdState, setSongIdState] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [entExhausted, setEntExhausted] = useState(false);
  // Why the UpgradeSheet opened: 'cap' = free allotment spent (count copy);
  // 'feature' = a Pro-only input (stems/.als) was clicked. Keeps the sheet copy
  // from telling a user with analyses left that they're "out of analyses".
  const [upgradeReason, setUpgradeReason] = useState<'cap' | 'feature'>('cap');

  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Reference chosen/created for THIS analysis, carried into the stems-review
  // confirm step (which dispatches in a later tick than handleSubmit).
  const resolvedRefIdRef = useRef<string>('');
  const references = useReferences();
  const songs = useSongs();
  const createSong = useCreateSong();
  // Story 3.1: presigned-first mix upload; transparently falls back to the
  // legacy proxy path when S3 is unconfigured (501). Attachments below stay
  // on the legacy endpoints until story 3.2.
  const fileUpload = useMixUpload();
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

  // Parse a dropped/picked .als entirely in the browser so we can instantly show
  // the producer that we "understand" their project — before any upload happens.
  useEffect(() => {
    if (!als) {
      setAlsPreview(null);
      setAlsProject(null);
      setAlsPreviewError(null);
      setAlsParsing(false);
      return;
    }
    let cancelled = false;
    setAlsPreview(null);
    setAlsProject(null);
    setAlsPreviewError(null);
    setAlsParsing(true);
    parseAlsProjectFile(als)
      .then((project) => {
        if (cancelled) return;
        setAlsProject(project);
        setAlsPreview(alsPreviewFromProject(project));
      })
      .catch((err) => {
        if (cancelled) return;
        setAlsPreviewError(
          err instanceof AlsParseError
            ? err.message
            : "Couldn't read this Ableton project — analysis will still work.",
        );
      })
      .finally(() => {
        if (!cancelled) setAlsParsing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [als]);

  const reset = () => {
    stemRows.forEach((r) => URL.revokeObjectURL(r.previewUrl));
    audioRef.current?.pause();
    setPhase('form');
    setMix(null);
    setGenre(defaultGenre ?? '');
    setGenreCustom(isCustomGenre(defaultGenre ?? ''));
    setSongChoice(NEW_SONG);
    setNewSongName('');
    setMixDrag(false);
    setAls(null);
    setAlsPreview(null);
    setAlsProject(null);
    setAlsPreviewError(null);
    setAlsParsing(false);
    setShowStems(false);
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
    // KPI: upload_completed + attachment adoption (.als attach rate row).
    capture('upload_completed', {
      als_attached: !!als,
      stems_attached: stemRows.length > 0,
      reference_attached: !!refFile,
    });
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

  const onMixDrop = (e: DragEvent) => {
    e.preventDefault();
    setMixDrag(false);
    const file = firstMatching(e.dataTransfer.files, AUDIO_ACCEPT);
    if (file) setMix(file);
    else toast.error('Drop an audio file (WAV / FLAC / MP3 / AIFF / M4A / OGG).');
  };

  const onAlsDrop = (e: DragEvent) => {
    e.preventDefault();
    const file = firstMatching(e.dataTransfer.files, ALS_ACCEPT);
    if (file) setAls(file);
    else toast.error('Drop an Ableton .als (or gzip-compressed .als).');
  };

  const onRefDrop = (e: DragEvent) => {
    e.preventDefault();
    const file = firstMatching(e.dataTransfer.files, AUDIO_ACCEPT);
    if (file) setRefFile(file);
    else toast.error('Drop a reference audio file.');
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
    // Client-side entitlement gate (gate-BETWEEN, UX-DR38): open the UpgradeSheet
    // BEFORE any pipeline work when the free allotment is spent. The server 409
    // (AR38) below remains the authoritative backstop for races.
    // Block only while entitlements are still loading (the button is disabled
    // then too). If the query ERRORED we proceed and let the server 409 be the
    // backstop — never silently dead-end the button with no data.
    if (ents.isLoading) return;
    if (ents.data?.analysesRemaining === 0) {
      setUpgradeReason('cap');
      setEntExhausted(true);
      return;
    }
    setEntExhausted(false);
    await runUpload();
  };

  // The upload pipeline, factored out so the post-checkout resume (AC2) can
  // re-invoke it with the SAME in-memory `mix` File once the tier flips.
  const runUpload = async () => {
    if (busy || phase !== 'form') return;
    if (!mix) return;
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
      // 0. Resolve the song this mix attaches to. A typed new name creates the
      //    song first (pure frontend orchestration); an existing pick reuses its
      //    id; otherwise the BFF auto-names the song from the mix filename.
      const assoc = decideSongAssociation({
        ...(songId ? { songIdProp: songId } : {}),
        mode: songChoice === NEW_SONG ? 'new' : 'existing',
        pickedSongId: songChoice === NEW_SONG ? '' : songChoice,
        newSongName,
      });
      let targetSongId = '';
      if (assoc.action === 'fixed' || assoc.action === 'existing') {
        targetSongId = assoc.songId;
      } else if (assoc.action === 'create') {
        setStatus('Creating song…');
        const created = await createSong.mutateAsync({
          name: assoc.name,
          genreHint: genre.trim() || null,
        });
        targetSongId = created.id;
        // Remember it: if a later step fails and the user retries, reuse this
        // song instead of creating a duplicate.
        setSongChoice(created.id);
        setNewSongName('');
      }

      // 1. Mix — deferred (no job yet).
      setStatus('Uploading mix…');
      const mixRes = await fileUpload.upload(mix, {
        ...(targetSongId ? { song_id: targetSongId } : {}),
        ...(genre.trim() ? { genre_hint: genre.trim() } : {}),
        analyze: false,
      });
      const vid = mixRes.versionId;
      setVersionId(vid);
      setSongIdState(mixRes.songId);

      // 2. .als — attach only. Ship the client-parsed project map so the app
      //    has saved "project awareness" (track/device map) alongside the
      //    analysis. The worker's phase8 re-parse stays authoritative.
      //    Story 3.2: presigned-first (direct PUT to R2/MinIO + als-key
      //    registration); 501 falls back to the legacy proxy FormData.
      if (als) {
        setStatus('Attaching project…');
        try {
          const put = await uploadAttachmentPresigned({
            file: als,
            kind: 'als',
            versionId: vid,
            onProgress: (l, t) => setStatus(`Attaching project… ${Math.round((100 * l) / t)}%`),
          });
          await fetcher<AlsUploadResponse>({
            url: `/versions/${vid}/als-key`,
            method: 'POST',
            data: {
              key: put.key,
              analyze: false,
              ...(alsProject ? { projectJson: JSON.stringify(alsProject) } : {}),
            },
          });
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 501)) throw e;
          const alsForm = new FormData();
          alsForm.append('file', als, als.name);
          alsForm.append('analyze', 'false');
          if (alsProject) alsForm.append('project_json', JSON.stringify(alsProject));
          await fetcher<AlsUploadResponse>({
            url: `/versions/${vid}/als`,
            method: 'POST',
            body: alsForm,
          });
        }
      }

      // 3. Reference — either a saved library track or a new upload. Either way
      //    we resolve a referenceId to drive Phase 5 in the single dispatch below.
      let referenceId = '';
      if (refMode === 'library') {
        referenceId = pickedReferenceId;
      } else if (refFile) {
        setStatus('Uploading reference…');
        let ref: ReferenceDto;
        try {
          // Story 3.2 — presigned-first; 501 falls back to the proxy upload.
          const put = await uploadAttachmentPresigned({
            file: refFile,
            kind: 'reference',
            onProgress: (l, t) => setStatus(`Uploading reference… ${Math.round((100 * l) / t)}%`),
          });
          ref = await fetcher<ReferenceDto>({
            url: '/references/complete-key',
            method: 'POST',
            data: {
              referenceId: put.referenceId,
              key: put.key,
              fileName: refFile.name,
              ...(refTitle.trim() ? { title: refTitle.trim() } : {}),
              ...(refArtist.trim() ? { artist: refArtist.trim() } : {}),
              ...(refGenre.trim() ? { genre: refGenre.trim() } : {}),
            },
          });
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 501)) throw e;
          const rForm = new FormData();
          rForm.append('file', refFile);
          if (refTitle.trim()) rForm.append('title', refTitle.trim());
          if (refArtist.trim()) rForm.append('artist', refArtist.trim());
          if (refGenre.trim()) rForm.append('genre', refGenre.trim());
          ref = await fetcher<ReferenceDto>({ url: '/references/', method: 'POST', body: rForm });
        }
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
      // Story 3.2: presigned-first per file + one stage-keys registration;
      // any 501 (unconfigured S3, pre-AR20 version) falls back to the legacy
      // multi-file proxy stage for the WHOLE batch.
      setStatus('Uploading stems…');
      let staged: StageStemsResponse;
      try {
        const putItems: { stemId: string; key: string; fileName: string }[] = [];
        for (const [i, r] of stemRows.entries()) {
          const put = await uploadAttachmentPresigned({
            file: r.file,
            kind: 'stem',
            versionId: vid,
            onProgress: (l, t) =>
              setStatus(`Uploading stems… ${i + 1}/${stemRows.length} (${Math.round((100 * l) / t)}%)`),
          });
          putItems.push({ stemId: put.stemId ?? '', key: put.key, fileName: r.file.name });
        }
        staged = await fetcher<StageStemsResponse>({
          url: `/versions/${vid}/stems/stage-keys`,
          method: 'POST',
          data: { stems: putItems },
        });
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 501)) throw e;
        const stemForm = new FormData();
        for (const r of stemRows) stemForm.append('files', r.file, r.file.name);
        staged = await fetcher<StageStemsResponse>({
          url: `/versions/${vid}/stems/stage`,
          method: 'POST',
          body: stemForm,
        });
      }
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
        setUpgradeReason('cap');
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
  // Depth gates (UX-DR29). Stems + .als are Pro-tier inputs to a NEW analysis —
  // gating them here (not delivered reports) keeps results-forever intact (AR15).
  // Locked only once we positively know the tier lacks the feature.
  const stemsLocked = ents.data ? !ents.data.stemsEnabled : false;
  const alsLocked = ents.data ? !ents.data.alsEnabled : false;

  return (
    <>
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) reset();
        if (!next) setEntExhausted(false);
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={f.dialogOverlay} />
        <Dialog.Content className={`${f.dialogContent} ${s.unifiedContent}`}>
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
                  {/* ── Primary: the required mix drop-zone ── */}
                  <label
                    className={`${s.mixZone} ${mixDrag ? s.mixZoneActive : ''} ${
                      mix ? s.mixZoneFilled : ''
                    }`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setMixDrag(true);
                    }}
                    onDragLeave={() => setMixDrag(false)}
                    onDrop={onMixDrop}
                  >
                    <span className={s.mixZoneIcon} aria-hidden>
                      {mix ? '🎚️' : '⬆'}
                    </span>
                    {mix ? (
                      <span className={s.mixZoneTitle} title={mix.name}>
                        {mix.name}
                      </span>
                    ) : (
                      <span className={s.mixZoneTitle}>Drop your mix here, or click to choose</span>
                    )}
                    <span className={s.dropHint}>
                      {mix ? 'Click to replace · required' : 'WAV / FLAC / MP3 · required'}
                    </span>
                    <input
                      type="file"
                      accept=".wav,.flac,.mp3,.aiff,.aif,.m4a,.ogg,audio/*"
                      onChange={(e) => setMix(e.target.files?.[0] ?? null)}
                      style={{ display: 'none' }}
                    />
                  </label>

                  {/* ── Song association: only when not adding a version to a fixed song ── */}
                  {!songId && (
                    <div className={s.optionGroup}>
                      <label className={f.label}>
                        Song
                        <select
                          value={songChoice}
                          onChange={(e) => setSongChoice(e.target.value)}
                        >
                          <option value={NEW_SONG}>➕ New song…</option>
                          {(songs.data ?? [])
                            .filter((song) => song.archivedAt == null)
                            .map((song) => (
                              <option key={song.id} value={song.id}>
                                {song.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      {songChoice === NEW_SONG && (
                        <label className={f.label}>
                          New song name <span className={f.hint}>(optional)</span>
                          <input
                            type="text"
                            value={newSongName}
                            onChange={(e) => setNewSongName(e.target.value)}
                            placeholder="defaults to the mix filename"
                            maxLength={200}
                          />
                        </label>
                      )}
                    </div>
                  )}

                  {/* ── Genre hint select (UX-DR41) ── */}
                  <label className={f.label}>
                    Genre hint <span className={f.hint}>(optional)</span>
                    <select
                      value={genreCustom ? CUSTOM_GENRE : genre}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === CUSTOM_GENRE) {
                          setGenreCustom(true);
                          setGenre('');
                        } else {
                          setGenreCustom(false);
                          setGenre(v);
                        }
                      }}
                    >
                      <option value="">— none —</option>
                      {GENRE_HINTS.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                      <option value={CUSTOM_GENRE}>Other…</option>
                    </select>
                  </label>
                  {genreCustom && (
                    <input
                      type="text"
                      className={f.input}
                      value={genre}
                      onChange={(e) => setGenre(e.target.value)}
                      placeholder="Type a genre"
                      maxLength={50}
                      aria-label="Custom genre"
                    />
                  )}

                  {/* ── Encouraged: Ableton project (project-aware analysis) ── */}
                  <BlurLock
                    locked={alsLocked}
                    reason="Ableton project analysis is a Pro feature"
                    ctaLabel="Get Pro"
                    onUnlock={() => {
                      setUpgradeReason('feature');
                      setEntExhausted(true);
                    }}
                  >
                  <div className={`${s.optionGroup} ${s.zoneRecommended}`}>
                    <div className={s.optionHead}>
                      <p className={s.subhead}>
                        Ableton project <span className={s.recommendedTag}>Recommended</span>
                      </p>
                      <span className={s.benefitChip}>Track &amp; device-specific insights</span>
                    </div>
                    <p className={s.zoneLead}>
                      Drop your <b>.als</b> and SPECTR reads your tracks, devices, tempo and
                      arrangement — so feedback is tied to your actual project, not just the bounce.
                    </p>
                    {als ? (
                      <div className={s.fileChip}>
                        <span className={s.stemName} title={als.name}>
                          {als.name}
                        </span>
                        <button
                          type="button"
                          className={s.fileClear}
                          onClick={() => setAls(null)}
                          aria-label="Remove Ableton project"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <label
                        className={`${s.dropZone} ${s.dropZoneAccent}`}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={onAlsDrop}
                      >
                        <span>Drop .als here, or click to choose</span>
                        <span className={s.dropHint}>.als or gzip-compressed .als</span>
                        <input
                          type="file"
                          accept=".als,.gz"
                          onChange={(e) => setAls(e.target.files?.[0] ?? null)}
                          style={{ display: 'none' }}
                        />
                      </label>
                    )}
                    {als && (
                      <AlsPreviewPanel
                        preview={alsPreview}
                        loading={alsParsing}
                        error={alsPreviewError}
                      />
                    )}
                  </div>
                  </BlurLock>

                  {/* ── Optional: Reference track ── */}
                  <div className={s.optionHead}>
                    <p className={s.subhead}>Reference track</p>
                    <span className={s.benefitChip}>Compare your mix to a pro track</span>
                  </div>
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
                  ) : refFile ? (
                    <div className={s.fileChip}>
                      <span className={s.stemName} title={refFile.name}>
                        {refFile.name}
                      </span>
                      <button
                        type="button"
                        className={s.fileClear}
                        onClick={() => setRefFile(null)}
                        aria-label="Remove reference audio"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <label
                      className={s.dropZone}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={onRefDrop}
                    >
                      <span>Drop reference audio, or click to choose</span>
                      <span className={s.dropHint}>WAV / FLAC / MP3</span>
                      <input
                        type="file"
                        accept=".wav,.flac,.mp3,.aiff,.aif,.m4a,.ogg,audio/*"
                        onChange={(e) => setRefFile(e.target.files?.[0] ?? null)}
                        style={{ display: 'none' }}
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

                  {/* ── Advanced (de-emphasized): Stems ── */}
                  <BlurLock
                    locked={stemsLocked}
                    reason="Per-stem analysis is a Pro feature"
                    ctaLabel="Get Pro"
                    onUnlock={() => {
                      setUpgradeReason('feature');
                      setEntExhausted(true);
                    }}
                  >
                  <div className={s.advanced}>
                    <button
                      type="button"
                      className={s.advancedToggle}
                      aria-expanded={showStems}
                      onClick={() => setShowStems((v) => !v)}
                    >
                      <span className={s.advancedChevron} aria-hidden>
                        {showStems ? '▾' : '▸'}
                      </span>
                      Advanced: add stems
                      <span className={s.advancedHint}>
                        {stemRows.length > 0
                          ? `${stemRows.length} added`
                          : 'optional · per-stem balance & clash'}
                      </span>
                    </button>
                    {showStems && (
                      <div className={s.advancedBody}>
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
                      </div>
                    )}
                  </div>
                  </BlurLock>
                </>
              )}
            </div>

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
                  disabled={!mix || busy || ents.isLoading}
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

    {/* Cap-hit upgrade moment (UX-DR30). Opened by the client pre-check or the
        server 409 backstop. On a successful upgrade the kept `mix` resumes. */}
    <UpgradeSheet
      open={entExhausted}
      onOpenChange={setEntExhausted}
      analysesUsed={ents.data?.analysesUsed ?? 0}
      analysesLimit={ents.data?.analysesLimit ?? 0}
      {...(upgradeReason === 'feature'
        ? {
            title: 'Stems & Ableton projects are a Pro feature',
            description:
              'Upgrade to Pro to unlock per-stem balance, clash detection and project-aware analysis.',
          }
        : {})}
      onUpgraded={() => {
        setEntExhausted(false);
        // A feature-lock upgrade just unlocks the inputs — don't auto-fire the
        // upload; the cap-hit path resumes the kept mix as before.
        if (upgradeReason === 'cap') void runUpload();
      }}
    />
    </>
  );
}
