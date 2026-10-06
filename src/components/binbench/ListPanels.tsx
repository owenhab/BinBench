import { type Bin, type Obstruction, type Project, binById, binFit, binInterior, binLevel, binName, isPartial, obstructionH } from '@/lib/binbench/model';
import { isLooseBin } from '@/lib/binbench/geometry';
import { LengthField, Section } from './fields';
import type { Units } from './units';

interface BinListProps {
  project: Project;
  units: Units;
  onEdit: (b: Bin) => void;
  onCopy: (b: Bin) => void;
  onSTL: (b: Bin) => void;
  on3MF: (b: Bin) => void;
  onRemove: (b: Bin) => void;
  onClear: () => void;
}

export function BinList({ project: p, units, onEdit, onCopy, onSTL, on3MF, onRemove, onClear }: BinListProps) {
  return (
    <Section title="Bins" tour="bins">
      {p.bins.length === 0 ? (
        <div className="bb-empty">No bins yet — drag on the grid to draft one.</div>
      ) : (
        <ul className="max-h-[320px] overflow-y-auto">
          {p.bins.map((bin) => {
            const fit = binFit(p, bin);
            const lvl = binLevel(p, bin);
            const parent = bin.parentId != null ? binById(p, bin.parentId) : null;
            // a bin straddling a cell boundary can miss every socket — legal geometry, but
            // nothing holds it in place, so say so rather than let it print unlocated
            const loose = isLooseBin(p, bin, lvl);
            const divs = [...bin.dividersX, ...bin.dividersY];
            const nPart = divs.filter((dv) => isPartial(dv, bin.heightMM)).length;
            const ib = binInterior(p, bin);
            const title =
              'Outside ' + units.fmt(bin.w) + '×' + units.fmt(bin.d) + '×' + units.fmt(bin.heightMM) +
              '\nUsable inside ' + units.fmt(ib.w) + '×' + units.fmt(ib.d) + '×' + units.fmt(ib.h) + ' (walls, plus the stacking collar on top)' +
              (lvl > 1 ? '\nStacked on ' + (parent ? binName(parent) : '?') : '') +
              (loose ? '\nThis bin straddles the grid without covering enough of any one cell to grow a foot, so nothing locates it. Nudge it onto a cell or make it bigger.' : '');
            return (
              <li key={bin.id} title={title} className="flex flex-wrap items-center gap-2 border-b py-2 last:border-b-0" style={{ borderColor: 'var(--bb-line)' }}>
                <span className="size-3 shrink-0 rounded-sm" style={{ background: bin.color }} />
                <div className="min-w-[110px] flex-1">
                  <div className="text-[12.5px] font-semibold">
                    {binName(bin)} {!fit.ok && <span className="font-bold" style={{ color: 'var(--bb-warn)' }}>⚠</span>}
                  </div>
                  <div className="font-mono text-[11px]" style={{ color: 'var(--bb-dim)' }}>
                    {units.fmt(bin.w)}×{units.fmt(bin.d)}×{units.fmt(bin.heightMM)}
                    {divs.length ? ' · ' + divs.length + ' div' + (nPart ? ', ' + nPart + ' low' : '') : ''}
                    {lvl > 1 ? ' · L' + lvl + ' on ' + (parent ? binName(parent) : '?') : ''}
                    {loose && <span className="font-bold" style={{ color: 'var(--bb-warn)' }}> · nothing to locate on</span>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  <button type="button" className="bb-btn bb-btn-xs" onClick={() => onEdit(bin)}>Edit</button>
                  <button type="button" className="bb-btn bb-btn-xs" onClick={() => onCopy(bin)}>Copy</button>
                  <button type="button" className="bb-btn bb-btn-xs" onClick={() => onSTL(bin)}>STL</button>
                  <button type="button" className="bb-btn bb-btn-xs" onClick={() => on3MF(bin)}>3MF</button>
                  <button type="button" className="bb-btn bb-btn-xs bb-btn-danger" aria-label={'Remove ' + binName(bin)}
                    title="Remove — keeps it in Shelved bins so you can add it back" onClick={() => onRemove(bin)}>×</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-2.5">
        <button type="button" className="bb-btn bb-btn-xs" onClick={onClear} disabled={!p.bins.length && !p.blocked.length}>Clear all</button>
      </div>
    </Section>
  );
}

export function ObstructionList({
  project: p, units, onChange, onDelete, onAdd,
}: {
  project: Project;
  units: Units;
  onChange: (id: number, patch: Partial<Obstruction>) => void;
  onDelete: (id: number) => void;
  onAdd: () => void;
}) {
  return (
    <Section title="Obstructions" badge={p.blocked.length || undefined} tour="obstructions">
      {p.blocked.length === 0 ? (
        <div className="bb-empty">Nothing in the way yet — add one below, or switch to “Mark obstruction” and drag it on the grid.</div>
      ) : (
        <ul>
          {p.blocked.map((bl) => (
            <li key={bl.id} className="flex flex-wrap items-end gap-1.5 border-b py-2 last:border-b-0" style={{ borderColor: 'var(--bb-line)' }}>
              <input type="text" className="bb-input bb-input-sm basis-full" placeholder="e.g. slide rail" aria-label="Obstruction label"
                value={bl.label} onChange={(e) => onChange(bl.id, { label: e.target.value })} />
              <div className="grid min-w-0 flex-1 grid-cols-5 gap-1">
                {(['x', 'y', 'w', 'd', 'h'] as const).map((k) => (
                  <LengthField key={k} label={k.toUpperCase()} value={k === 'h' ? obstructionH(p, bl) : bl[k]} units={units}
                    step={0.5} inputClassName="bb-input-sm"
                    onCommit={(v) => {
                      if (v == null) return;
                      onChange(bl.id, { [k]: k === 'w' || k === 'd' ? Math.max(1, v) : k === 'h' ? Math.max(0.5, v) : Math.max(0, v) });
                    }} />
                ))}
              </div>
              <button type="button" className="bb-btn bb-btn-xs bb-btn-danger mb-0.5" aria-label="Delete this obstruction"
                title="Delete this obstruction" onClick={() => onDelete(bl.id)}>×</button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2.5">
        <button type="button" className="bb-btn bb-btn-xs" onClick={onAdd}>Add obstruction</button>
      </div>
      <p className="bb-hint">
        Give each one a height and it only blocks what it can actually reach — a low rail still lets a stacked level pass over the top.
        The baseplate is notched around every obstruction.
      </p>
    </Section>
  );
}

export function ShelfList({
  project: p, units, onRestore, onDelete,
}: { project: Project; units: Units; onRestore: (shelfId: number) => void; onDelete: (shelfId: number) => void }) {
  return (
    <Section title="Shelved bins" badge={p.shelvedBins.length || undefined} tour="shelf">
      {p.shelvedBins.length === 0 ? (
        <div className="bb-empty">Removing a bin puts it here instead of deleting it — add it back to the drawer anytime.</div>
      ) : (
        <ul>
          {p.shelvedBins.map((s) => {
            const nd = s.dividersX.length + s.dividersY.length;
            return (
              <li key={s.shelfId} className="flex flex-wrap items-center gap-2 border-b py-2 last:border-b-0" style={{ borderColor: 'var(--bb-line)' }}>
                <span className="size-3 shrink-0 rounded-sm" style={{ background: s.color }} />
                <div className="min-w-[110px] flex-1">
                  <div className="text-[12.5px] font-semibold">{s.label || 'Bin'}</div>
                  <div className="font-mono text-[11px]" style={{ color: 'var(--bb-dim)' }}>
                    {units.fmt(s.w)}×{units.fmt(s.d)}×{units.fmt(s.heightMM)}{nd ? ' · ' + nd + ' div' : ''}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button type="button" className="bb-btn bb-btn-xs bb-btn-primary" onClick={() => onRestore(s.shelfId)}>Add to drawer</button>
                  <button type="button" className="bb-btn bb-btn-xs bb-btn-danger" aria-label="Delete permanently"
                    title="Delete permanently — this cannot be undone" onClick={() => onDelete(s.shelfId)}>×</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
