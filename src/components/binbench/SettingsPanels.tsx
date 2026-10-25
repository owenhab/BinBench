import { useState } from 'react';
import { type Project, PRINTERS, usableBounds } from '@/lib/binbench/model';
import { GF, gfFloorH, gfOn, setGridfinity } from '@/lib/binbench/gridfinity';
import { type PaperSize, printTemplate } from '@/lib/binbench/template';
import { LengthField, Panel, UnitSuffix } from './fields';
import { type Highlight, PlateCrossSection, WallsCrossSection } from './CrossSection';
import type { LengthUnit, Units } from './units';

type Update = (patch: Partial<Project>) => void;
/** blank or zero falls back to the default, like the original fields did */
const or = (v: number | null, fb: number) => (v ? v : fb);

interface Props {
  project: Project;
  units: Units;
  update: Update;
  projBadge: string;
  status: { msg: string; err: boolean };
  setStatus: (msg: string, err?: boolean) => void;
  canWriteFiles: boolean;
  onSave: () => void;
  onSaveAs: () => void;
  onOpen: () => void;
  onCopyJson: () => Promise<string | null>;
  onLoadText: (text: string) => boolean;
}

function CheckRow({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={'flex cursor-pointer items-center gap-1.5 text-xs ' + (disabled ? 'opacity-45' : '')}>
      <input type="checkbox" className="checkbox checkbox-xs checkbox-primary" checked={checked} disabled={disabled}
        onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export default function SettingsPanels(props: Props) {
  const { project: p, units, update } = props;
  const u = <UnitSuffix units={units} />;
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [paper, setPaper] = useState<PaperSize>('letter');
  const [paperBins, setPaperBins] = useState(true);

  const setBed = (axis: 'x' | 'y' | 'z', v: number | null) => {
    const bed = { ...p.bed, [axis]: or(v, 256) };
    const match = PRINTERS.find((pr) => pr.x != null && Math.abs(pr.x - bed.x) < 0.01 && Math.abs(pr.y! - bed.y) < 0.01 && Math.abs(pr.z! - bed.z) < 0.01);
    // keep the chosen preset when several share the same build volume
    const current = PRINTERS.find((pr) => pr.id === p.printerPreset);
    const keep = current && match && current.x === match.x && current.y === match.y && current.z === match.z;
    update({ bed, printerPreset: keep ? p.printerPreset : match ? match.id : 'custom' });
  };

  return (
    <>
      <Panel title="Project" defaultOpen tour="project" badge={props.projBadge}>
        <div className="mb-2">
          <label className="bb-label" htmlFor="bbProjName">Project name</label>
          <input id="bbProjName" type="text" className="bb-input" value={p.projectName} placeholder="e.g. bathroom top drawer"
            onChange={(e) => update({ projectName: e.target.value })} />
        </div>
        <div className="mb-2 flex flex-wrap gap-2">
          <button type="button" className="bb-btn bb-btn-xs bb-btn-primary" onClick={props.onSave}>Save</button>
          <button type="button" className="bb-btn bb-btn-xs" onClick={props.onSaveAs}>Save as…</button>
          <button type="button" className="bb-btn bb-btn-xs" onClick={props.onOpen}>Open</button>
        </div>
        <div className="mb-2 flex flex-wrap gap-2">
          <button type="button" className="bb-btn bb-btn-xs" onClick={async () => {
            const fallback = await props.onCopyJson();
            if (fallback != null) { setJsonOpen(true); setJsonText(fallback); }
          }}>Copy JSON</button>
          <button type="button" className="bb-btn bb-btn-xs" onClick={() => { setJsonOpen(!jsonOpen); setJsonText(''); }}>Paste JSON</button>
        </div>
        {jsonOpen && (
          <div>
            <textarea className="bb-input h-[110px] resize-y text-[11px]" spellCheck={false} value={jsonText} aria-label="Project JSON"
              placeholder="Paste a Bin Bench project JSON here, then click Load pasted JSON." onChange={(e) => setJsonText(e.target.value)} />
            <button type="button" className="bb-btn bb-btn-xs bb-btn-primary mt-1.5 w-full" onClick={() => {
              const t = jsonText.trim();
              if (!t) return props.setStatus('Paste project JSON into the box first.', true);
              if (props.onLoadText(t)) setJsonOpen(false);
            }}>Load pasted JSON</button>
          </div>
        )}
        <p className="mt-1.5 min-h-[14px] text-[11px]" role="status" style={{ color: props.status.err ? 'var(--bb-warn)' : 'var(--bb-ok)' }}>
          {props.status.msg}
        </p>
        <p className="bb-hint">
          {props.canWriteFiles
            ? 'Save updates the file you last saved to or opened. If the browser blocks the file picker, it falls back to a download.'
            : 'This browser can’t write files directly, so Save downloads a fresh .json each time. Chrome and Edge can update one file in place.'}{' '}
          Copy JSON / Paste JSON works anywhere. Projects never leave your computer.
        </p>
      </Panel>

      <Panel title="Printer bed" tour="bed" badge={units.fmt(p.bed.x) + '×' + units.fmt(p.bed.y) + '×' + units.fmt(p.bed.z)}>
        <div className="mb-2">
          <label className="bb-label" htmlFor="bbPreset">Preset</label>
          <select id="bbPreset" className="bb-input" value={PRINTERS.some((pr) => pr.id === p.printerPreset) ? p.printerPreset : 'custom'}
            onChange={(e) => {
              const pr = PRINTERS.find((x) => x.id === e.target.value)!;
              update(pr.x ? { printerPreset: pr.id, bed: { x: pr.x, y: pr.y!, z: pr.z! } } : { printerPreset: pr.id });
            }}>
            {PRINTERS.map((pr) => (
              <option key={pr.id} value={pr.id}>{pr.name + (pr.x ? ' — ' + pr.x + '×' + pr.y + '×' + pr.z : '')}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <LengthField label={<>X {u}</>} value={p.bed.x} units={units} min={10} onCommit={(v) => setBed('x', v)} />
          <LengthField label={<>Y {u}</>} value={p.bed.y} units={units} min={10} onCommit={(v) => setBed('y', v)} />
          <LengthField label={<>Z {u}</>} value={p.bed.z} units={units} min={10} onCommit={(v) => setBed('z', v)} />
        </div>
        <p className="bb-hint">
          Presets are nominal build volumes from Bambu's specs. Bambu Studio reserves a little space for the cutter and Z-hop, so knock a
          few mm off if you're printing right to the edge.
        </p>
      </Panel>

      <Panel title="Drawer interior" defaultOpen tour="drawer" badge={units.fmt(p.drawer.w) + '×' + units.fmt(p.drawer.d) + '×' + units.fmt(p.drawer.h)}>
        <div className="flex gap-2">
          <LengthField label={<>Width {u}</>} value={p.drawer.w} units={units} min={20} onCommit={(v) => update({ drawer: { ...p.drawer, w: or(v, 300) } })} />
          <LengthField label={<>Depth {u}</>} value={p.drawer.d} units={units} min={20} onCommit={(v) => update({ drawer: { ...p.drawer, d: or(v, 300) } })} />
          <LengthField label={<>Height {u}</>} value={p.drawer.h} units={units} min={10} onCommit={(v) => update({ drawer: { ...p.drawer, h: or(v, 60) } })} />
        </div>
        <p className="bb-hint">Measure the inside of the drawer, not the drawer face.</p>
      </Panel>

      <Panel title="Paper template" tour="paper">
        <div className="mb-2 flex gap-2">
          <div className="min-w-0 flex-1">
            <label className="bb-label" htmlFor="bbPaper">Paper size</label>
            <select id="bbPaper" className="bb-input" value={paper} onChange={(e) => setPaper(e.target.value as PaperSize)}>
              <option value="letter">US Letter</option>
              <option value="a4">A4</option>
            </select>
          </div>
          <LengthField label={<>Fine grid {u}</>} value={p.paperGrid} units={units} min={2} step={1} onCommit={(v) => update({ paperGrid: or(v, 10) })} />
        </div>
        <label className="mb-2 flex cursor-pointer items-center gap-1.5 text-xs">
          <input type="checkbox" className="checkbox checkbox-xs checkbox-primary" checked={paperBins} onChange={(e) => setPaperBins(e.target.checked)} />
          Overlay current bin outlines
        </label>
        <button type="button" className="bb-btn bb-btn-xs bb-btn-primary w-full" onClick={() => {
          if (!printTemplate(p, paper, paperBins)) props.setStatus('Popup blocked — allow popups to print the template.', true);
        }}>Print 1:1 template</button>
        <p className="bb-hint">
          Prints the drawer footprint at true scale, tiled across sheets you tape together. Set your printer to 100% / "Actual size" (not
          "Fit to page"), then check the 100mm calibration bar on page 1 with a ruler before trusting it.
        </p>
      </Panel>
    </>
  );
}

// ---------- advanced ----------
// The settings most drawers never need touched: the display unit, the millimetres a
// bin is built from, and the socket the baseplate carries. Closed until asked for.
export function AdvancedPanels({
  project: p, units, update, onUnitChange,
}: {
  project: Project;
  units: Units;
  update: Update;
  onUnitChange: (u: LengthUnit) => void;
}) {
  const u = <UnitSuffix units={units} />;
  const [hot, setHot] = useState<Highlight>(null);
  const lit = (key: string) => (on: boolean) => setHot(on ? key : null);

  const gf = gfOn(p);
  const bnd = usableBounds(p);
  const usedArea = p.bins.reduce((s, b) => s + b.w * b.d, 0);
  const blockedArea = p.blocked.reduce((s, b) => s + b.w * b.d, 0);
  const usableArea = Math.max(1, (bnd.maxX - bnd.minX) * (bnd.maxY - bnd.minY) - blockedArea);
  const coverage = Math.min(100, (usedArea / usableArea) * 100);

  return (
    <details className="group mb-2.5" data-tour="advanced">
      <summary
        className="bb-h flex cursor-pointer list-none items-center gap-2 rounded-field border px-3 py-2.5 select-none hover:text-base-content [&::-webkit-details-marker]:hidden"
        style={{ borderColor: 'var(--bb-line)', background: 'var(--bb-panel-2)' }}
      >
        <span className="text-[10px] text-primary transition-transform group-open:rotate-90" aria-hidden>▶</span>
        Advanced settings
        <span className="bb-mono-dim ml-auto text-[10.5px]">units · layout · baseplate</span>
      </summary>

      <div className="pt-2.5">
        <Panel title="Units" defaultOpen tour="units">
          <label className="bb-label" htmlFor="bbUnits">Measurement units</label>
          <select id="bbUnits" className="bb-input" value={units.unit} onChange={(e) => onUnitChange(e.target.value as LengthUnit)}>
            <option value="mm">Metric (mm)</option>
            <option value="in">Standard (in)</option>
          </select>
          <p className="bb-hint">
            Applies to every size field. Values are always stored internally in mm — the printed template and exported files stay true to
            scale either way.
          </p>
        </Panel>

        <Panel title="Layout & walls" defaultOpen tour="layout">
          <WallsCrossSection project={p} units={units} on={hot} />
          <div className="mb-2 flex gap-2">
            <LengthField label={<>Grid reference {u}</>} value={p.unit} units={units} min={2} step={0.5} disabled={gf}
              title={gf ? 'Gridfinity mode sets the grid to 42 mm' : undefined} onCommit={(v) => update({ unit: or(v, 42) })} />
            <LengthField label={<>Snap {u}</>} value={p.snap} units={units} min={0.1} step={0.5} onCommit={(v) => update({ snap: or(v, 1) })} />
          </div>
          <div className="mb-2 flex gap-2">
            <LengthField label={<>Wall clearance {u}</>} value={p.clearance} units={units} min={0} step={0.5} onActive={lit('clearance')}
              onCommit={(v) => update({ clearance: or(v, 0) })} />
            <LengthField label={<>Print gap {u}</>} value={p.gap} units={units} min={0} step={0.5} onCommit={(v) => update({ gap: or(v, 0) })} />
          </div>
          <div className="mb-2 flex gap-2">
            <LengthField label={<>Bin wall {u}</>} value={p.wall} units={units} min={0.4} step={0.2} onActive={lit('wall')}
              onCommit={(v) => update({ wall: or(v, 1) })} />
            <LengthField label={<>Bin floor {u}</>} value={p.floor} units={units} min={0.4} step={0.2} onActive={lit('floor')}
              onCommit={(v) => update({ floor: or(v, 2) })} />
          </div>
          <div className="mb-2 flex gap-2">
            <LengthField label={<>Divider thickness {u}</>} value={p.dividerThickness} units={units} min={0.4} step={0.2}
              onActive={lit('dividerThickness')} onCommit={(v) => update({ dividerThickness: or(v, 1.2) })} />
            <LengthField label={<>Min bin gap {u}</>} value={p.minGap} units={units} min={0} step={0.1} onActive={lit('minGap')}
              onCommit={(v) => update({ minGap: Math.max(0, v ?? 0.5) })} />
          </div>
          <p className="bb-hint">
            Usable area {units.fmt(bnd.maxX - bnd.minX)}×{units.fmt(bnd.maxY - bnd.minY)}. Coverage: {coverage.toFixed(0)}%.
          </p>
        </Panel>

        <Panel title="Baseplate" defaultOpen tour="baseplate" headerExtra={
          <label className="bb-mono-dim ml-auto flex cursor-pointer items-center gap-1.5 text-[10.5px]" onClick={(e) => e.stopPropagation()}>
            <input type="checkbox" className="checkbox checkbox-xs checkbox-primary" checked={p.baseplateEnabled}
              onChange={(e) => update({ baseplateEnabled: e.target.checked })} />
            enable
          </label>
        }>
          <PlateCrossSection project={p} units={units} on={hot} />
          <div className="mb-2 flex flex-wrap gap-x-3.5 gap-y-1.5">
            <CheckRow label="Gridfinity standard" checked={gf} onChange={(on) => update(setGridfinity(p, on))} />
            <CheckRow label="Magnet holes in bins" checked={p.gfMagnets} disabled={!gf} onChange={(v) => update({ gfMagnets: v })} />
            <CheckRow label="Magnet baseplate" checked={p.gfPlateMagnets} disabled={!gf} onChange={(v) => update({ gfPlateMagnets: v })} />
          </div>
          <p className="bb-hint mb-2">
            {gf ? (
              <>
                Gridfinity on: 42 mm grid, bins snap to whole cells (42n − 0.5 mm) and whole 7 mm height units. The plate uses the
                standard pocket and the bins the standard foot, so they mix with any other Gridfinity parts.{' '}
                {p.gfPlateMagnets && (
                  <>
                    Magnet baseplate: a skeleton floor under the pockets (1 mm skin + 2.4 mm) with a 6.5 mm magnet pocket under each bin
                    magnet position, making the plate {units.fmt(GF.plateH + gfFloorH(p))} tall. Press every plate magnet in with the same
                    pole up and every bin magnet with the opposite pole down.{' '}
                  </>
                )}
                Where the drawer leaves less than a whole cell at the far walls, the plate carries a trimmed pocket and bins can run into
                it with a trimmed foot (trimmed feet get no magnets; the plate keeps any magnet pocket that fits whole). Bins stacked on
                bins still use Bin Bench's own collar, not the Gridfinity stacking lip.
              </>
            ) : (
              'Off: the custom grid and socket below are used.'
            )}
          </p>
          <div style={gf ? { opacity: 0.45 } : undefined}>
            <div className="mb-2 flex gap-2">
              <LengthField label={<>Plate thickness {u}</>} value={p.baseThick} units={units} min={2} step={0.5} disabled={gf}
                onActive={lit('baseThick')} onCommit={(v) => update({ baseThick: or(v, 5) })} />
              <LengthField label={<>Foot height {u}</>} value={p.footH} units={units} min={1} step={0.5} disabled={gf}
                onActive={lit('footH')} onCommit={(v) => update({ footH: or(v, 3) })} />
            </div>
            <div className="mb-2 flex gap-2">
              <LengthField label={<>Foot taper {u}</>} value={p.footTaper} units={units} min={0.5} step={0.5} disabled={gf}
                onActive={lit('footTaper')} onCommit={(v) => update({ footTaper: or(v, 3) })} />
              <LengthField label={<>Fit clearance {u}</>} value={p.fitClear} units={units} min={0} step={0.05} disabled={gf}
                onActive={lit('fitClear')} onCommit={(v) => update({ fitClear: v ?? 0.25 })} />
            </div>
            <div className="mb-2 flex gap-2">
              <LengthField label={<>Wall between sockets {u}</>} value={p.ringW} units={units} min={1} step={0.5} disabled={gf}
                onActive={lit('ringW')} onCommit={(v) => update({ ringW: or(v, 2.5) })} />
            </div>
          </div>
          {!gf && (
            <p className="bb-hint">
              The baseplate is a uniform grid of tapered sockets, one every "Grid reference" spacing across the whole drawer — it doesn't
              know or care where your bins are. Each bin grows a matching tapered foot under every grid cell it substantially covers,
              Gridfinity-style, so it can nest anywhere on the plate and you can rearrange bins without reprinting it.
            </p>
          )}
        </Panel>
      </div>
    </details>
  );
}
