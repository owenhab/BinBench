// Gridfinity mode swaps the custom socket for the published Gridfinity profile so the
// plate takes any Gridfinity bin and these bins drop into any Gridfinity baseplate.
//   pitch 42 mm; bins 42n − 0.5 (0.25 mm clearance per side); heights in 7 mm units
//   baseplate pocket, bottom→top: 0.7 chamfer, 1.8 vertical, 2.15 chamfer = 4.65 mm,
//     r4 at the top (open frame, no floor)
//   bin foot, bottom→top: 0.8 chamfer, 1.8 vertical, 2.15 chamfer = 4.75 mm,
//     r0.8 at the bottom growing to r3.75 at the top
//   every corner arc is centred 4 mm in from the cell edge, so radius = 4 − inset
//   magnet pockets 6.5 × 2.4 mm, 13 mm each way from the cell centre
//
// Stock Gridfinity runs each pocket's top chamfer out to the cell edge, so the wall
// between two pockets ends in a knife edge: fragile, and it chips. Rather than alter
// the published profile, the plate simply STOPS at the height where that chamfer has
// narrowed to `rimLand` across — nothing is moved, the top is just cut off. Every
// dimension below the cut is the published one, so a stock bin seats in our plate
// exactly as it would in any other, and our bins sit in a stock plate. The only
// difference is a plate `rimLand/2` shorter, with that much less chamfer to engage.
//
// This module owns the constants, the mode switch and every bit of snapping. The
// solids built from the same constants live in geometry.ts.
import { type Bin, type CustomBp, type Project, type Rect, usableBounds } from './model';

/** how wide the flat on top of the wall between two pockets should be, shared
 *  half-and-half by the two cells that meet there */
const RIM_LAND = 2;
const CLEAR = 0.25;

/** the published baseplate pocket, [z, inset from the cell edge] */
const POCKET_PUBLISHED: [number, number][] = [[0, 2.85], [0.7, 2.15], [2.5, 2.15], [4.65, 0]];

/** Cut a [z, inset] profile off where it first narrows past `inset`, keeping every
 *  point below the cut exactly where the standard puts it. */
function truncateAt(prof: [number, number][], inset: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < prof.length; i++) {
    const [z, ins] = prof[i];
    if (ins >= inset) {
      out.push([z, ins]);
      continue;
    }
    const [pz, pins] = prof[i - 1];
    out.push([Math.round((pz + ((pins - inset) / (pins - ins)) * (z - pz)) * 1e6) / 1e6, inset]);
    break;
  }
  return out;
}
const POCKET = truncateAt(POCKET_PUBLISHED, RIM_LAND / 2);

export const GF = {
  pitch: 42,
  clear: CLEAR,
  rimLand: RIM_LAND,
  hUnit: 7,
  /** shorter than the published 4.65: the chamfer is cut where it reaches `rimLand` */
  plateH: POCKET[POCKET.length - 1][0],
  footH: 4.75,
  rc: 4,
  /** [z, inset from the cell edge] */
  pocket: POCKET,
  foot: [[0, 3.2], [0.8, 2.4], [2.6, 2.4], [4.75, 0.25]] as [number, number][],
  magR: 3.25,
  magDepth: 2.4,
  magOff: 13,
  /** a leftover strip narrower than this at the wall is ignored */
  minPartial: 1,
  // magnet baseplate (as gridfinity-rebuilt-openscad's skeletonized plate): a floor
  // of skin + magnet depth under the pockets, magnet pockets 8 mm in from each side
  skin: 1,
  floorRing: 6,
  floorPad: 15,
  magBox: 4.5,
};
/** segments per quarter arc; even, so one ray lands on the diagonal */
export const GF_ARC = 6;

export const CUSTOM_BP_FALLBACK: CustomBp = { unit: 42, baseThick: 5, footH: 3, footTaper: 3, fitClear: 0.25, ringW: 2.5 };

export function gfOn(p: Project) {
  return !!p.gridfinity;
}
/** Whether bins are held to whole cells and whole height units. The profile is the
 *  Gridfinity one either way — this only governs the snapping, so a free-sized bin
 *  still grows the standard foot on whatever cells it reaches, trimmed to its own
 *  outline, and still drops into the same plate. */
export function gfSnaps(p: Project) {
  return gfOn(p) && p.gfWholeCells !== false;
}
/** height of the magnet floor under the pockets (0 for the open frame) */
export function gfFloorH(p: Project) {
  return p.gfPlateMagnets ? GF.skin + GF.magDepth : 0;
}
/** z a floor-level bin's underside rests at */
export function baseRestZ(p: Project) {
  if (!p.baseplateEnabled) return 0;
  return gfOn(p) ? gfFloorH(p) : Math.max(0, p.baseThick - p.footH);
}
// Gridfinity neighbours sit exactly 0.5 mm apart, so the grid itself sets the gap
export function minGapEff(p: Project) {
  return gfOn(p) ? Math.min(p.minGap, 2 * GF.clear) : p.minGap;
}

/** The plate settings Gridfinity mode owns outright, for the project it is on in. */
export function gridfinityValues(p: Project) {
  return { unit: GF.pitch, baseThick: GF.plateH + gfFloorH(p), footH: GF.footH, fitClear: GF.clear };
}

/** Switching the mode on parks the custom values so switching it off again gives
 *  them back untouched. */
export function setGridfinity(p: Project, on: boolean): Project {
  if (!on) return { ...p, ...(p.customBp ?? CUSTOM_BP_FALLBACK), gridfinity: false };
  const customBp: CustomBp = {
    unit: p.unit, baseThick: p.baseThick, footH: p.footH,
    footTaper: p.footTaper, fitClear: p.fitClear, ringW: p.ringW,
  };
  const on1: Project = { ...p, customBp, gridfinity: true };
  const on2: Project = { ...on1, ...gridfinityValues(on1) };
  return gfSnaps(on2) ? { ...on2, bins: gfSnapAllBins(on2) } : on2;
}

/** Turning the snapping back on brings the bins already in the drawer with it. */
export function setWholeCells(p: Project, on: boolean): Project {
  const next: Project = { ...p, gfWholeCells: on };
  return gfSnaps(next) ? { ...next, bins: gfSnapAllBins(next) } : next;
}

// ---------- snapping ----------
// Grid lines along each axis: every 42 mm from the near wall, plus the far wall
// itself when it leaves a part cell, so bins can run into that leftover strip.
export function gfLines(p: Project) {
  const bnd = usableBounds(p), P = GF.pitch;
  const mk = (lo: number, hi: number) => {
    const L: number[] = [];
    for (let i = 0; lo + i * P <= hi + 1e-6; i++) L.push(lo + i * P);
    if (hi - L[L.length - 1] >= GF.minPartial || L.length < 2) L.push(hi);
    return L;
  };
  return { bnd, X: mk(bnd.minX, bnd.maxX), Y: mk(bnd.minY, bnd.maxY) };
}

function nearestIdx(L: number[], v: number, lo: number, hi: number) {
  let best = lo;
  for (let i = lo; i <= hi; i++) if (Math.abs(L[i] - v) < Math.abs(L[best] - v)) best = i;
  return best;
}

/** Pick the start/end grid lines for one axis. `cover` takes every cell the span
 *  touches (drawing a new bin); otherwise each edge goes to its nearest line. */
export function gfSpan(L: number[], a: number, z: number, cover: boolean): [number, number] {
  const n = L.length - 1, c = GF.clear;
  let i0: number, i1: number;
  if (cover) {
    i0 = 0;
    for (let i = 0; i < n; i++) if (L[i] <= a + 1e-6) i0 = i;
    i1 = n;
    for (let j = n; j > i0; j--) if (L[j] >= z - 1e-6) i1 = j;
  } else {
    i0 = nearestIdx(L, a - c, 0, n - 1);
    i1 = nearestIdx(L, z + c, i0 + 1, n);
  }
  return [i0, i1];
}

export function gfSnapEdges(p: Project, l: number, r: number, t: number, b: number, cover: boolean): Rect {
  const { X, Y } = gfLines(p), c = GF.clear;
  const [i0, i1] = gfSpan(X, l, r, cover), [j0, j1] = gfSpan(Y, t, b, cover);
  return { x: X[i0] + c, y: Y[j0] + c, w: X[i1] - X[i0] - 2 * c, d: Y[j1] - Y[j0] - 2 * c };
}

/** Moving a bin: keep how many cells it spans and drop it on the nearest run of that
 *  many. Its size follows the cells it lands on, so it grows or shrinks by the part
 *  cell when it moves on or off the leftover strip. */
export function gfSnapRect(p: Project, r: Rect): Rect {
  const { X, Y } = gfLines(p), c = GF.clear;
  const one = (L: number[], a: number, len: number): [number, number] => {
    const n = L.length - 1;
    const [s0, s1] = gfSpan(L, a, a + len, false);
    const k = Math.min(Math.max(1, s1 - s0), n);
    const i = nearestIdx(L, a - c, 0, n - k);
    return [L[i] + c, L[i + k] - L[i] - 2 * c];
  };
  const [x, w] = one(X, r.x, r.w), [y, d] = one(Y, r.y, r.d);
  return { x, y, w, d };
}

/** Wall height above the floor such that foot + floor + wall is a whole number of
 *  7 mm units (the Gridfinity height, not counting a stacking lip). */
export function gfUnitsFor(p: Project, h: number) {
  const base = GF.footH + p.floor;
  const uMin = Math.ceil((base + 3) / GF.hUnit); // at least ~3 mm of wall
  const uMax = Math.max(uMin, Math.floor((p.drawer.h - baseRestZ(p)) / GF.hUnit + 1e-6));
  return Math.min(Math.max(Math.round((h + base) / GF.hUnit), uMin), uMax);
}
export function gfSnapHeight(p: Project, h: number) {
  return gfUnitsFor(p, h) * GF.hUnit - GF.footH - p.floor;
}

/** Every bin onto whole cells and whole height units, dividers scaled with them. */
export function gfSnapAllBins(p: Project): Bin[] {
  const t = p.wall;
  return p.bins.map((b) => {
    const r = gfSnapRect(p, b);
    const kW = r.w / b.w, kD = r.d / b.d;
    const fix = (dv: Bin['dividersX'][number], own: number, perp: number, kO: number, kP: number) => ({
      p: Math.min(Math.max(dv.p * kO, t + 0.5), own - t - 0.5),
      a: Math.max(t, dv.a * kP),
      b: Math.min(perp - t, dv.b * kP),
      h: dv.h,
    });
    return {
      ...b,
      ...r,
      dividersX: (b.dividersX || []).map((dv) => fix(dv, r.w, r.d, kW, kD)),
      dividersY: (b.dividersY || []).map((dv) => fix(dv, r.d, r.w, kD, kW)),
      heightMM: b.parentId == null ? gfSnapHeight(p, b.heightMM) : b.heightMM,
    };
  });
}
