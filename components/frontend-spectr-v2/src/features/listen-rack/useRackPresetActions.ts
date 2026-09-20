/* Listen Rack v2 — server-backed preset list + the save/recall/export/import
 * handlers. Moved verbatim out of ListenRackPage on 2026-09-19 to get that
 * file back under the line limit (spec D10) — no behaviour change.
 *
 * The hidden <input type="file"> stays in the page; this hook owns its ref and
 * its change handler so the page keeps one line instead of twenty.
 */
import { useCallback, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import type { ChangeEvent, RefObject } from 'react';

import type { Chain } from './chain';
import type { ModuleState } from './data';
import type { RackPreset, RackState } from './rackState';
import {
  asChain, buildExportEnvelope, parseImportEnvelope, useRackPresets, useSaveRackPreset,
} from './useRackPresets';

export interface RackPresetActions {
  items: RackPreset[];
  onSave: () => void;
  onRecall: (id: string) => void;
  /** undefined on the mock demo route — the toolbar hides the button. */
  onExport: (() => void) | undefined;
  onImport: (() => void) | undefined;
  importRef: RefObject<HTMLInputElement | null>;
  onImportFile: (e: ChangeEvent<HTMLInputElement>) => Promise<void>;
}

export function useRackPresetActions({ versionId, realAudio, rs, currentChain }: {
  versionId: string | undefined;
  realAudio: boolean;
  rs: RackState;
  currentChain: Chain;
}): RackPresetActions {
  const { data: rackPresetDtos } = useRackPresets(realAudio ? (versionId ?? '') : '');
  const saveRackPresetMut = useSaveRackPreset(versionId ?? '');
  const serverRackPresets = useMemo<RackPreset[]>(() => (rackPresetDtos ?? []).flatMap((d) => {
    const chain = asChain(d.chain);
    if (!chain) return [];
    return [{
      id: d.id, name: d.name, by: d.source, order: chain.order,
      mod: chain.modules as Record<string, ModuleState>,
      n: Object.values(chain.modules).filter((s) => s?.enabled).length,
    }];
  }), [rackPresetDtos]);

  // Unified preset handlers — server on the real route, in-memory on mock.
  const onSave = useCallback(() => {
    if (realAudio) {
      saveRackPresetMut.mutate({ name: `Preset ${serverRackPresets.length + 1}`, chain: currentChain });
    } else {
      rs.savePreset('you');
    }
  }, [realAudio, saveRackPresetMut, serverRackPresets.length, currentChain, rs]);

  const onRecall = useCallback((id: string) => {
    if (realAudio) {
      const dto = rackPresetDtos?.find((x) => x.id === id);
      const chain = dto ? asChain(dto.chain) : null;
      if (!dto || !chain) return;
      rs.recallPreset({
        id: dto.id, name: dto.name, by: dto.source, order: chain.order,
        mod: chain.modules as Record<string, ModuleState>, n: 0,
      });
      rs.setMasterBypass(chain.masterBypass);
    } else {
      const p = rs.presets.find((x) => x.id === id);
      if (p) rs.recallPreset(p);
    }
  }, [realAudio, rackPresetDtos, rs]);

  const items = realAudio ? serverRackPresets : rs.presets;

  // JSON export/import — the portability path (real route only).
  const importRef = useRef<HTMLInputElement | null>(null);
  const onExport = useCallback(() => {
    const envelope = buildExportEnvelope(`Preset ${items.length + 1}`, currentChain);
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'rack-preset.json'; a.click();
    URL.revokeObjectURL(url);
  }, [items.length, currentChain]);

  const onImportFile = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { name, chain } = parseImportEnvelope(await file.text());
      saveRackPresetMut.mutate({ name, chain }, { onSuccess: () => toast.success(`Imported "${name}".`) });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed.');
    }
  }, [saveRackPresetMut]);

  const openImport = useCallback(() => importRef.current?.click(), []);

  return {
    items,
    onSave,
    onRecall,
    onExport: realAudio ? onExport : undefined,
    onImport: realAudio ? openImport : undefined,
    importRef,
    onImportFile,
  };
}
