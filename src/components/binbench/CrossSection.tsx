// Cross-sections drawn from the live project, so every setting in the panel beside
// them can be seen as the millimetres it actually becomes. Everything here is to
// scale: the only liberty taken is how much of the drawer each view shows.
import { type Project } from '@/lib/binbench/model';
import { pegGeometry } from '@/lib/binbench/geometry';
import { GF, gfFloorH, gfOn } from '@/lib/binbench/gridfinity';
import type { Units } from './units';

/** Which field the pointer or keyboard is on, so its dimension can light up. */
export type Highlight = string | null;

const BODY = 'var(--bb-section-body)';
const EDGE = 'var(--bb-section-edge)';
const GHOST = 'var(--bb-section-ghost)';
const LIVE = 'var(--bb-measure)';
const MUTE = 'var(--bb-dim)';

interface Frame {
  /** mm → px */
  s: number;
  /** px offset of the drawing box */
  ox: number;
  oy: number;
  /** mm height of the drawing box, so y can be measured upward from its floor */
  hmm: number;
}
const X = (f: Frame, mm: number) => f.ox + mm * f.s;
/** z is measured upward from the floor of the view, but SVG y runs down */
const Y = (f: Frame, mm: number) => f.oy + (f.hmm - mm) * f.s;

function Shape({ f, pts, fill, stroke, dash }: { f: Frame; pts: [number, number][]; fill: string; stroke?: string; dash?: string }) {
  return (
    <polygon
      points={pts.map(([x, z]) => `${X(f, x).toFixed(1)},${Y(f, z).toFixed(1)}`).join(' ')}
      fill={fill}
      stroke={stroke ?? EDGE}
      strokeWidth={0.8}
      strokeDasharray={dash}
      strokeLinejoin="round"
    />
  );
}

/** A horizontal measure between two x positions, drawn `row` rows below the view. */
function HDim({ f, x1, x2, row, label, on, from }: { f: Frame; x1: number; x2: number; row: number; label: string; on?: boolean; from?: number }) {
  const y = f.oy + f.hmm * f.s + 14 + row * 15;
  const a = X(f, x1), b = X(f, x2);
  const col = on ? LIVE : MUTE;
  const mid = (a + b) / 2;
  const tiny = b - a < 26;
  return (
    <g stroke={col} fill={col} strokeWidth={on ? 1.2 : 0.8}>
      <line x1={a} y1={from != null ? Y(f, from) : y - 9} x2={a} y2={y} strokeDasharray="2,2" opacity={0.55} />
      <line x1={b} y1={from != null ? Y(f, from) : y - 9} x2={b} y2={y} strokeDasharray="2,2" opacity={0.55} />
      <line x1={a} y1={y} x2={b} y2={y} />
      <path d={`M${a + 3.5} ${y - 2.5}L${a} ${y}L${a + 3.5} ${y + 2.5}Z`} stroke="none" />
      <path d={`M${b - 3.5} ${y - 2.5}L${b} ${y}L${b - 3.5} ${y + 2.5}Z`} stroke="none" />
      <text
        x={tiny ? b + 5 : mid}
        y={y - 3}
        textAnchor={tiny ? 'start' : 'middle'}
        stroke="none"
        fontSize={9.5}
        fontWeight={on ? 700 : 400}
        className="font-mono"
      >
        {label}
      </text>
    </g>
  );
}

/** A vertical measure in one of the gutters. Name and value stack, so the label stays
 *  narrow enough for two measures to sit either side of the drawing without meeting. */
function VDim({
  f, z1, z2, wmm, col = 0, side = 'left', name, value, on,
}: {
  f: Frame; z1: number; z2: number; wmm: number; col?: number; side?: 'left' | 'right'; name: string; value: string; on?: boolean;
}) {
  const left = side === 'left';
  const x = left ? f.ox - 10 - col * 14 : f.ox + wmm * f.s + 10 + col * 14;
  const edge = left ? X(f, 0) - 2 : X(f, wmm) + 2;
  const a = Y(f, z1), b = Y(f, z2);
  const c = on ? LIVE : MUTE;
  const tx = left ? x - 4 : x + 4;
  const my = (a + b) / 2;
  return (
    <g stroke={c} fill={c} strokeWidth={on ? 1.2 : 0.8}>
      <line x1={x} y1={a} x2={edge} y2={a} strokeDasharray="2,2" opacity={0.55} />
      <line x1={x} y1={b} x2={edge} y2={b} strokeDasharray="2,2" opacity={0.55} />
      <line x1={x} y1={a} x2={x} y2={b} />
      <path d={`M${x - 2.5} ${a - 3.5}L${x} ${a}L${x + 2.5} ${a - 3.5}Z`} stroke="none" />
      <path d={`M${x - 2.5} ${b + 3.5}L${x} ${b}L${x + 2.5} ${b + 3.5}Z`} stroke="none" />
      <text
        x={tx}
        y={my - 1}
        textAnchor={left ? 'end' : 'start'}
        stroke="none"
        fontSize={9.5}
        fontWeight={on ? 700 : 400}
        className="font-mono"
      >
        {name}
        <tspan x={tx} dy={10}>{value}</tspan>
      </text>
    </g>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-0.5 mb-2 text-[10.5px] leading-snug" style={{ color: MUTE }}>
      {children}
    </p>
  );
}

function Svg({ w, h, children }: { w: number; h: number; children: React.ReactNode }) {
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" className="block overflow-visible" style={{ maxHeight: h }} role="img">
      {children}
    </svg>
  );
}

// ---------- layout & walls ----------
// A slice straight across two neighbouring bins on the drawer floor: the drawer wall,
// the clearance to it, a bin with a divider in it, the gap, and its neighbour.
export function WallsCrossSection({ project: p, units, on }: { project: Project; units: Units; on: Highlight }) {
  const t = Math.max(0.4, p.wall), f = Math.max(0.4, p.floor), dT = Math.max(0.4, p.dividerThickness);
  const c = Math.max(0, p.clearance), g = Math.max(0, p.minGap);
  const jamb = 3.5; // the drawer's own side, drawn as a block
  const bay = 9; // a representative compartment, so the thicknesses have something to sit between
  const binA = t + bay + dT + bay + t;
  const binB = t + bay + t;
  const wall = 13; // representative bin wall height — this panel doesn't set it
  const wmm = jamb + c + binA + g + binB + c + jamb;
  const hmm = f + wall;

  const W = 292, gutL = 54, gutR = 10;
  const s = (W - gutL - gutR) / wmm;
  const f0: Frame = { s, ox: gutL, oy: 12, hmm };
  const H = 12 + hmm * s + 14 + 2 * 15 + 12;

  let x = 0;
  const at = (adv: number) => {
    const v = x;
    x += adv;
    return v;
  };
  const jambL = at(jamb), clearL = at(c), aX = at(binA), gapX = at(g), bX = at(binB);
  at(c); // the far clearance isn't labelled — it's the same measure as the near one
  const jambR = at(jamb);
  const box = (x0: number, x1: number, z0: number, z1: number): [number, number][] => [
    [x0, z0], [x1, z0], [x1, z1], [x0, z1],
  ];

  return (
    <>
      <Svg w={W} h={H}>
        {/* drawer sides */}
        <Shape f={f0} pts={box(jambL, jambL + jamb, 0, hmm)} fill={GHOST} />
        <Shape f={f0} pts={box(jambR, jambR + jamb, 0, hmm)} fill={GHOST} />
        {/* bin A: floor slab, two outer walls, one divider */}
        <Shape f={f0} pts={box(aX, aX + binA, 0, f)} fill={BODY} />
        <Shape f={f0} pts={box(aX, aX + t, f, f + wall)} fill={BODY} />
        <Shape f={f0} pts={box(aX + t + bay, aX + t + bay + dT, f, f + wall * 0.82)} fill={BODY} />
        <Shape f={f0} pts={box(aX + binA - t, aX + binA, f, f + wall)} fill={BODY} />
        {/* bin B */}
        <Shape f={f0} pts={box(bX, bX + binB, 0, f)} fill={BODY} />
        <Shape f={f0} pts={box(bX, bX + t, f, f + wall)} fill={BODY} />
        <Shape f={f0} pts={box(bX + binB - t, bX + binB, f, f + wall)} fill={BODY} />

        <VDim f={f0} z1={0} z2={f} wmm={wmm} name="bin floor" value={units.fine(f)} on={on === 'floor'} />
        <HDim f={f0} x1={clearL} x2={clearL + c} row={0} label={'clearance ' + units.fine(c)} on={on === 'clearance'} from={hmm * 0.6} />
        <HDim f={f0} x1={gapX} x2={gapX + g} row={0} label={'min gap ' + units.fine(g)} on={on === 'minGap'} from={hmm * 0.6} />
        <HDim f={f0} x1={aX} x2={aX + t} row={1} label={'wall ' + units.fine(t)} on={on === 'wall'} from={f + wall * 0.45} />
        <HDim f={f0} x1={aX + t + bay} x2={aX + t + bay + dT} row={1} label={'divider ' + units.fine(dT)} on={on === 'dividerThickness'}
          from={f + wall * 0.35} />
      </Svg>
      <Caption>
        Across two bins on the drawer floor. <b>Snap</b> and <b>print gap</b> aren't shown — snap only sets how far the pointer jumps on
        the canvas, and the print gap spaces bins out on the build plate, not in the drawer.
      </Caption>
    </>
  );
}

// ---------- baseplate ----------
// A slice through the wall between two sockets, with a bin's foot dropped into the
// one on the left — the join every setting in this panel is really about.
export function PlateCrossSection({ project: p, units, on }: { project: Project; units: Units; on: Highlight }) {
  return gfOn(p) ? <GridfinitySection project={p} units={units} on={on} /> : <CustomSection project={p} units={units} on={on} />;
}

function GridfinitySection({ project: p, units, on }: { project: Project; units: Units; on: Highlight }) {
  const F = gfFloorH(p);
  const plate = GF.plateH;
  const foot = GF.footH;
  const floor = Math.max(0.4, p.floor);
  const land = GF.rimLand;
  const P = GF.pitch;
  // A window either side of the line two cells meet on. The whole 42 mm cell would put
  // the join — the only part worth looking at — in a handful of pixels.
  const half = 9;
  const x0 = P - half, x1 = P + half, wmm = x1 - x0;
  const stub = 3.5;
  const hmm = F + foot + floor + stub;

  const W = 292, gutL = 52, gutR = 48;
  const s = (W - gutL - gutR) / wmm;
  const f0: Frame = { s, ox: gutL, oy: 12, hmm };
  const H = 12 + hmm * s + 14 + 2 * 15 + 12;
  const rel = (x: number) => Math.min(Math.max(x - x0, 0), wmm);

  // the wall between the two pockets: its sides follow the pocket profile
  const rib: [number, number][] = [];
  GF.pocket.forEach(([z, ins]) => rib.push([rel(P - ins), F + z]));
  [...GF.pocket].reverse().forEach(([z, ins]) => rib.push([rel(P + ins), F + z]));

  // the foot of the bin on the left cell, cut off at the edge of the view
  const footL: [number, number][] = [[rel(x0), F]];
  GF.foot.forEach(([z, ins]) => footL.push([rel(P - ins), F + z]));
  footL.push([rel(x0), F + foot]);
  // and the neighbour's, mirrored
  const footR: [number, number][] = [[rel(x1), F]];
  GF.foot.forEach(([z, ins]) => footR.push([rel(P + ins), F + z]));
  footR.push([rel(x1), F + foot]);

  const binEdgeL = rel(P - GF.clear), binEdgeR = rel(P + GF.clear);
  const slabTop = F + foot + floor;

  return (
    <>
      <Svg w={W} h={H}>
        {F > 0 && (
          <Shape f={f0} pts={[[0, 0], [wmm, 0], [wmm, F], [0, F]]} fill={GHOST} dash="3,2" />
        )}
        <Shape f={f0} pts={rib} fill={BODY} />
        <Shape f={f0} pts={footL} fill={GHOST} />
        <Shape f={f0} pts={footR} fill={GHOST} />
        {/* the two bins' floor slabs and the walls that meet over the rib */}
        <Shape f={f0} pts={[[0, F + foot], [binEdgeL, F + foot], [binEdgeL, slabTop], [0, slabTop]]} fill={GHOST} />
        <Shape f={f0} pts={[[binEdgeR, F + foot], [wmm, F + foot], [wmm, slabTop], [binEdgeR, slabTop]]} fill={GHOST} />
        <Shape f={f0} pts={[[binEdgeL - p.wall, slabTop], [binEdgeL, slabTop], [binEdgeL, slabTop + stub], [binEdgeL - p.wall, slabTop + stub]]} fill={GHOST} />
        <Shape f={f0} pts={[[binEdgeR, slabTop], [binEdgeR + p.wall, slabTop], [binEdgeR + p.wall, slabTop + stub], [binEdgeR, slabTop + stub]]} fill={GHOST} />

        <VDim f={f0} z1={F} z2={F + plate} wmm={wmm} name="plate" value={units.fine(plate)} on={on === 'baseThick'} />
        {F > 0 && <VDim f={f0} z1={0} z2={F} wmm={wmm} col={1} name="magnets" value={units.fine(F)} on={on === 'gfPlateMagnets'} />}
        <VDim f={f0} z1={F} z2={F + foot} wmm={wmm} side="right" name="foot" value={units.fine(foot)} on={on === 'footH'} />
        <HDim f={f0} x1={rel(P - land / 2)} x2={rel(P + land / 2)} row={0} label={'rim ' + units.fine(land)} on={on === 'rimLand'} from={F + plate} />
        <HDim
          f={f0}
          x1={rel(P - GF.pocket[2][1])}
          x2={rel(P - GF.foot[2][1])}
          row={1}
          label={'fit ' + units.fine(GF.clear)}
          on={on === 'fitClear'}
          from={F + 2}
        />
      </Svg>
      <Caption>
        Two bins meeting over one wall of the plate. The wall's top is a {units.fine(land)} flat rather than the knife edge stock
        Gridfinity leaves there — it prints cleanly and doesn't chip, and the foot is pulled in to match so it still drops past.
      </Caption>
    </>
  );
}

function CustomSection({ project: p, units, on }: { project: Project; units: Units; on: Highlight }) {
  const geo = pegGeometry(p);
  const thick = Math.max(1, p.baseThick);
  const footH = Math.max(0.2, p.footH);
  const taperZ = Math.max(0, thick - footH);
  const floor = Math.max(0.4, p.floor);
  const U = geo.unit;
  // a window either side of the rib, not the whole cell — the rib is only `ringW` wide
  const half = Math.max(6, p.ringW * 2 + 4);
  const wmm = 2 * half;
  const stub = 0.6;
  const hmm = thick + floor + stub;

  const W = 292, gutL = 52, gutR = 48;
  const s = (W - gutL - gutR) / wmm;
  const f0: Frame = { s, ox: gutL, oy: 12, hmm };
  const H = 12 + hmm * s + 14 + 3 * 15 + 12;

  // distance from the middle of the rib out to the edge of the socket at height z
  const gap = (z: number) =>
    (U - (z <= taperZ ? geo.socketTop - 2 * geo.ti : geo.socketTop - 2 * geo.ti * (1 - (z - taperZ) / Math.max(0.01, footH)))) / 2;
  const clamp = (v: number) => Math.min(Math.max(v, 0), wmm);
  const rib: [number, number][] = [];
  const zs = [0, taperZ, thick];
  zs.forEach((z) => rib.push([clamp(half - gap(z)), z]));
  [...zs].reverse().forEach((z) => rib.push([clamp(half + gap(z)), z]));

  // the peg in the socket on the left, running off the edge of the view
  const pegEdge = (z: number) =>
    half - (U - geo.pegBottom - ((geo.pegTop - geo.pegBottom) * (z - taperZ)) / Math.max(0.01, footH)) / 2;
  const peg: [number, number][] = [
    [0, taperZ], [clamp(pegEdge(taperZ)), taperZ], [clamp(pegEdge(thick)), thick], [0, thick],
  ];
  const binHalf = clamp(pegEdge(thick) + 1.5);

  return (
    <>
      <Svg w={W} h={H}>
        <Shape f={f0} pts={rib} fill={BODY} />
        <Shape f={f0} pts={peg} fill={GHOST} />
        <Shape f={f0} pts={[[0, thick], [binHalf, thick], [binHalf, thick + floor], [0, thick + floor]]} fill={GHOST} />

        <VDim f={f0} z1={0} z2={thick} wmm={wmm} name="plate" value={units.fine(thick)} on={on === 'baseThick'} />
        <VDim f={f0} z1={taperZ} z2={thick} wmm={wmm} side="right" name="foot" value={units.fine(footH)} on={on === 'footH'} />
        <HDim f={f0} x1={clamp(pegEdge(thick))} x2={clamp(half - gap(thick))} row={0} label={'fit ' + units.fine(p.fitClear)}
          on={on === 'fitClear'} from={thick} />
        <HDim f={f0} x1={clamp(pegEdge(taperZ))} x2={clamp(pegEdge(thick))} row={1} label={'taper ' + units.fine(geo.ti)}
          on={on === 'footTaper'} from={taperZ + footH / 2} />
        <HDim f={f0} x1={clamp(half - gap(thick))} x2={clamp(half + gap(thick))} row={2} label={'wall ' + units.fine(p.ringW)}
          on={on === 'ringW'} from={thick} />
      </Svg>
      <Caption>
        From the middle of one socket to the middle of the next, with a bin's foot wedged into the left one. Foot taper = foot height
        gives the 45° self-aligning chamfer that prints without supports.
      </Caption>
    </>
  );
}
