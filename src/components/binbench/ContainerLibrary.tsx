import { useMemo, useState } from 'react';
import { type Project } from '@/lib/binbench/model';
import { type ContainerPreset, BUILT_IN_CONTAINERS, MY_GROUP, containerSize, newContainerId } from '@/lib/binbench/containers';
import { Section } from './fields';
import type { Units } from './units';

interface Props {
  project: Project;
  units: Units;
  /** sizes the user has kept, newest last */
  mine: ContainerPreset[];
  onSaveMine: (list: ContainerPreset[]) => void;
  onAdd: (c: ContainerPreset) => void;
  /** the bin open in the editor, if any — what "save this size" saves */
  current: { w: number; d: number; heightMM: number; label: string } | null;
}

export default function ContainerLibrary({ project: p, units, mine, onSaveMine, onAdd, current }: Props) {
  const all = useMemo(() => BUILT_IN_CONTAINERS.concat(mine), [mine]);
  const [pick, setPick] = useState(all[0]?.id ?? '');
  const [name, setName] = useState('');

  const chosen = all.find((c) => c.id === pick) ?? all[0];
  const groups = useMemo(() => {
    const g = new Map<string, ContainerPreset[]>();
    all.forEach((c) => {
      if (!g.has(c.group)) g.set(c.group, []);
      g.get(c.group)!.push(c);
    });
    return [...g.entries()];
  }, [all]);

  // what the chosen size actually becomes once the grid has had its say
  const out = chosen ? containerSize(p, chosen) : null;
  const rounded =
    chosen && out ? Math.abs(out.w - chosen.w) > 0.6 || Math.abs(out.d - chosen.d) > 0.6 || Math.abs(out.heightMM - chosen.h) > 0.6 : false;

  const save = () => {
    if (!current) return;
    const label = (name.trim() || current.label.trim() || 'Saved size').slice(0, 40);
    const next = mine.concat({
      id: newContainerId(), group: MY_GROUP, name: label,
      w: current.w, d: current.d, h: current.heightMM, mine: true,
    });
    onSaveMine(next);
    setName('');
  };

  return (
    <Section title="Container library" tour="library" badge={mine.length ? mine.length + ' saved' : undefined}>
      <div className="mb-2">
        <label className="bb-label" htmlFor="bbPreset2">Common items</label>
        <select id="bbPreset2" className="bb-input" value={pick} onChange={(e) => setPick(e.target.value)}>
          {groups.map(([g, list]) => (
            <optgroup key={g} label={g}>
              {list.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name + ' — ' + units.fmt(c.w) + '×' + units.fmt(c.d) + '×' + units.fmt(c.h)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <button type="button" className="bb-btn bb-btn-xs bb-btn-primary" disabled={!chosen} onClick={() => chosen && onAdd(chosen)}>
          Add to drawer
        </button>
        {out && (
          <span className="font-mono text-[11px]" style={{ color: 'var(--bb-dim)' }}>
            {units.fmt(out.w)}×{units.fmt(out.d)}×{units.fmt(out.heightMM)}
            {rounded ? ' · rounded to the grid' : ''}
          </span>
        )}
      </div>
      <p className="bb-hint">
        Starting sizes for things that commonly live in drawers — a place to begin, not a measurement. Dropped in as an ordinary bin,
        so resize it to whatever you actually own. Under <b>Whole cells only</b> the footprint rounds up, since a 45mm item really does
        need two 42mm cells.
      </p>

      <div className="mt-3 border-t pt-2.5" style={{ borderColor: 'var(--bb-line)' }}>
        <label className="bb-label" htmlFor="bbSaveName">Save a size of your own</label>
        <div className="flex flex-wrap items-center gap-2">
          <input id="bbSaveName" type="text" className="bb-input max-w-[160px]" placeholder={current ? current.label || 'Name it' : 'Open a bin first'}
            value={name} disabled={!current} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }} />
          <button type="button" className="bb-btn bb-btn-xs" disabled={!current} onClick={save}>
            {current ? 'Save ' + units.fmt(current.w) + '×' + units.fmt(current.d) + '×' + units.fmt(current.heightMM) : 'Save'}
          </button>
        </div>
        <p className="bb-hint">
          {current
            ? 'Keeps the size of the bin you have open. Saved sizes are yours, not the drawer’s — they stay in this browser and turn up in every project.'
            : 'Click a bin, or draft one, and its size can be kept here for reuse in any project.'}
        </p>
        {mine.length > 0 && (
          <ul className="mt-1.5">
            {mine.map((c) => (
              <li key={c.id} className="flex items-center gap-2 border-b py-1.5 last:border-b-0" style={{ borderColor: 'var(--bb-line)' }}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px]">{c.name}</div>
                  <div className="font-mono text-[11px]" style={{ color: 'var(--bb-dim)' }}>
                    {units.fmt(c.w)}×{units.fmt(c.d)}×{units.fmt(c.h)}
                  </div>
                </div>
                <button type="button" className="bb-btn bb-btn-xs" onClick={() => onAdd(c)}>Add</button>
                <button type="button" className="bb-btn bb-btn-xs bb-btn-danger" aria-label={'Forget ' + c.name} title="Forget this size"
                  onClick={() => onSaveMine(mine.filter((m) => m.id !== c.id))}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
