import * as Dialog from '@radix-ui/react-dialog';
import { useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import {
  useAddReferenceToSet,
  useCreateReferenceSet,
  useDeleteReference,
  useDeleteReferenceSet,
  useReferenceSets,
  useReferences,
  useRemoveReferenceFromSet,
} from '../../api/hooks';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ReferenceUploadDialog } from '../../components/ReferenceUploadDialog';
import f from '../../styles/forms.module.css';
import { ReferenceCard } from './ReferenceCard';
import { hueVar } from './hue';
import { ReferenceEditDialog } from './ReferenceEditDialog';
import r from './references.module.css';
import type { ReferenceDto, ReferenceSetDto } from '../../api/types';

type StatusFilter = 'all' | 'analyzed' | 'pending';

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'all' },
  { key: 'analyzed', label: 'analyzed' },
  { key: 'pending', label: 'pending' },
];

/** The "References" section of the library: the producer's saved reference
 *  tracks, grouped into collections (sets) and reusable as analysis targets. */
export function ReferenceLibrarySection() {
  const { data: refs, isLoading, error } = useReferences();
  const { data: setsData } = useReferenceSets();
  const sets = useMemo(() => setsData ?? [], [setsData]);

  const [setFilter, setSetFilter] = useState<string>('all'); // 'all' | setId
  const [status, setStatus] = useState<StatusFilter>('all');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [newSetOpen, setNewSetOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ReferenceDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ReferenceDto | null>(null);
  const [deleteSetTarget, setDeleteSetTarget] = useState<ReferenceSetDto | null>(null);

  const addToSet = useAddReferenceToSet();
  const removeFromSet = useRemoveReferenceFromSet();
  const deleteRef = useDeleteReference();
  const deleteSet = useDeleteReferenceSet();

  const list = useMemo(() => refs ?? [], [refs]);

  const statusCounts = useMemo(() => {
    const base = list.filter((x) => setFilter === 'all' || x.setIds.includes(setFilter));
    return {
      all: base.length,
      analyzed: base.filter((x) => x.analyzed).length,
      pending: base.filter((x) => !x.analyzed).length,
    } satisfies Record<StatusFilter, number>;
  }, [list, setFilter]);

  const filtered = useMemo(() => {
    return list.filter((x) => {
      if (setFilter !== 'all' && !x.setIds.includes(setFilter)) return false;
      if (status === 'analyzed' && !x.analyzed) return false;
      if (status === 'pending' && x.analyzed) return false;
      return true;
    });
  }, [list, setFilter, status]);

  const toggleSet = (referenceId: string, setId: string, isMember: boolean) => {
    const m = isMember ? removeFromSet : addToSet;
    m.mutate(
      { setId, referenceId },
      {
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : 'Could not update collection'),
      },
    );
  };

  if (isLoading) {
    return <p className={`mono ${r.status}`}>Loading references…</p>;
  }
  if (error) {
    return (
      <p className={r.error}>
        Could not load references: {error instanceof Error ? error.message : String(error)}
      </p>
    );
  }

  const analyzedCount = list.filter((x) => x.analyzed).length;

  return (
    <>
      <div className={r.header}>
        <div className={r.headerText}>
          <h1 className={r.title}>Reference tracks</h1>
          <p className={r.subtitle}>
            {list.length} {list.length === 1 ? 'reference' : 'references'} · {analyzedCount} analyzed
            {sets.length > 0 ? ` · ${sets.length} ${sets.length === 1 ? 'set' : 'sets'}` : ''}
          </p>
        </div>
        <div className={r.actions}>
          <button type="button" className="btn primary" onClick={() => setUploadOpen(true)}>
            + Add reference
          </button>
        </div>
      </div>

      <div className={r.setsBar}>
        <button
          type="button"
          className={r.setChip}
          data-active={setFilter === 'all'}
          onClick={() => setSetFilter('all')}
        >
          all references
          <span className={r.setChipCount}>{list.length}</span>
        </button>
        {sets.map((st) => (
          <button
            key={st.id}
            type="button"
            className={r.setChip}
            data-active={setFilter === st.id}
            style={hueVar(st.hue)}
            onClick={() => setSetFilter(st.id)}
          >
            <span className={r.setDot} />
            {st.name}
            <span className={r.setChipCount}>{st.memberCount}</span>
            <span
              role="button"
              tabIndex={0}
              className={r.setChipRemove}
              title="Delete collection"
              onClick={(e) => { e.stopPropagation(); setDeleteSetTarget(st); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  setDeleteSetTarget(st);
                }
              }}
            >
              ×
            </span>
          </button>
        ))}
        <button type="button" className={r.newSetBtn} onClick={() => setNewSetOpen(true)}>
          + New set
        </button>
      </div>

      <div className={r.filters}>
        {STATUS_FILTERS.map((sf) => (
          <button
            key={sf.key}
            type="button"
            className={r.filterPill}
            data-active={status === sf.key}
            onClick={() => setStatus(sf.key)}
          >
            {sf.label}
            <span className={r.filterPillCount}>{statusCounts[sf.key]}</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className={r.empty}>
          <p className={r.emptyTitle}>
            {list.length === 0 ? 'No reference tracks yet.' : 'No references match this filter.'}
          </p>
          <p className={`mono ${r.emptySubtitle}`}>
            {list.length === 0
              ? 'Add a pro track in your genre to compare your mixes against.'
              : 'Try a different collection or status filter.'}
          </p>
          {list.length === 0 && (
            <button
              type="button"
              className={`btn primary ${r.emptyAction}`}
              onClick={() => setUploadOpen(true)}
            >
              + Add reference
            </button>
          )}
        </div>
      ) : (
        <div className={r.grid}>
          {filtered.map((reference) => (
            <ReferenceCard
              key={reference.id}
              reference={reference}
              sets={sets}
              onEdit={() => setEditTarget(reference)}
              onDelete={() => setDeleteTarget(reference)}
              onToggleSet={(setId, isMember) => toggleSet(reference.id, setId, isMember)}
            />
          ))}
        </div>
      )}

      <ReferenceUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />

      <NewSetDialog open={newSetOpen} onOpenChange={setNewSetOpen} />

      {editTarget && (
        <ReferenceEditDialog
          reference={editTarget}
          open={editTarget !== null}
          onOpenChange={(v) => { if (!v) setEditTarget(null); }}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}
        title="Delete reference"
        description={`Delete "${deleteTarget?.title}"? This removes it from your library and any collections. This cannot be undone.`}
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await deleteRef.mutateAsync(deleteTarget.id);
            toast.success(`"${deleteTarget.title}" deleted`);
          } catch {
            toast.error('Could not delete reference');
          }
        }}
        isPending={deleteRef.isPending}
      />

      <ConfirmDialog
        open={deleteSetTarget !== null}
        onOpenChange={(v) => { if (!v) setDeleteSetTarget(null); }}
        title="Delete collection"
        description={`Delete the "${deleteSetTarget?.name}" collection? The references stay in your library; only the grouping is removed.`}
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          if (!deleteSetTarget) return;
          try {
            await deleteSet.mutateAsync(deleteSetTarget.id);
            if (setFilter === deleteSetTarget.id) setSetFilter('all');
            toast.success(`"${deleteSetTarget.name}" deleted`);
          } catch {
            toast.error('Could not delete collection');
          }
        }}
        isPending={deleteSet.isPending}
      />
    </>
  );
}

/** Compact create-collection dialog (name + optional hue). */
function NewSetDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [name, setName] = useState('');
  const [hue, setHue] = useState(168);
  const create = useCreateReferenceSet();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) {
      toast.error('Name is required');
      return;
    }
    try {
      await create.mutateAsync({ name: n, hue });
      toast.success(`Collection "${n}" created`);
      setName('');
      setHue(168);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create collection');
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={f.dialogOverlay} />
        <Dialog.Content className={f.dialogContent}>
          <Dialog.Title className={f.dialogTitle}>New collection</Dialog.Title>
          <Dialog.Description className={f.dialogDescription}>
            Group references (e.g. by genre or project) for quick filtering.
          </Dialog.Description>
          <form onSubmit={submit} className={f.field}>
            <label className={f.label}>
              Name
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                required
                autoFocus
                disabled={create.isPending}
              />
            </label>
            <label className={f.label}>
              Color
              <input
                type="range"
                min={0}
                max={360}
                value={hue}
                onChange={(e) => setHue(Number(e.target.value))}
                disabled={create.isPending}
                style={{ accentColor: `hsl(${hue} 70% 60%)` }}
              />
            </label>
            <div className={f.dialogActions}>
              <Dialog.Close asChild>
                <button type="button" className={f.button} disabled={create.isPending}>
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="submit"
                disabled={create.isPending}
                className={`${f.button} ${f.buttonPrimary}`}
              >
                {create.isPending ? 'Creating…' : 'Create'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
