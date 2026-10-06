// Core data model and layout rules for Bin Bench. Every length here is in mm — the
// unit toggle only changes how values are displayed, never what is stored.

/** A divider is {p, a, b, h}: p = position along its own axis, [a,b] = the span it
 *  covers along the perpendicular axis, h = its height. h == null means "full
 *  height" and tracks the bin's height. */
export interface Divider {
  p: number;
  a: number;
  b: number;
  h: number | null;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  d: number;
}

export interface Bin extends Rect {
  id: number;
  color: string;
  label: string;
  heightMM: number;
  parentId: number | null;
  dividersX: Divider[];
  dividersY: Divider[];
}

export interface Obstruction extends Rect {
  id: number;
  label: string;
  h: number;
}

export interface ShelvedBin {
  shelfId: number;
  color: string;
  label: string;
  w: number;
  d: number;
  heightMM: number;
  lastX: number;
  lastY: number;
  dividersX: Divider[];
  dividersY: Divider[];
}

export interface Project {
  projectName: string;
  bed: { x: number; y: number; z: number };
  printerPreset: string;
  drawer: { w: number; d: number; h: number };
  unit: number;
  snap: number;
  clearance: number;
  gap: number;
  wall: number;
  floor: number;
  dividerThickness: number;
  minGap: number;
  baseplateEnabled: boolean;
  baseThick: number;
  footH: number;
  footTaper: number;
  fitClear: number;
  ringW: number;
  stackGap: number;
  paperGrid: number;
  bins: Bin[];
  blocked: Obstruction[];
  shelvedBins: ShelvedBin[];
  binCounter: number;
  blockCounter: number;
  shelfCounter: number;
}

// Natural pigment hues, spaced around the wheel so adjacent bins stay tellable
// apart at a glance, and mid-toned so the dark ink label reads on every one.
export const PALETTE = ['#8a9a5b', '#c9a13b', '#c07a55', '#b3583f', '#5f9fa8', '#6f7ea8', '#93708f', '#7a8570'];

export interface PrinterPreset {
  id: string;
  name: string;
  x: number | null;
  y: number | null;
  z: number | null;
}

export const PRINTERS: PrinterPreset[] = [
  { id: 'p1s', name: 'Bambu P1S / P1P', x: 256, y: 256, z: 256 },
  { id: 'x1c', name: 'Bambu X1C / X1E', x: 256, y: 256, z: 256 },
  { id: 'a1', name: 'Bambu A1', x: 256, y: 256, z: 256 },
  { id: 'a1mini', name: 'Bambu A1 mini', x: 180, y: 180, z: 180 },
  { id: 'h2d', name: 'Bambu H2D', x: 350, y: 320, z: 325 },
  { id: 'a2l', name: 'Bambu A2L', x: 330, y: 320, z: 325 },
  { id: 'custom', name: 'Custom…', x: null, y: null, z: null },
];

export function defaultProject(): Project {
  return {
    projectName: 'Untitled drawer',
    bed: { x: 256, y: 256, z: 256 },
    printerPreset: 'p1s',
    drawer: { w: 380, d: 450, h: 70 },
    unit: 42,
    snap: 1,
    clearance: 1,
    gap: 4,
    wall: 1,
    floor: 2.0,
    dividerThickness: 1.2,
    minGap: 0.5,
    baseplateEnabled: true,
    baseThick: 5,
    footH: 3,
    footTaper: 3,
    fitClear: 0.25,
    ringW: 2.5,
    stackGap: 1.0,
    paperGrid: 10,
    bins: [],
    blocked: [],
    shelvedBins: [],
    binCounter: 0,
    blockCounter: 0,
    shelfCounter: 0,
  };
}

export const num = (v: unknown, fallback: number | null): number | null => {
  const n = parseFloat(String(v));
  return isFinite(n) ? n : fallback;
};
/** `num` with a guaranteed numeric fallback. */
export const numOr = (v: unknown, fallback: number): number => num(v, fallback) as number;

export function snapTo(v: number, inc: number) {
  return Math.round(v / inc) * inc;
}
export function getSnap(p: Project) {
  return Math.max(0.1, p.snap || 1);
}

export function binName(b: { label?: string; id: number }) {
  return b.label || 'Bin ' + b.id;
}

export function cloneDividers(arr: Divider[] | undefined): Divider[] {
  return (arr || []).map((v) => ({ ...v }));
}

export function usableBounds(p: Project) {
  return { minX: p.clearance, minY: p.clearance, maxX: p.drawer.w - p.clearance, maxY: p.drawer.d - p.clearance };
}

// ---------- dividers ----------
export function evenDividers(size: number, n: number, spanA: number, spanB: number): Divider[] {
  const out: Divider[] = [];
  for (let i = 1; i < n; i++) out.push({ p: (size * i) / n, a: spanA, b: spanB, h: null });
  return out;
}

/** Resolved height of a divider, clamped to the bin it lives in. */
export function divH(dv: Divider, binHeight: number) {
  if (dv.h == null) return binHeight;
  return Math.min(Math.max(numOr(dv.h, binHeight), 0.4), binHeight);
}
export function isPartial(dv: Divider, binHeight: number) {
  return dv.h != null && divH(dv, binHeight) < binHeight - 0.01;
}

/** Given a divider's position, find the midpoint of the largest cell along the
 *  perpendicular axis. Anchoring a new divider here avoids the degenerate case
 *  where the bin's centre lands exactly on an existing perpendicular divider. */
export function bestRef(pos: number, perps: Divider[], wallLo: number, wallHi: number) {
  const bounds = [wallLo, wallHi];
  perps.forEach((pd) => {
    if (pos > pd.a + 0.01 && pos < pd.b - 0.01) bounds.push(pd.p);
  });
  bounds.sort((a, b) => a - b);
  let bestMid = (wallLo + wallHi) / 2,
    bestGap = -1;
  for (let i = 0; i < bounds.length - 1; i++) {
    const gap = bounds[i + 1] - bounds[i];
    if (gap > bestGap) {
      bestGap = gap;
      bestMid = (bounds[i] + bounds[i + 1]) / 2;
    }
  }
  return bestMid;
}

/** Given a divider's position and a reference point on the perpendicular axis,
 *  find the nearest perpendicular dividers (or walls) that bound it. */
export function autoSpan(pos: number, ref: number, perps: Divider[], wallLo: number, wallHi: number) {
  let lo = wallLo,
    hi = wallHi;
  perps.forEach((pd) => {
    if (pos <= pd.a + 0.01 || pos >= pd.b - 0.01) return; // this perp doesn't cross our line
    if (pd.p <= ref && pd.p > lo) lo = pd.p;
    if (pd.p >= ref && pd.p < hi) hi = pd.p;
  });
  if (hi - lo < 1) {
    lo = wallLo;
    hi = wallHi;
  } // degenerate — fall back to full span
  return { a: lo, b: hi };
}

export interface SnapCandidate {
  v: number;
  kind: 'wall' | 'divider' | 'align';
}

/** Candidates a divider end can snap to: the bin's inner walls, any perpendicular
 *  divider that crosses its line, and the endpoints of other parallel dividers. */
export function endSnapCandidates(
  pos: number,
  perps: Divider[],
  parallels: Divider[],
  selfIndex: number,
  wallLo: number,
  wallHi: number,
): SnapCandidate[] {
  const c: SnapCandidate[] = [
    { v: wallLo, kind: 'wall' },
    { v: wallHi, kind: 'wall' },
  ];
  perps.forEach((pd) => {
    if (pos > pd.a - 0.01 && pos < pd.b + 0.01) c.push({ v: pd.p, kind: 'divider' });
  });
  (parallels || []).forEach((pd, i) => {
    if (i === selfIndex) return;
    c.push({ v: pd.a, kind: 'align' });
    c.push({ v: pd.b, kind: 'align' });
  });
  return c;
}

export function snapEnd(val: number, cands: SnapCandidate[], tol: number) {
  let best: SnapCandidate | null = null,
    bestD = tol;
  cands.forEach((c) => {
    const dist = Math.abs(c.v - val);
    if (dist < bestD) {
      bestD = dist;
      best = c;
    }
  });
  return best as SnapCandidate | null;
}

export function rectsOverlap(a: Rect, b: Rect) {
  const eps = 0.05;
  return a.x < b.x + b.w - eps && a.x + a.w > b.x + eps && a.y < b.y + b.d - eps && a.y + a.d > b.y + eps;
}
export function rectInside(inner: Rect, outer: Rect) {
  const eps = 0.05;
  return (
    inner.x >= outer.x - eps &&
    inner.y >= outer.y - eps &&
    inner.x + inner.w <= outer.x + outer.w + eps &&
    inner.y + inner.d <= outer.y + outer.d + eps
  );
}

// ---------- stacking ----------
// Bins live in one flat list; `parentId` is what makes a stack. Level is always
// derived from the parent chain rather than stored, so it can never drift out of
// sync with the actual parent links after a load, delete, or re-parent.
export function binById(p: Project, id: number | null | undefined) {
  return p.bins.find((b) => b.id === id) || null;
}
export function binLevel(p: Project, bin: Bin) {
  let n = 1,
    cur: Bin | null = bin,
    guard = 0;
  while (cur && cur.parentId != null && guard++ < 64) {
    cur = binById(p, cur.parentId);
    if (cur) n++;
  }
  return n;
}
export function binsAtLevel(p: Project, n: number) {
  return p.bins.filter((b) => binLevel(p, b) === n);
}
export function childrenOf(p: Project, id: number) {
  return p.bins.filter((b) => b.parentId === id);
}
export function maxLevel(p: Project) {
  return p.bins.reduce((m, b) => Math.max(m, binLevel(p, b)), 1);
}
/** Every bin in a stack, from the given bin upward. `seen` guards against a cycle in
 *  hand-edited or corrupted input. */
export function descendantsOf(p: Project, id: number, out: Bin[] = [], seen = new Set([id])): Bin[] {
  childrenOf(p, id).forEach((c) => {
    if (seen.has(c.id)) return;
    seen.add(c.id);
    out.push(c);
    descendantsOf(p, c.id, out, seen);
  });
  return out;
}

/** A stacked bin has to bridge the open box below it, and an open box can only
 *  carry load on its rim walls — so an upper bin must span the lower bin's full
 *  width or its full depth (like a plank across two walls). */
export function spansParent(rect: Rect, parent: Rect) {
  const eps = 0.05;
  const fullW = Math.abs(rect.w - parent.w) <= eps && Math.abs(rect.x - parent.x) <= eps;
  const fullD = Math.abs(rect.d - parent.d) <= eps && Math.abs(rect.y - parent.y) <= eps;
  return fullW || fullD;
}
export function canStackOn(rect: Rect, parent: Rect | null) {
  if (!parent) return false;
  return rectInside(rect, parent) && spansParent(rect, parent);
}
/** The bin directly under this footprint on the level below, if any. */
export function parentCandidateFor(p: Project, rect: Rect, level: number) {
  if (level <= 1) return null;
  return binsAtLevel(p, level - 1).find((b) => rectInside(rect, b)) || null;
}

// ---------- vertical placement ----------
/** Recess cut into the top of every bin's rim so the next bin up can drop in and
 *  locate itself. */
export function lipGeometry(p: Project) {
  const c = Math.max(0, p.fitClear);
  // capped at the floor thickness so a stacked bin's seating rebate lives in its floor slab
  const depth = Math.max(0, Math.min(p.footH, p.floor));
  // fit clearance plus about a millimetre of actual bearing surface
  const ledge = Math.max(1.2, c + 1.0);
  const inset = p.wall + c;
  return { depth, ledge, inset, bearing: ledge - c };
}
/** Only a bin on the drawer floor grows feet. */
export function binFootH(p: Project, bin: Bin) {
  return bin.parentId == null ? Math.max(0, p.footH) : 0;
}
/** z of the underside of a bin's lowest geometry */
export function binBaseZ(p: Project, bin: Bin): number {
  const parent = bin.parentId != null ? binById(p, bin.parentId) : null;
  if (parent) return binTopZ(p, parent) - lipGeometry(p).depth;
  return p.baseplateEnabled ? Math.max(0, p.baseThick - p.footH) : 0;
}
/** z of the top of a bin's rim */
export function binTopZ(p: Project, bin: Bin): number {
  return binBaseZ(p, bin) + binFootH(p, bin) + p.floor + bin.heightMM;
}

export function obstructionH(p: Project, bl: Obstruction) {
  const h = num(bl.h, null);
  return h == null || !(h > 0) ? p.drawer.h : h; // legacy: no height = full height
}
/** base z shared by every bin on a level, using the tallest stack below as reference */
export function levelBaseZ(p: Project, level: number): number {
  if (level <= 1) return p.baseplateEnabled ? Math.max(0, p.baseThick - p.footH) : 0;
  const below = binsAtLevel(p, level - 1);
  if (!below.length) return levelBaseZ(p, level - 1);
  return Math.min(...below.map((b) => binBaseZ(p, b) + p.floor + b.heightMM));
}
/** An obstruction only blocks what it can actually reach. */
export function blockedAtLevel(p: Project, rect: Rect, level: number) {
  const g = p.minGap;
  const grown = { x: rect.x - g, y: rect.y - g, w: rect.w + 2 * g, d: rect.d + 2 * g };
  const baseZ = levelBaseZ(p, level || 1);
  return p.blocked.some((bl) => obstructionH(p, bl) > baseZ + 0.01 && rectsOverlap(grown, bl));
}
/** Bins may touch down to the minimum gap, but no closer. Only bins sharing a level collide. */
export function collidesAny(p: Project, rect: Rect, excludeId: number | null, level: number) {
  const g = p.minGap;
  const lv = level || 1;
  const grown = { x: rect.x - g, y: rect.y - g, w: rect.w + 2 * g, d: rect.d + 2 * g };
  for (const b of p.bins) {
    if (excludeId != null && b.id === excludeId) continue;
    if (binLevel(p, b) !== lv) continue;
    if (rectsOverlap(grown, b)) return true;
  }
  return blockedAtLevel(p, rect, lv);
}

/** Edge positions worth snapping to: the drawer walls, and every neighbour's edge
 *  offset by exactly the minimum gap (plus plain edge alignment). */
export function edgeCandidates(p: Project, excludeId: number | null, level: number) {
  const bnd = usableBounds(p);
  const g = p.minGap;
  const lv = level || 1;
  const L = [bnd.minX],
    R = [bnd.maxX],
    T = [bnd.minY],
    B = [bnd.maxY];
  const others: Rect[] = (binsAtLevel(p, lv).filter((b) => b.id !== excludeId) as Rect[]).concat(p.blocked);
  others.forEach((b) => {
    L.push(b.x + b.w + g, b.x);
    R.push(b.x - g, b.x + b.w);
    T.push(b.y + b.d + g, b.y);
    B.push(b.y - g, b.y + b.d);
  });
  if (lv > 1)
    binsAtLevel(p, lv - 1).forEach((b) => {
      L.push(b.x);
      R.push(b.x + b.w);
      T.push(b.y);
      B.push(b.y + b.d);
    });
  return { L, R, T, B };
}
export function nearestCand(val: number, cands: number[], tol: number) {
  let best: number | null = null,
    bd = tol;
  cands.forEach((c) => {
    const d = Math.abs(c - val);
    if (d < bd) {
      bd = d;
      best = c;
    }
  });
  return best as number | null;
}

/** Snap a rect being moved to the nearest edge candidates; returns new x/y and guides. */
export function snapMove(
  p: Project,
  rect: Rect,
  origX: number,
  origY: number,
  dx: number,
  dy: number,
  excludeId: number | null,
  level: number,
  tol: number,
) {
  const inc = getSnap(p),
    bnd = usableBounds(p);
  const cand = edgeCandidates(p, excludeId, level);
  const guides = { x: [] as number[], y: [] as number[] };
  let x = snapTo(origX + dx, inc),
    y = snapTo(origY + dy, inc);
  const sL = nearestCand(x, cand.L, tol),
    sR = nearestCand(x + rect.w, cand.R, tol);
  if (sL != null && (sR == null || Math.abs(sL - x) <= Math.abs(sR - (x + rect.w)))) {
    x = sL;
    guides.x.push(x);
  } else if (sR != null) {
    x = sR - rect.w;
    guides.x.push(sR);
  }
  const sT = nearestCand(y, cand.T, tol),
    sB = nearestCand(y + rect.d, cand.B, tol);
  if (sT != null && (sB == null || Math.abs(sT - y) <= Math.abs(sB - (y + rect.d)))) {
    y = sT;
    guides.y.push(y);
  } else if (sB != null) {
    y = sB - rect.d;
    guides.y.push(sB);
  }
  x = Math.min(Math.max(x, bnd.minX), bnd.maxX - rect.w);
  y = Math.min(Math.max(y, bnd.minY), bnd.maxY - rect.d);
  return { x, y, guides };
}

// ---------- sizes & fit ----------
/** printed height of a bin = foot (bottom layer only) + floor slab + wall height */
export function binPrintHeight(p: Project, bin: Bin) {
  return binFootH(p, bin) + p.floor + bin.heightMM;
}
export function binUsableDepth(p: Project, bin: Bin) {
  return Math.max(0, bin.heightMM - lipGeometry(p).depth);
}
/** What actually fits inside, after walls and the stacking collar. */
export function binInterior(p: Project, bin: Bin) {
  const lip = lipGeometry(p);
  const maxT = Math.max(p.wall, Math.min(bin.w, bin.d) / 2 - 0.6);
  const tw = Math.min(p.wall + lip.ledge, maxT);
  return { w: Math.max(0, bin.w - 2 * tw), d: Math.max(0, bin.d - 2 * tw), h: binUsableDepth(p, bin) };
}
export function binFit(p: Project, bin: Bin) {
  const bed = p.bed;
  const footprintFits = (bin.w <= bed.x && bin.d <= bed.y) || (bin.d <= bed.x && bin.w <= bed.y);
  const heightFits = binPrintHeight(p, bin) <= bed.z && binTopZ(p, bin) <= p.drawer.h;
  return { footprintFits, heightFits, ok: footprintFits && heightFits };
}

/** Find the first spot (scanning in the snap increment) where a w×d bin fits
 *  without colliding. Prefers a diagonal offset from a hint position. */
export function findFreeSlot(p: Project, w: number, d: number, hintX: number | null, hintY: number | null, level = 1) {
  const bnd = usableBounds(p);
  const inc = Math.max(getSnap(p), 1);
  const maxX = bnd.maxX - w,
    maxY = bnd.maxY - d;
  if (maxX < bnd.minX || maxY < bnd.minY) return null;
  const offsets = [
    [p.minGap + 2, p.minGap + 2],
    [w + p.minGap, 0],
    [0, d + p.minGap],
  ];
  for (const [ox, oy] of offsets) {
    const x = Math.min(Math.max((hintX ?? bnd.minX) + ox, bnd.minX), maxX);
    const y = Math.min(Math.max((hintY ?? bnd.minY) + oy, bnd.minY), maxY);
    if (!collidesAny(p, { x, y, w, d }, null, level)) return { x, y };
  }
  for (let y = bnd.minY; y <= maxY + 0.01; y += inc)
    for (let x = bnd.minX; x <= maxX + 0.01; x += inc)
      if (!collidesAny(p, { x: snapTo(x, inc), y: snapTo(y, inc), w, d }, null, level))
        return { x: snapTo(x, inc), y: snapTo(y, inc) };
  return null;
}

/** Shelve a bin and everything stacked on it. Returns the new project and how many were moved. */
export function shelveBin(p: Project, bin: Bin): { project: Project; count: number } {
  const group = [bin].concat(descendantsOf(p, bin.id));
  let shelfCounter = p.shelfCounter;
  const shelved: ShelvedBin[] = group.map((b) => ({
    shelfId: ++shelfCounter,
    color: b.color,
    label: b.label,
    w: b.w,
    d: b.d,
    heightMM: b.heightMM,
    lastX: b.x,
    lastY: b.y,
    dividersX: cloneDividers(b.dividersX),
    dividersY: cloneDividers(b.dividersY),
  }));
  const ids = new Set(group.map((b) => b.id));
  return {
    project: {
      ...p,
      shelfCounter,
      shelvedBins: p.shelvedBins.concat(shelved),
      bins: p.bins.filter((b) => !ids.has(b.id)),
    },
    count: group.length,
  };
}
