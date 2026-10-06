import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type Bin,
  type Project,
  type Rect,
  PALETTE,
  binById,
  binName,
  binsAtLevel,
  blockedAtLevel,
  canStackOn,
  childrenOf,
  cloneDividers,
  collidesAny,
  defaultProject,
  findFreeSlot,
  maxLevel,
  parentCandidateFor,
  shelveBin,
  spansParent,
  usableBounds,
  binLevel,
} from '@/lib/binbench/model';
import { downloadBin3MF, downloadBinSTL, triggerDownload } from '@/lib/binbench/exporters';
import { loadProjectText, projectFileName, serializeProject } from '@/lib/binbench/project-io';
import { type Draft, type Editing, clampDividers, cloneDraft, draftLevel } from './draft';
import { type LengthUnit, makeUnits, safeLocalGet, safeLocalSet } from './units';
import DrawerCanvas from './DrawerCanvas';
import BinEditor from './BinEditor';
import Preview3D from './Preview3D';
import SettingsPanels from './SettingsPanels';
import { BinList, ObstructionList, ShelfList } from './ListPanels';
import { BaseplateSections, PlatePacking } from './PlatePanels';
import Tour from './Tour';

// File System Access API — Chrome/Edge only, so typed loosely
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FileHandle = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fsWin = () => window as any;
const PICKER_TYPES = [{ description: 'Bin Bench project', accept: { 'application/json': ['.json'] } }];

type Clip = Pick<Bin, 'w' | 'd' | 'heightMM' | 'label' | 'dividersX' | 'dividersY'>;

/** the pocket is cut into the plate, so the plate must be thicker than the foot */
function normalize(p: Project): Project {
  return p.baseThick < p.footH + 1 ? { ...p, baseThick: p.footH + 1 } : p;
}

export default function BinBenchApp() {
  const [project, setProject] = useState<Project>(defaultProject);
  const [lengthUnit, setLengthUnit] = useState<LengthUnit>(() => (safeLocalGet('binBenchUnit') === 'in' ? 'in' : 'mm'));
  const units = useMemo(() => makeUnits(lengthUnit), [lengthUnit]);
  const [dirty, setDirty] = useState(false);
  const fileHandle = useRef<FileHandle>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [status, setStatusState] = useState({ msg: '', err: false });
  const statusTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [mode, setMode] = useState<'design' | 'block'>('design');
  const [activeLevelRaw, setActiveLevel] = useState(1);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [editorError, setEditorError] = useState('');
  const clipboard = useRef<Clip | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const [layout, setLayout] = useState<{ svg: SVGSVGElement | null; scale: number }>({ svg: null, scale: 1 });
  const openInput = useRef<HTMLInputElement>(null);
  const canWriteFiles = typeof window !== 'undefined' && typeof fsWin().showSaveFilePicker === 'function';

  const p = project;
  // deleting a stack can leave the selected level out of range
  const topLevel = p.bins.length ? maxLevel(p) + 1 : 1;
  const activeLevel = Math.min(Math.max(1, activeLevelRaw || 1), topLevel);

  const setStatus = useCallback((msg: string, err = false) => {
    setStatusState({ msg, err });
    clearTimeout(statusTimer.current);
    if (msg) statusTimer.current = setTimeout(() => setStatusState((s) => (s.msg === msg ? { msg: '', err: false } : s)), 4000);
  }, []);

  const commitProject = useCallback((next: Project) => {
    setProject(normalize(next));
    setDirty(true);
  }, []);
  const update = (patch: Partial<Project>) => commitProject({ ...p, ...patch });
  const closeEditor = () => {
    setEditing(null);
    setDraft(null);
    setEditorError('');
  };

  useEffect(() => {
    if (!safeLocalGet('binBenchTutorialSeen')) setTourOpen(true);
  }, []);

  // ---------- bins ----------
  const openEditorForBin = (bin: Bin) => {
    setDraft({ x: bin.x, y: bin.y, w: bin.w, d: bin.d, heightMM: bin.heightMM, dividersX: cloneDividers(bin.dividersX), dividersY: cloneDividers(bin.dividersY), label: bin.label });
    setEditing({ mode: 'edit', id: bin.id, color: bin.color });
    setEditorError('');
  };

  const commitEditor = () => {
    if (!draft || !editing) return;
    const d = cloneDraft(draft);
    clampDividers(d, p.wall);
    const bnd = usableBounds(p);
    let w = Math.max(1, d.w), dd = Math.max(1, d.d);
    const h = Math.max(1, Math.round(d.heightMM));
    // clamp the footprint into the usable drawer so it can never "extend outside"
    const x = Math.min(Math.max(d.x, bnd.minX), bnd.maxX - 1);
    const y = Math.min(Math.max(d.y, bnd.minY), bnd.maxY - 1);
    w = Math.min(w, bnd.maxX - x);
    dd = Math.min(dd, bnd.maxY - y);
    const rect = { x, y, w, d: dd };
    const excludeId = editing.mode === 'edit' ? editing.id ?? null : null;
    const level = draftLevel(p, editing, activeLevel);
    if (collidesAny(p, rect, excludeId, level)) {
      setEditorError(blockedAtLevel(p, rect, level)
        ? 'That overlaps an obstruction tall enough to reach this level.'
        : 'Too close to another bin — keep at least ' + units.fmt(p.minGap) + ' between them.');
      return;
    }
    // an upper-level bin has to land on a bin below and bridge it wall to wall
    let parentId: number | null = null;
    if (level > 1) {
      const parent = parentCandidateFor(p, rect, level);
      if (!parent) return setEditorError('A level ' + level + ' bin has to sit fully on top of one level ' + (level - 1) + ' bin.');
      if (!spansParent(rect, parent))
        return setEditorError('A stacked bin has to run the full ' + units.fmt(parent.w) + ' width or full ' + units.fmt(parent.d) +
          ' depth of "' + binName(parent) + '" underneath it — otherwise nothing carries its ends.');
      parentId = parent.id;
    }
    const payload = { ...rect, heightMM: h, parentId, dividersX: d.dividersX, dividersY: d.dividersY, label: (d.label || '').trim() };
    let next: Project;
    if (editing.mode === 'new') {
      const id = p.binCounter + 1;
      next = { ...p, binCounter: id, bins: [...p.bins, { id, color: editing.color, ...payload }] };
    } else {
      next = { ...p, bins: p.bins.map((b) => (b.id === editing.id ? { ...b, ...payload } : b)) };
      // anything stacked on this bin has to still be a legal strip afterwards — one that
      // no longer fits gets shelved rather than silently dropped to the floor
      const b = binById(next, editing.id)!;
      const orphans = childrenOf(next, b.id).filter((c) => !canStackOn(c, b));
      orphans.forEach((c) => {
        const live = binById(next, c.id);
        if (live) next = shelveBin(next, live).project;
      });
      if (orphans.length)
        setStatus('Resizing "' + binName(b) + '" no longer supports ' + orphans.length + ' bin(s) stacked on it — moved to Shelved bins.', true);
    }
    commitProject(next);
    closeEditor();
  };

  const moveBin = (id: number, x: number, y: number) => {
    const bin = binById(p, id);
    if (!bin) return;
    if (collidesAny(p, { x, y, w: bin.w, d: bin.d }, id, binLevel(p, bin))) return; // snap back
    commitProject({ ...p, bins: p.bins.map((b) => (b.id === id ? { ...b, x, y } : b)) });
  };

  const removeBin = (bin: Bin) => {
    const { project: next, count } = shelveBin(p, bin);
    commitProject(next);
    if (editing?.mode === 'edit' && !binById(next, editing.id)) closeEditor();
    const extra = count - 1;
    setStatus('Removed "' + binName(bin) + '"' + (extra ? ' and the ' + extra + ' bin(s) stacked on it' : '') + ' — find it under Shelved bins to add it back.');
  };

  const copyBin = (bin: Bin) => {
    clipboard.current = { w: bin.w, d: bin.d, heightMM: bin.heightMM, label: bin.label, dividersX: cloneDividers(bin.dividersX), dividersY: cloneDividers(bin.dividersY) };
    setStatus('Copied "' + binName(bin) + '" — paste with Ctrl/Cmd+V');
  };

  const placeNewBin = (src: Clip & { color?: string }, hintX: number | null, hintY: number | null, label: string) => {
    const slot = findFreeSlot(p, src.w, src.d, hintX, hintY);
    if (!slot) return null;
    const id = p.binCounter + 1;
    const bin: Bin = {
      id, color: src.color ?? PALETTE[p.bins.length % PALETTE.length], x: slot.x, y: slot.y, w: src.w, d: src.d,
      heightMM: src.heightMM, label, parentId: null, dividersX: cloneDividers(src.dividersX), dividersY: cloneDividers(src.dividersY),
    };
    return { bin, next: { ...p, binCounter: id, bins: [...p.bins, bin] } };
  };

  const pasteBin = () => {
    const c = clipboard.current;
    if (!c) { setStatus('Nothing copied yet — use Copy on a bin first.', true); return false; }
    const hint = p.bins.find((b) => b.label === c.label);
    const r = placeNewBin(c, hint ? hint.x : null, hint ? hint.y : null, c.label ? c.label + ' copy' : '');
    if (!r) { setStatus('No free space to paste this bin — make room or shrink it.', true); return false; }
    commitProject(r.next);
    setActiveLevel(1);
    openEditorForBin(r.bin);
    setStatus('Pasted a copy — drag it or edit the fields to reposition.');
    return true;
  };

  const restoreShelved = (shelfId: number) => {
    const s = p.shelvedBins.find((b) => b.shelfId === shelfId);
    if (!s) return;
    const r = placeNewBin(s, s.lastX, s.lastY, s.label);
    if (!r) return setStatus('No free space to add it back — make room or shrink it first.', true);
    commitProject({ ...r.next, shelvedBins: p.shelvedBins.filter((b) => b.shelfId !== shelfId) });
    setActiveLevel(1);
    openEditorForBin(r.bin);
    setStatus('Added "' + binName(r.bin) + '" back to the drawer.');
  };

  const addObstruction = (r?: Rect) => {
    const bnd = usableBounds(p);
    const rect = r ?? {
      x: bnd.minX + 4, y: bnd.minY + 4,
      w: Math.min(40, Math.max(10, (bnd.maxX - bnd.minX) / 6)),
      d: Math.min(40, Math.max(10, (bnd.maxY - bnd.minY) / 6)),
    };
    const id = p.blockCounter + 1;
    commitProject({ ...p, blockCounter: id, blocked: [...p.blocked, { id, label: '', ...rect, h: p.drawer.h }] });
    if (!r) setStatus('Added an obstruction — set its exact size, position, and height in the list.');
  };

  // ---------- project files ----------
  const markSaved = (name: string | null) => {
    setDirty(false);
    setFileName(name);
  };
  const binCountLabel = () => p.bins.length + ' bin' + (p.bins.length === 1 ? '' : 's');

  const saveAs = async () => {
    const text = serializeProject(p);
    if (canWriteFiles) {
      try {
        const handle = await fsWin().showSaveFilePicker({ suggestedName: projectFileName(p), types: PICKER_TYPES });
        const wr = await handle.createWritable();
        await wr.write(text);
        await wr.close();
        fileHandle.current = handle;
        markSaved(handle.name);
        setStatus('Saved ' + binCountLabel() + ' to ' + handle.name);
        return;
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return; // cancelled — don't also download
      }
    }
    triggerDownload(new Blob([text], { type: 'application/json' }), projectFileName(p));
    fileHandle.current = null;
    markSaved(null);
    setStatus('Downloaded ' + projectFileName(p));
  };
  const save = async () => {
    const h = fileHandle.current;
    if (!h) return saveAs();
    try {
      const wr = await h.createWritable();
      await wr.write(serializeProject(p));
      await wr.close();
      markSaved(h.name);
      setStatus('Updated ' + h.name + ' (' + binCountLabel() + ')');
    } catch {
      fileHandle.current = null;
      setStatus('Could not write to that file — saving a copy instead.', true);
      void saveAs();
    }
  };
  const loadText = (text: string, source: string, handle: FileHandle = null) => {
    try {
      const r = loadProjectText(text, source, p);
      setProject(normalize(r.project));
      closeEditor();
      setActiveLevel(1);
      fileHandle.current = handle;
      markSaved(handle ? handle.name : null);
      setStatus(r.msg, r.err);
      return true;
    } catch (err) {
      setStatus((err as Error).message, true);
      return false;
    }
  };
  const open = async () => {
    if (canWriteFiles && typeof fsWin().showOpenFilePicker === 'function') {
      let handle: FileHandle = null;
      try {
        [handle] = await fsWin().showOpenFilePicker({ types: PICKER_TYPES });
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        handle = null; // picker blocked — use <input> instead
      }
      if (handle) {
        try {
          const file = await handle.getFile();
          loadText(await file.text(), handle.name, handle);
        } catch (err) {
          setStatus('Could not read that file: ' + (err as Error).message, true);
        }
        return;
      }
    }
    openInput.current?.click();
  };
  const copyJson = async () => {
    const text = serializeProject(p);
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Copied project JSON (' + binCountLabel() + ') to clipboard');
      return null;
    } catch {
      setStatus('Clipboard blocked — copy the text below manually.', true);
      return text;
    }
  };

  // ---------- keyboard + unload ----------
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || tourOpen) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); void save(); return; }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName || '');
    if (typing || window.getSelection()?.toString()) return;
    if (k === 'c') {
      // copy the bin open in the editor, else the last-added bin
      const bin = editing?.mode === 'edit' ? binById(p, editing.id) : p.bins[p.bins.length - 1];
      if (bin) { copyBin(bin); e.preventDefault(); }
    }
    if (k === 'v' && pasteBin()) e.preventDefault();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty && project.bins.length) e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty, project.bins.length]);

  const projBadge = (dirty ? '● ' : '') + (fileName ?? 'no file') + ' · ' + binCountLabel();
  const here = binsAtLevel(p, activeLevel).length;

  return (
    <div className="min-h-screen bg-base-300 text-[14px] text-base-content">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:px-7" style={{ borderColor: 'var(--bb-line)' }}>
        <p className="font-mono text-[12.5px]" style={{ color: 'var(--bb-dim)' }}>
          drag to size a bin, tune it to the mm, export straight to Bambu Studio
        </p>
        <button type="button" className="bb-btn bb-btn-xs" title="Replay the guided tour" onClick={() => setTourOpen(true)}>Tutorial</button>
      </div>

      <div className="grid items-start gap-4 p-4 lg:grid-cols-[330px_minmax(0,1fr)]">
        <aside className="min-w-0">
          <SettingsPanels
            project={p} units={units} update={update} projBadge={projBadge} status={status} setStatus={setStatus}
            canWriteFiles={canWriteFiles} onSave={() => void save()} onSaveAs={() => void saveAs()} onOpen={() => void open()}
            onCopyJson={copyJson} onLoadText={(t) => loadText(t, 'pasted JSON')}
            onUnitChange={(u) => { setLengthUnit(u); safeLocalSet('binBenchUnit', u); }}
          />
          <input ref={openInput} type="file" accept="application/json,.json" className="hidden" onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            file.text().then((t) => loadText(t, file.name), () => setStatus('Could not read that file.', true));
          }} />
          <BinList project={p} units={units} onEdit={(b) => { setActiveLevel(binLevel(p, b)); openEditorForBin(b); }} onCopy={copyBin}
            onSTL={(b) => downloadBinSTL(p, b)} on3MF={(b) => void downloadBin3MF(p, b)} onRemove={removeBin}
            onClear={() => { commitProject({ ...p, bins: [], blocked: [] }); closeEditor(); }} />
          <ObstructionList project={p} units={units} onAdd={() => addObstruction()}
            onChange={(id, patch) => commitProject({ ...p, blocked: p.blocked.map((b) => (b.id === id ? { ...b, ...patch } : b)) })}
            onDelete={(id) => commitProject({ ...p, blocked: p.blocked.filter((b) => b.id !== id) })} />
          <ShelfList project={p} units={units} onRestore={restoreShelved}
            onDelete={(id) => commitProject({ ...p, shelvedBins: p.shelvedBins.filter((s) => s.shelfId !== id) })} />
        </aside>

        <main className="min-w-0">
          <section className="bb-panel mb-3.5 px-4 py-3.5" data-tour="canvas">
            <div className="mb-2.5 flex gap-1.5" role="group" aria-label="Grid mode">
              {(['design', 'block'] as const).map((m) => (
                <button key={m} type="button" aria-pressed={mode === m}
                  className={'bb-btn flex-1 ' + (mode === m ? 'bb-btn-primary' : '')}
                  onClick={() => { setMode(m); closeEditor(); }}>
                  {m === 'design' ? 'Draft bins' : 'Mark obstruction'}
                </button>
              ))}
            </div>
            <h2 className="bb-h mb-1.5">
              Drawer layout <span className="bb-mono-dim">— {units.fmt(p.drawer.w)}×{units.fmt(p.drawer.d)} interior</span>
            </h2>
            <div className="mb-2 flex flex-wrap items-center gap-2.5">
              <span className="bb-label mb-0 font-semibold">Level</span>
              <div className="flex flex-wrap gap-1" role="tablist" aria-label="Stack level">
                {Array.from({ length: topLevel }, (_, i) => i + 1).map((n) => {
                  const isNew = p.bins.length > 0 && n === topLevel;
                  return (
                    <button key={n} type="button" role="tab" aria-selected={n === activeLevel}
                      title={isNew ? 'Start a new level on top' : binsAtLevel(p, n).length + ' bin(s) on level ' + n}
                      className={'min-w-[30px] cursor-pointer rounded-field border px-2.5 py-1 font-mono text-xs ' +
                        (n === activeLevel ? 'font-bold text-primary-content' : 'hover:text-base-content') + (isNew ? ' font-bold' : '')}
                      style={n === activeLevel
                        ? { background: 'var(--bb-measure)', borderColor: 'var(--bb-measure)' }
                        : { background: 'var(--bb-panel-2)', borderColor: 'var(--bb-line)', color: 'var(--bb-dim)' }}
                      onClick={() => { setActiveLevel(n); closeEditor(); }}>
                      {isNew ? '+' + n : n}
                    </button>
                  );
                })}
              </div>
              <span className="font-mono text-[11px]" style={{ color: 'var(--bb-dim)' }}>
                {activeLevel === 1
                  ? here + ' bin(s) on the drawer floor'
                  : here + ' bin(s) stacked here · must span a level ' + (activeLevel - 1) + ' bin wall to wall'}
              </span>
            </div>
            <DrawerCanvas
              project={p} units={units} mode={mode} activeLevel={activeLevel} draft={draft} editing={editing}
              onDraftChange={(d) => { setDraft(d); setEditorError(''); }}
              onBeginEdit={setEditing} onCloseEditor={closeEditor} onOpenBin={openEditorForBin} onMoveBin={moveBin}
              onAddObstruction={addObstruction}
              onDeleteObstruction={(id) => commitProject({ ...p, blocked: p.blocked.filter((b) => b.id !== id) })}
              onLayout={(svg, scale) => setLayout((l) => (l.svg === svg && l.scale === scale ? l : { svg, scale }))}
            />
            <p className="bb-hint">
              Drag an empty area to draft a bin. While a bin is selected: drag its corners to resize, drag a divider's <b>bar</b> to slide
              it, or drag a divider's <b>round end caps</b> to trim where it starts and stops — ends snap to the walls and to any
              perpendicular divider they meet. Each divider has its own <b>height</b> — dashed lines mean a partial-height divider. Bins
              snap to the drawer walls and to each other at the minimum gap (green guide). Click a placed bin to edit it; drag it to move
              it. <b>Copy</b> a bin (button, or Ctrl/Cmd+C) and <b>paste</b> it (Ctrl/Cmd+V) to duplicate it into the next free spot. Use
              the <b>Level</b> tabs to stack: a stacked bin has to run the <b>full width or full depth</b> of the one under it — an open
              box can only carry weight on its rim walls.
            </p>
          </section>

          <Preview3D project={p} />
          <PlatePacking project={p} onStatus={setStatus} />
          <BaseplateSections project={p} units={units} onStatus={setStatus} onStackGap={(v) => update({ stackGap: v })} />
        </main>
      </div>

      {draft && editing && (
        <BinEditor project={p} units={units} draft={draft} editing={editing} error={editorError} setError={setEditorError}
          onChange={setDraft} onCommit={commitEditor} onCancel={closeEditor} layout={layout}
          onRemove={() => { const b = editing.id != null ? binById(p, editing.id) : null; if (b) removeBin(b); closeEditor(); }} />
      )}
      <Tour open={tourOpen} onClose={() => { setTourOpen(false); safeLocalSet('binBenchTutorialSeen', '1'); }} />
    </div>
  );
}
