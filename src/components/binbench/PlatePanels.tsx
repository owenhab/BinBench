import { useMemo } from 'react';
import { type Project, binName } from '@/lib/binbench/model';
import { type Box2, buildStackedPlates, computeBaseplateTiles, floorBins, packPlates, tileTriangles } from '@/lib/binbench/geometry';
import { download3MF, downloadAllPlates3MF, downloadPlate3MF, safeFileName } from '@/lib/binbench/exporters';
import { LengthField, Section, UnitSuffix } from './fields';
import type { Units } from './units';

type Status = (msg: string, err?: boolean) => void;

function PlateCard({ title, children, onDownload, label }: { title: string; children: React.ReactNode; onDownload: () => void; label: string }) {
  return (
    <div className="inline-block rounded-field border p-2.5 align-top" style={{ background: 'var(--bb-panel-2)', borderColor: 'var(--bb-line)' }}>
      <div className="bb-label mb-1.5">{title}</div>
      {children}
      <button type="button" className="bb-btn bb-btn-xs mt-1.5" onClick={onDownload}>{label}</button>
    </div>
  );
}

export function PlatePacking({ project: p, onStatus }: { project: Project; onStatus: Status }) {
  const plates = useMemo(() => packPlates(p), [p]);
  const bed = p.bed;
  const px = Math.min(220 / bed.x, 220 / bed.y);
  const stackedN = p.bins.filter((b) => b.parentId != null).length;
  const summary = p.bins.length
    ? '— ' + p.bins.length + ' bin(s) across ' + plates.length + ' plate(s)' + (stackedN ? ' · ' + stackedN + ' of them stacked' : '')
    : '';

  return (
    <Section title="Print-plate packing preview" badge={summary} tour="plates">
      {p.bins.length === 0 ? (
        <div className="bb-empty">Add bins to see how they'd batch across build plates.</div>
      ) : (
        <div className="flex flex-wrap gap-2.5">
          {plates.map((plate, idx) => (
            <PlateCard key={idx} title={'Plate ' + (idx + 1) + ' · ' + plate.length + ' bin(s)'} label="Download plate (.3mf)"
              onDownload={() => void downloadPlate3MF(p, idx)}>
              <svg width={bed.x * px} height={bed.y * px} className="block">
                <rect width={bed.x * px} height={bed.y * px} fill="var(--bb-plate-bg)" stroke="var(--bb-line)" />
                {plate.map((pl, i) => (
                  <rect key={i} x={pl.x * px} y={pl.y * px} width={pl.w * px} height={pl.d * px} fill={pl.bin.color}
                    opacity={pl.oversize ? 0.4 : 0.85} stroke={pl.oversize ? 'var(--bb-warn)' : '#000'} strokeWidth={pl.oversize ? 2 : 0.5}>
                    <title>{binName(pl.bin)}{pl.oversize ? ' — too big for the bed' : ''}</title>
                  </rect>
                ))}
              </svg>
            </PlateCard>
          ))}
        </div>
      )}
      <div className="mt-3 flex">
        <button type="button" className="bb-btn bb-btn-xs bb-btn-primary" disabled={!p.bins.length}
          onClick={async () => { const r = await downloadAllPlates3MF(p); onStatus(r.msg, r.err); }}>
          Export every plate as one 3MF
        </button>
      </div>
      <p className="bb-hint">
        One file with every bin already laid out, each plate tagged so Bambu Studio opens them as separate plates. Other slicers
        ignore the tagging and show the plates side by side instead — arrange from there.
      </p>
    </Section>
  );
}

export function BaseplateSections({
  project: p, units, onStatus, onStackGap,
}: { project: Project; units: Units; onStatus: Status; onStackGap: (mm: number) => void }) {
  const data = useMemo(() => (p.baseplateEnabled ? computeBaseplateTiles(p) : null), [p]);
  if (!data) return null;
  const { tiles, plate, touch, splitCount } = data;
  const px = Math.min(200 / p.bed.x, 200 / p.bed.y);

  const msgs: string[] = [];
  if (!plate.infos.length)
    msgs.push('The drawer is too small for even one grid cell at the current "Grid reference" spacing — shrink it under Layout & walls, or the plate will just print as a flat slab with no sockets.');
  if (splitCount)
    msgs.push(splitCount + ' socket' + (splitCount === 1 ? ' is' : 's are') + ' split across a plate seam — print the tiles, then butt them together and glue or tape the seam.');

  const stacked = () => {
    const { piles, objects, notes, height, count } = buildStackedPlates(p);
    if (!objects.length) return onStatus(notes[0] || 'Nothing to stack.', true);
    const out = notes.slice();
    if (height > p.bed.z)
      out.push('The tallest pile is ' + units.fmt(height) + ', over the ' + units.fmt(p.bed.z) +
        ' your printer can reach — raise the bed height or use a coarser grid so there are fewer sections.');
    void download3MF(objects, safeFileName(p.projectName) + '_baseplates_stacked');
    onStatus(
      count + ' section(s) in ' + piles.length + ' pile' + (piles.length === 1 ? '' : 's') + ', ' + units.fmt(height) + ' tall' +
        (out.length ? ' — ' + out.join(' ') : ' — turn on supports set to everywhere, not just the build plate, or the sections will print in mid-air.'),
      out.length > 0,
    );
  };

  return (
    <Section title="Baseplate sections" tour="baseplateSections"
      badge={'— ' + tiles.length + ' plate' + (tiles.length === 1 ? '' : 's') +
        (splitCount ? ' · ' + splitCount + ' socket' + (splitCount === 1 ? '' : 's') + ' split across a seam' : '')}>
      {msgs.length > 0 && (
        <div role="alert" className="mb-2.5 rounded-field border px-2.5 py-2 text-xs"
          style={{ background: 'rgba(207,91,78,0.12)', borderColor: 'var(--bb-warn)', color: 'var(--bb-warn)' }}>
          {msgs.join(' ')}
        </div>
      )}
      <div className="flex flex-wrap gap-2.5">
        {tiles.map((tile, idx) => (
          <PlateCard key={idx} label="Download 3MF"
            title={'Plate ' + (idx + 1) + ' · ' + units.fmt(tile.x1 - tile.x0) + '×' + units.fmt(tile.y1 - tile.y0) + ' · ' + (touch.get(tile)?.length ?? 0) + ' socket(s)'}
            onDownload={() => void download3MF([{ id: 1, tris: tileTriangles(p, tile, plate), transform: [0, 0, 0] }], 'baseplate_plate_' + (idx + 1))}>
            <TileSvg p={p} tile={tile} plate={plate} px={px} />
          </PlateCard>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <LengthField className="max-w-[150px]" label={<>Support gap <UnitSuffix units={units} /></>} value={p.stackGap} units={units}
          step={0.1} min={0.4} onCommit={(v) => onStackGap(v ? v : 1.0)} />
        <button type="button" className="bb-btn bb-btn-xs bb-btn-primary mb-0.5" onClick={stacked}>Print all sections in one stack (3MF)</button>
      </div>
      <p className="bb-hint">
        Piles every section into a single job, each one turned over from the last so the socket faces meet squarely, lined up on a
        shared grid and biggest at the bottom. The sections are separated by an air gap, not by plastic —{' '}
        <b>turn supports on and set them to everywhere, not just the build plate</b>, and the slicer fills each gap with support that
        peels off to free the sections.
      </p>
    </Section>
  );
}

function TileSvg({ p, tile, plate, px }: { p: Project; tile: Box2; plate: ReturnType<typeof computeBaseplateTiles>['plate']; px: number }) {
  const tw = tile.x1 - tile.x0, td = tile.y1 - tile.y0;
  const cl = (r: Box2) => ({ x0: Math.max(r.x0, tile.x0), x1: Math.min(r.x1, tile.x1), y0: Math.max(r.y0, tile.y0), y1: Math.min(r.y1, tile.y1) });
  const R = (r: Box2, props: React.SVGProps<SVGRectElement>, key: string) =>
    r.x1 <= r.x0 || r.y1 <= r.y0 ? null : (
      <rect key={key} x={(r.x0 - tile.x0) * px} y={(r.y0 - tile.y0) * px} width={(r.x1 - r.x0) * px} height={(r.y1 - r.y0) * px} {...props} />
    );
  return (
    <svg width={tw * px} height={td * px} className="block">
      <rect width={tw * px} height={td * px} fill="var(--bb-plate-bg)" stroke="var(--bb-line)" />
      {/* plate that carries no socket is drawn too, so the preview shows the coverage that actually prints */}
      {plate.dropped.map((d, i) => R(cl(d.outer), { fill: 'var(--bb-line)', stroke: 'var(--bb-line)', strokeWidth: 1 }, 'd' + i))}
      {plate.infos.map((inf, i) => {
        const co = cl(inf.outer);
        if (co.x1 <= co.x0 || co.y1 <= co.y0) return null;
        return (
          <g key={'s' + i}>
            {R(co, { fill: 'var(--bb-panel-2)', stroke: 'var(--bb-line)', strokeWidth: 1 }, 'o')}
            {/* the socket is a hole clean through the lattice */}
            {R(cl(inf.op), { fill: 'var(--bb-plate-bg)', stroke: '#55605b', strokeWidth: 1.5 }, 'a')}
          </g>
        );
      })}
      {plate.holes.map((h, i) => R(cl(h), { fill: 'var(--bb-plate-bg)', stroke: 'var(--bb-warn)', strokeWidth: 1, strokeDasharray: '3,2' }, 'h' + i))}
      {/* level-1 bin footprints for reference — the plate itself doesn't know they're here */}
      {floorBins(p).map((b) =>
        R(cl({ x0: b.x, x1: b.x + b.w, y0: b.y, y1: b.y + b.d }), { fill: 'none', stroke: b.color, strokeWidth: 2, strokeDasharray: '4,3' }, 'b' + b.id),
      )}
    </svg>
  );
}
