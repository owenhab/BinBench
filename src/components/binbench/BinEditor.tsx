import { useLayoutEffect, useRef, useState } from 'react';
import { type Project, divH, evenDividers, usableBounds } from '@/lib/binbench/model';
import { type Draft, type Editing, addDivider, clampDividers, cloneDraft, setDraftSize } from './draft';
import { LengthField, UnitSuffix } from './fields';
import { ORIGIN_X, ORIGIN_Y } from './DrawerCanvas';
import type { Units } from './units';

interface Props {
  project: Project;
  units: Units;
  draft: Draft;
  editing: Editing;
  error: string;
  setError: (s: string) => void;
  onChange: (d: Draft) => void;
  onCommit: () => void;
  onCancel: () => void;
  onRemove: () => void;
  layout: { svg: SVGSVGElement | null; scale: number };
}

export default function BinEditor({ project: p, units, draft, editing, error, setError, onChange, onCommit, onCancel, onRemove, layout }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: -9999, top: 0 });
  const [cols, setCols] = useState(1);
  const [rows, setRows] = useState(1);
  const [allH, setAllH] = useState('');
  const isEdit = editing.mode === 'edit';
  const u = <UnitSuffix units={units} />;

  // Prefer just to the right of the bin; if it won't fit, try left, then pin to the
  // viewport. Re-measured after every change since divider rows change its height.
  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current, svg = layout.svg;
      if (!el || !svg) return;
      const r = svg.getBoundingClientRect();
      const s = layout.scale;
      const x = ORIGIN_X + draft.x * s, y = ORIGIN_Y + draft.y * s, w = draft.w * s;
      const tw = el.offsetWidth || 270, th = el.offsetHeight || 240;
      const M = 8, vw = window.innerWidth, vh = window.innerHeight;
      let left = r.left + x + w + 12;
      if (left + tw + M > vw) left = r.left + x - tw - 12;
      if (left < M) left = Math.max(M, vw - tw - M);
      left = Math.min(Math.max(left, M), vw - tw - M);
      let top = r.top + y;
      top = Math.min(Math.max(top, M), vh - th - M);
      if (th + 2 * M > vh) top = M;
      setPos((old) => (old.left === left && old.top === top ? old : { left, top }));
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  });

  const edit = (fn: (d: Draft) => void) => {
    const n = cloneDraft(draft);
    fn(n);
    setError('');
    onChange(n);
  };

  // W/D are clamped so they can never produce an "extends outside" error: if the typed
  // size won't fit from here, slide the origin toward the near wall to make room.
  const setSize = (axis: 'w' | 'd', mm: number | null) => {
    if (mm == null || !(mm > 0)) return;
    const n = cloneDraft(draft);
    const bnd = usableBounds(p);
    const requested = mm;
    let v = mm;
    const limit = () => (axis === 'w' ? bnd.maxX - n.x : bnd.maxY - n.y);
    if (v > limit() + 0.001) {
      if (axis === 'w') n.x -= Math.min(v - limit(), n.x - bnd.minX);
      else n.y -= Math.min(v - limit(), n.y - bnd.minY);
      v = Math.min(v, limit());
    }
    setDraftSize(n, axis === 'w' ? v : n.w, axis === 'd' ? v : n.d);
    clampDividers(n, p.wall);
    setError(v < requested - 0.05 ? 'Capped to ' + units.fmt(v) + " — that's the most that fits from here." : '');
    onChange(n);
  };

  // live print-plate check: the bin body must fit the bed; its baseplate pocket may
  // spill across tiles, which is fine but worth saying
  const msgs: string[] = [];
  const rimAllow = p.fitClear + p.ringW, pad = 4;
  const maxTileW = p.bed.x - pad * 2, maxTileD = p.bed.y - pad * 2;
  const bodyFits = (draft.w <= p.bed.x && draft.d <= p.bed.y) || (draft.d <= p.bed.x && draft.w <= p.bed.y);
  if (!bodyFits) {
    msgs.push('⚠ This bin (' + units.fmt(draft.w) + '×' + units.fmt(draft.d) + ') is larger than the ' + units.fmt(p.bed.x) + '×' +
      units.fmt(p.bed.y) + " build plate and can't be printed in one piece.");
  } else {
    const pw = draft.w + 2 * rimAllow, pd = draft.d + 2 * rimAllow;
    if (!((pw <= maxTileW && pd <= maxTileD) || (pd <= maxTileW && pw <= maxTileD)))
      msgs.push('Its baseplate pocket is wider than one plate, so the baseplate under it will be split across tiles (the bin still prints in one piece).');
  }
  const printH = p.footH + p.floor + draft.heightMM;
  if (printH > p.bed.z) msgs.push('⚠ Printed height ' + units.fmt(printH) + ' exceeds the ' + units.fmt(p.bed.z) + ' Z height.');
  const infoOk = bodyFits && printH <= p.bed.z;

  const divRow = (axis: 'x' | 'y', i: number) => {
    const arr = axis === 'x' ? draft.dividersX : draft.dividersY;
    const dv = arr[i];
    const set = (key: 'p' | 'a' | 'b' | 'h', mm: number | null) => {
      if (mm == null) return;
      edit((n) => {
        const t = axis === 'x' ? n.dividersX : n.dividersY;
        // at or above the bin height means "full height" — track the bin from then on
        if (key === 'h') t[i].h = mm >= n.heightMM - 0.01 ? null : Math.max(0.4, mm);
        else t[i][key] = mm;
      });
    };
    return (
      <div key={axis + i} className="mb-1.5 rounded-field border px-1.5 pt-1.5 pb-0.5" style={{ borderColor: 'var(--bb-line)' }}>
        <div className="mb-1 flex items-end gap-1.5">
          <span className="w-6 shrink-0 pb-1 font-mono text-[10px]" style={{ color: 'var(--bb-dim)' }}>
            {axis === 'x' ? '│' : '─'}{i + 1}
          </span>
          <LengthField live label="pos" value={dv.p} units={units} step={0.5} onCommit={(v) => set('p', v)} inputClassName="bb-input-sm" />
          <LengthField live label="height" value={divH(dv, draft.heightMM)} units={units} step={1} min={0.4}
            title="at the bin's height = full height" onCommit={(v) => set('h', v)}
            inputClassName={'bb-input-sm ' + (dv.h == null ? 'opacity-60' : '')} />
          <button type="button" className="bb-btn bb-btn-xs bb-btn-danger" title="Remove divider" aria-label="Remove divider"
            onClick={() => edit((n) => (axis === 'x' ? n.dividersX : n.dividersY).splice(i, 1))}>
            ×
          </button>
        </div>
        <div className="mb-1 flex items-end gap-1.5">
          <span className="w-6 shrink-0" />
          <LengthField live label="from" value={dv.a} units={units} step={0.5} onCommit={(v) => set('a', v)} inputClassName="bb-input-sm" />
          <LengthField live label="to" value={dv.b} units={units} step={0.5} onCommit={(v) => set('b', v)} inputClassName="bb-input-sm" />
          <span className="w-[26px] shrink-0" />
        </div>
      </div>
    );
  };
  const nDiv = draft.dividersX.length + draft.dividersY.length;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={isEdit ? 'Edit bin' : 'New bin'}
      className="fixed z-[60] max-h-[88vh] w-[272px] overflow-y-auto rounded-box border p-3 shadow-2xl"
      style={{ left: pos.left, top: pos.top, background: 'var(--bb-panel-2)', borderColor: 'var(--bb-measure)' }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); (document.activeElement as HTMLElement)?.blur?.(); onCommit(); }
        if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      }}
    >
      <div className="mb-2">
        <label className="bb-label" htmlFor="bbLabel">Label</label>
        <input id="bbLabel" type="text" className="bb-input" placeholder="e.g. deodorant" value={draft.label}
          onChange={(e) => onChange({ ...draft, label: e.target.value })} autoFocus={!isEdit} />
      </div>
      <div className="mb-2 flex gap-2">
        <LengthField live label={<>X {u}</>} value={draft.x} units={units} step={0.5} onCommit={(v) => v != null && edit((n) => (n.x = v))} />
        <LengthField live label={<>Y {u}</>} value={draft.y} units={units} step={0.5} onCommit={(v) => v != null && edit((n) => (n.y = v))} />
      </div>
      <div className="mb-2 flex gap-2">
        <LengthField live label={<>Width {u}</>} value={draft.w} units={units} step={0.5} min={1} onCommit={(v) => setSize('w', v)} />
        <LengthField live label={<>Depth {u}</>} value={draft.d} units={units} step={0.5} min={1} onCommit={(v) => setSize('d', v)} />
      </div>
      <div className="mb-2 flex gap-2">
        <LengthField live label={<>Height {u}</>} value={draft.heightMM} units={units} step={1} min={1}
          onCommit={(v) => v != null && edit((n) => (n.heightMM = v))} />
      </div>

      <div className="bb-label mt-2.5 mb-1.5 border-t pt-2" style={{ borderColor: 'var(--bb-line)' }}>Dividers</div>
      <div className="mb-2 flex items-end gap-2">
        <LengthField plain label="Split: cols" value={cols} units={units} step={1} min={1}
          onCommit={(v) => setCols(Math.max(1, Math.round(v ?? 1)))} />
        <LengthField plain label="rows" value={rows} units={units} step={1} min={1}
          onCommit={(v) => setRows(Math.max(1, Math.round(v ?? 1)))} />
        <button type="button" className="bb-btn bb-btn-xs mb-0.5" onClick={() => edit((n) => {
          const t = p.wall;
          n.dividersX = evenDividers(n.w, cols, t, n.d - t);
          n.dividersY = evenDividers(n.d, rows, t, n.w - t);
        })}>Apply</button>
      </div>
      {draft.dividersX.map((_, i) => divRow('x', i))}
      {draft.dividersY.map((_, i) => divRow('y', i))}
      {nDiv === 0 ? (
        <p className="bb-hint mt-0">No dividers. Use even-split above, or add one — new dividers stop at whatever perpendicular divider they run into.</p>
      ) : (
        <div className="mt-1.5 mb-1 flex items-end gap-1.5">
          <span className="w-6 shrink-0 pb-1 font-mono text-[10px]" style={{ color: 'var(--bb-dim)' }}>all</span>
          <div className="min-w-0 flex-1">
            <label className="bb-label" htmlFor="bbAllH">height</label>
            <input id="bbAllH" type="number" step={1} min={0.4} className="bb-input bb-input-sm" value={allH}
              placeholder={String(units.toDisplay(draft.heightMM))} onChange={(e) => setAllH(e.target.value)} />
          </div>
          <button type="button" className="bb-btn bb-btn-xs" onClick={() => {
            const raw = parseFloat(allH);
            if (isNaN(raw)) return;
            const v = units.toMM(raw);
            edit((n) => {
              const h = v >= n.heightMM - 0.01 ? null : Math.max(0.4, v);
              n.dividersX.forEach((dv) => (dv.h = h));
              n.dividersY.forEach((dv) => (dv.h = h));
            });
          }}>Apply</button>
        </div>
      )}
      <div className="mt-1 flex gap-1.5">
        <button type="button" className="bb-btn bb-btn-xs" onClick={() => onChange(addDivider(draft, 'x', p.wall))}>+ Vertical</button>
        <button type="button" className="bb-btn bb-btn-xs" onClick={() => onChange(addDivider(draft, 'y', p.wall))}>+ Horizontal</button>
      </div>

      {msgs.length > 0 && (
        <p className="mt-1.5 text-[11px] leading-snug" style={{ color: infoOk ? 'var(--bb-dim)' : 'var(--bb-warn)' }}>{msgs.join(' ')}</p>
      )}
      <p className="mt-1.5 min-h-[14px] text-[11px]" style={{ color: 'var(--bb-warn)' }} role="alert">{error}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" className="bb-btn bb-btn-primary flex-1" onClick={onCommit}>{isEdit ? 'Save changes' : 'Add to drawer'}</button>
        <button type="button" className="bb-btn flex-1" onClick={onCancel}>Cancel</button>
      </div>
      {isEdit && (
        <div className="mt-1.5 flex">
          <button type="button" className="bb-btn bb-btn-danger flex-1" onClick={onRemove}
            title="Moves it to Shelved bins — you can add it back to the drawer anytime">Remove bin</button>
        </div>
      )}
    </div>
  );
}
