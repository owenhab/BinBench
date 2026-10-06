// Solid geometry for Bin Bench. Solids are convex polyhedra {verts, faces} with faces
// wound CCW-outward. Keeping them convex means we can clip them against a build-plate
// seam exactly, which is what lets a socket be split across two printed tiles.
import {
  type Bin,
  type Project,
  binFootH,
  binsAtLevel,
  divH,
  lipGeometry,
  usableBounds,
} from './model';

export type Vec3 = [number, number, number];
export type Tri = [Vec3, Vec3, Vec3];
export interface Poly {
  verts: Vec3[];
  faces: number[][];
}
export interface Box2 {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
type Quad = [number, number][];

function triArea2(a: Vec3, b: Vec3, c: Vec3) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}
function pushTri(tris: Tri[], a: Vec3, b: Vec3, c: Vec3) {
  if (triArea2(a, b, c) > 1e-7) tris.push([a, b, c]);
}

export function boxPoly(x: number, y: number, z: number, sx: number, sy: number, sz: number): Poly {
  const verts: Vec3[] = [
    [x, y, z], [x + sx, y, z], [x + sx, y + sy, z], [x, y + sy, z],
    [x, y, z + sz], [x + sx, y, z + sz], [x + sx, y + sy, z + sz], [x, y + sy, z + sz],
  ];
  const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  return { verts, faces };
}
export function addBox(tris: Tri[], x: number, y: number, z: number, sx: number, sy: number, sz: number) {
  if (sx <= 0 || sy <= 0 || sz <= 0) return;
  polyToTris(boxPoly(x, y, z, sx, sy, sz), tris);
}
/** tapered prism between two 4-point rings (CCW seen from above) */
export function prismPoly(bq: Quad, tq: Quad, z0: number, z1: number): Poly {
  const verts = bq.map((p) => [p[0], p[1], z0] as Vec3).concat(tq.map((p) => [p[0], p[1], z1] as Vec3));
  const faces = [[0, 3, 2, 1], [4, 5, 6, 7]];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    faces.push([i, j, 4 + j, 4 + i]);
  }
  return { verts, faces };
}
export function polyToTris(poly: Poly, tris: Tri[]) {
  poly.faces.forEach((f) => {
    for (let i = 1; i < f.length - 1; i++) pushTri(tris, poly.verts[f[0]], poly.verts[f[i]], poly.verts[f[i + 1]]);
  });
  return tris;
}
function addPrism4(tris: Tri[], bq: Quad, tq: Quad, z0: number, z1: number) {
  if (z1 - z0 <= 0) return;
  polyToTris(prismPoly(bq, tq, z0, z1), tris);
}

// Clip a convex polyhedron by an axis-aligned half-space, capping the cut face.
// axis: 0=x 1=y 2=z. keepBelow: keep the side where coord <= value.
const CLIP_EPS = 1e-6;
function clipHalf(poly: Poly, axis: 0 | 1 | 2, value: number, keepBelow: boolean): Poly | null {
  const sd = poly.verts.map((v) => (keepBelow ? value - v[axis] : v[axis] - value));
  if (sd.every((d) => d >= -CLIP_EPS)) return poly; // wholly inside
  if (sd.every((d) => d <= CLIP_EPS)) return null; // wholly outside

  const verts: Vec3[] = [];
  const index = new Map<string, number>();
  const addV = (p: Vec3) => {
    const k = p[0].toFixed(4) + ',' + p[1].toFixed(4) + ',' + p[2].toFixed(4);
    const hit = index.get(k);
    if (hit !== undefined) return hit;
    const i = verts.length;
    verts.push(p);
    index.set(k, i);
    return i;
  };

  const faces: number[][] = [];
  poly.faces.forEach((face) => {
    const out: Vec3[] = [];
    for (let i = 0; i < face.length; i++) {
      const ci = face[i], cj = face[(i + 1) % face.length];
      const di = sd[ci], dj = sd[cj];
      const pi = poly.verts[ci], pj = poly.verts[cj];
      if (di >= -CLIP_EPS) out.push(pi);
      if ((di > CLIP_EPS && dj < -CLIP_EPS) || (di < -CLIP_EPS && dj > CLIP_EPS)) {
        const t = di / (di - dj);
        const ip: Vec3 = [pi[0] + (pj[0] - pi[0]) * t, pi[1] + (pj[1] - pi[1]) * t, pi[2] + (pj[2] - pi[2]) * t];
        ip[axis] = value; // land exactly on the plane
        out.push(ip);
      }
    }
    if (out.length < 3) return;
    const idx = out.map(addV).filter((v, i, a) => v !== a[(i + 1) % a.length]);
    if (idx.length >= 3) faces.push(idx);
  });

  // cap the opening: for a convex solid the cut is a single convex polygon
  const onPlane = verts.map((_, i) => i).filter((i) => Math.abs(verts[i][axis] - value) < 1e-4);
  if (onPlane.length >= 3) {
    const a1 = (axis + 1) % 3, a2 = (axis + 2) % 3; // (a1, a2, axis) is right-handed
    const cx = onPlane.reduce((s, i) => s + verts[i][a1], 0) / onPlane.length;
    const cy = onPlane.reduce((s, i) => s + verts[i][a2], 0) / onPlane.length;
    const ring = onPlane
      .slice()
      .sort(
        (i, j) =>
          Math.atan2(verts[i][a2] - cy, verts[i][a1] - cx) - Math.atan2(verts[j][a2] - cy, verts[j][a1] - cx),
      );
    // CCW in (a1,a2) => normal along +axis, which is outward when we kept the below side
    faces.push(keepBelow ? ring : ring.slice().reverse());
  }
  return { verts, faces };
}

function clipToRect(poly: Poly, x0: number, y0: number, x1: number, y1: number): Poly | null {
  let p: Poly | null = poly;
  p = clipHalf(p, 0, x0, false); if (!p) return null;
  p = clipHalf(p, 0, x1, true); if (!p) return null;
  p = clipHalf(p, 1, y0, false); if (!p) return null;
  p = clipHalf(p, 1, y1, true); if (!p) return null;
  return p;
}

function polyBounds(p: Poly): Box2 {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  p.verts.forEach((v) => {
    if (v[0] < x0) x0 = v[0];
    if (v[0] > x1) x1 = v[0];
    if (v[1] < y0) y0 = v[1];
    if (v[1] > y1) y1 = v[1];
  });
  return { x0, y0, x1, y1 };
}

// Cut axis-aligned holes out of a convex solid. Subtraction doesn't keep things
// convex, so each hole splits the solid into the four slabs that surround it — left,
// right, and the strips above and below between them — and we keep whatever survives.
function subtractHoles(poly: Poly, holes: Box2[]) {
  const BIG = 1e6;
  let pieces = [poly];
  holes.forEach((h) => {
    const next: Poly[] = [];
    pieces.forEach((p) => {
      const bb = polyBounds(p);
      if (h.x0 >= bb.x1 - 1e-6 || h.x1 <= bb.x0 + 1e-6 || h.y0 >= bb.y1 - 1e-6 || h.y1 <= bb.y0 + 1e-6) {
        next.push(p);
        return; // hole misses this piece entirely
      }
      [
        [-BIG, -BIG, h.x0, BIG],
        [h.x1, -BIG, BIG, BIG],
        [h.x0, -BIG, h.x1, h.y0],
        [h.x0, h.y1, h.x1, BIG],
      ].forEach((r) => {
        if (r[2] <= r[0] + 1e-9 || r[3] <= r[1] + 1e-9) return;
        const c = clipToRect(p, r[0], r[1], r[2], r[3]);
        if (c) next.push(c);
      });
    });
    pieces = next;
  });
  return pieces;
}
function translatePoly(poly: Poly, dx: number, dy: number, dz: number): Poly {
  return { verts: poly.verts.map((v) => [v[0] + dx, v[1] + dy, v[2] + dz] as Vec3), faces: poly.faces };
}

const rectQuad = (x0: number, y0: number, x1: number, y1: number): Quad => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

interface Interval {
  lo: number;
  hi: number;
}
function mergeIntervals(list: Interval[]) {
  const s = list.slice().sort((a, b) => a.lo - b.lo);
  const out: Interval[] = [];
  s.forEach((iv) => {
    const last = out[out.length - 1];
    if (last && iv.lo <= last.hi + 1e-6) last.hi = Math.max(last.hi, iv.hi);
    else out.push({ lo: iv.lo, hi: iv.hi });
  });
  return out;
}
function freeSegments(lo: number, hi: number, blocks: Interval[]) {
  const merged = mergeIntervals(blocks);
  const segs: Interval[] = [];
  let cur = lo;
  merged.forEach((b) => {
    const a = Math.max(lo, b.lo), z = Math.min(hi, b.hi);
    if (z <= cur) return;
    if (a > cur) segs.push({ lo: cur, hi: Math.min(a, hi) });
    cur = Math.max(cur, z);
  });
  if (cur < hi) segs.push({ lo: cur, hi: hi });
  return segs.filter((sg) => sg.hi - sg.lo > 0.05);
}

// ---------- socket grid ----------
// The plate carries a uniform grid of tapered sockets — one every "Grid reference"
// spacing — independent of any bin. A bin's foot is just a set of pegs, one per grid
// cell it substantially covers, so any bin can nest on any matching cells and the
// plate never has to be regenerated when bins move.
export function pegGeometry(p: Project) {
  const unit = Math.max(4, p.unit);
  const ringW = Math.max(0, p.ringW);
  const c = Math.max(0, p.fitClear);
  const socketTop = Math.max(2, unit - ringW); // socket opening, plate side
  const pegTop = Math.max(1, socketTop - 2 * c); // foot's top size, bin side
  const ti = Math.max(0.5, Math.min(p.footTaper, pegTop * 0.4 - 0.5));
  const pegBottom = Math.max(0.5, pegTop - 2 * ti);
  const socketBottom = pegBottom + 2 * c;
  return { unit, ti, socketTop, pegTop, pegBottom, socketBottom };
}

/** Obstruction footprints the plate has to dodge, grown by the fit clearance. */
function plateHoles(p: Project): Box2[] {
  const bnd = usableBounds(p);
  const c = Math.max(0, p.fitClear);
  return p.blocked
    .map((bl) => ({
      x0: Math.max(bnd.minX, bl.x - c),
      x1: Math.min(bnd.maxX, bl.x + bl.w + c),
      y0: Math.max(bnd.minY, bl.y - c),
      y1: Math.min(bnd.maxY, bl.y + bl.d + c),
    }))
    .filter((h) => h.x1 > h.x0 + 0.01 && h.y1 > h.y0 + 0.01);
}

interface GridCtx {
  bnd: ReturnType<typeof usableBounds>;
  unit: number;
  socketTop: number;
  taper: number;
  holes: Box2[];
  iMax: number;
  jMax: number;
}
// One shared description of the socket grid. The plate builder and the foot builder
// both read it, so they can never disagree about where a socket exists.
function gridContext(p: Project): GridCtx {
  const bnd = usableBounds(p);
  const geo = pegGeometry(p);
  return {
    bnd,
    unit: geo.unit,
    socketTop: geo.socketTop,
    taper: geo.ti,
    holes: plateHoles(p),
    iMax: Math.ceil((bnd.maxX - bnd.minX) / geo.unit - 1e-6) - 1,
    jMax: Math.ceil((bnd.maxY - bnd.minY) / geo.unit - 1e-6) - 1,
  };
}
function gridCellRect(i: number, j: number, ctx: GridCtx): Box2 {
  const cx0 = ctx.bnd.minX + i * ctx.unit, cy0 = ctx.bnd.minY + j * ctx.unit;
  return { x0: cx0, y0: cy0, x1: Math.min(cx0 + ctx.unit, ctx.bnd.maxX), y1: Math.min(cy0 + ctx.unit, ctx.bnd.maxY) };
}

export interface SocketInfo {
  outer: Box2;
  op: Box2;
  narrow: Box2;
  ti: number;
  cx: number;
  cy: number;
}
// The socket at (i,j) — or null wherever the plate can't offer one: off the grid, or
// a sliver at the wall too narrow to seat a foot. Obstructions deliberately do NOT
// cancel a socket: they're subtracted from the finished plate instead.
function gridSocketAt(i: number, j: number, ctx: GridCtx): SocketInfo | null {
  if (i < 0 || j < 0 || i > ctx.iMax || j > ctx.jMax) return null;
  const outer = gridCellRect(i, j, ctx);
  if (outer.x1 - outer.x0 < 0.01 || outer.y1 - outer.y0 < 0.01) return null;
  const ccx = outer.x0 + ctx.unit / 2, ccy = outer.y0 + ctx.unit / 2;
  // the socket holds its true place on the pitch and is then trimmed by the wall
  const op = {
    x0: Math.max(ccx - ctx.socketTop / 2, outer.x0),
    x1: Math.min(ccx + ctx.socketTop / 2, outer.x1),
    y0: Math.max(ccy - ctx.socketTop / 2, outer.y0),
    y1: Math.min(ccy + ctx.socketTop / 2, outer.y1),
  };
  const sw = op.x1 - op.x0, sd = op.y1 - op.y0;
  if (sw < 2 || sd < 2) return null;
  // the taper can never eat more than half the opening, or the pocket inverts
  const ti = Math.max(0, Math.min(ctx.taper, sw / 2 - 0.2, sd / 2 - 0.2));
  // Where the wall has cut the socket off, the opening runs straight out that side
  // instead of tapering, so an incomplete edge socket can still seat a foot.
  const e = 0.01;
  const narrow = {
    x0: op.x0 + (op.x0 <= outer.x0 + e ? 0 : ti),
    x1: op.x1 - (op.x1 >= outer.x1 - e ? 0 : ti),
    y0: op.y0 + (op.y0 <= outer.y0 + e ? 0 : ti),
    y1: op.y1 - (op.y1 >= outer.y1 - e ? 0 : ti),
  };
  return { outer, op, narrow, ti, cx: ccx, cy: ccy };
}

/** How far a bin's underside pulls in from its own outline. */
function binBottomInset(p: Project, bin: Bin) {
  return Math.min(lipGeometry(p).inset, Math.min(bin.w, bin.d) / 2 - 0.5);
}

const MIN_FOOT = 2; // narrower than this is a splinter, not a foot worth printing

/** The feet a bin grows, one per grid cell its footprint reaches into, each already
 *  clipped to the bin's own underside. A cell the bin only grazes is dropped. */
export function footCellsFor(p: Project, bin: Bin, unit: number) {
  const ctx = gridContext(p);
  const geo = pegGeometry(p);
  const ins = binBottomInset(p, bin);
  const htop = geo.pegTop / 2, hbot = geo.pegBottom / 2;
  const ox = ctx.bnd.minX, oy = ctx.bnd.minY;
  const onPlate = bin.parentId == null && p.baseplateEnabled;
  const iMin = Math.floor((bin.x - ox) / unit), iEnd = Math.ceil((bin.x + bin.w - ox) / unit) - 1;
  const jMin = Math.floor((bin.y - oy) / unit), jEnd = Math.ceil((bin.y + bin.d - oy) / unit) - 1;
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  const cells: { cx: number; cy: number; top: Box2; bot: Box2 }[] = [];
  for (let j = jMin; j <= jEnd; j++)
    for (let i = iMin; i <= iEnd; i++) {
      const cx0 = ox + i * unit, cx1 = cx0 + unit, cy0 = oy + j * unit, cy1 = cy0 + unit;
      const ox0 = Math.max(cx0, bin.x), ox1 = Math.min(cx1, bin.x + bin.w);
      const oy0 = Math.max(cy0, bin.y), oy1 = Math.min(cy1, bin.y + bin.d);
      if (ox1 <= ox0 || oy1 <= oy0) continue;
      if (onPlate && !gridSocketAt(i, j, ctx)) continue;

      const lx = cx0 + unit / 2 - bin.x, ly = cy0 + unit / 2 - bin.y;
      const top = {
        x0: Math.max(ins, lx - htop),
        x1: Math.min(bin.w - ins, lx + htop),
        y0: Math.max(ins, ly - htop),
        y1: Math.min(bin.d - ins, ly + htop),
      };
      if (top.x1 - top.x0 < MIN_FOOT || top.y1 - top.y0 < MIN_FOOT) continue;
      // the tapered base sits inside the top face; on a side the clip already cut, it
      // stops flush there instead, leaving that face vertical
      const bot = {
        x0: clamp(Math.max(ins, lx - hbot), top.x0, top.x1),
        x1: clamp(Math.min(bin.w - ins, lx + hbot), top.x0, top.x1),
        y0: clamp(Math.max(ins, ly - hbot), top.y0, top.y1),
        y1: clamp(Math.min(bin.d - ins, ly + hbot), top.y0, top.y1),
      };
      if (bot.x1 < bot.x0) { const m = (bot.x0 + bot.x1) / 2; bot.x0 = bot.x1 = m; }
      if (bot.y1 < bot.y0) { const m = (bot.y0 + bot.y1) / 2; bot.y0 = bot.y1 = m; }
      cells.push({ cx: cx0 + unit / 2, cy: cy0 + unit / 2, top, bot });
    }
  return cells;
}

/** True when a floor bin straddles the grid without covering enough of any cell to grow a foot. */
export function isLooseBin(p: Project, bin: Bin, level: number) {
  return level === 1 && p.baseplateEnabled && footCellsFor(p, bin, pegGeometry(p).unit).length === 0;
}

// ---------- bin ----------
// Every bin carries a rim the next one up can sit on. One on the drawer floor grows
// feet to match the baseplate grid, while a stacked bin has a plain flat floor with a
// rebate round its edge. Geometry follows the bin's CURRENT level.
export function binTriangles(p: Project, bin: Bin): Tri[] {
  const tris: Tri[] = [];
  const W = bin.w, D = bin.d;
  const t = p.wall, f = p.floor, h = bin.heightMM;
  const fh = binFootH(p, bin);
  const stacked = bin.parentId != null;
  const lip = lipGeometry(p);
  const ins = binBottomInset(p, bin);

  if (!stacked && fh > 0) {
    footCellsFor(p, bin, pegGeometry(p).unit).forEach((c) => {
      addPrism4(tris, rectQuad(c.bot.x0, c.bot.y0, c.bot.x1, c.bot.y1), rectQuad(c.top.x0, c.top.y0, c.top.x1, c.top.y1), 0, fh);
    });
  }
  const z0 = Math.max(fh, 0);
  if (stacked) {
    // flat floor, stepped in round the outside for the depth of the collar below
    const n = Math.max(0, Math.min(lip.depth, f));
    if (n > 0.01 && ins > 0.01) {
      addBox(tris, ins, ins, 0, W - 2 * ins, D - 2 * ins, n);
      if (f - n > 0.01) addBox(tris, 0, 0, n, W, D, f - n);
    } else {
      addBox(tris, 0, 0, 0, W, D, f);
    }
  } else {
    // on the plate: the slab's underside is pulled in and chamfers back out
    const cham = Math.max(0, Math.min(ins, f));
    if (ins > 0.01 && cham > 0.01) {
      addPrism4(tris, rectQuad(ins, ins, W - ins, D - ins), rectQuad(0, 0, W, D), z0, z0 + cham);
      addBox(tris, 0, 0, z0 + cham, W, D, f - cham);
    } else {
      addBox(tris, 0, 0, z0, W, D, f);
    }
  }
  const wz = z0 + f;

  // Stacking shelf, built so nothing is ever printed over thin air: the wall runs
  // THICKER from the floor up to the shelf and then steps back to plain thickness
  // for the collar above it.
  const lipD = Math.max(0, Math.min(lip.depth, h - 0.6));
  const maxT = Math.max(t, Math.min(W, D) / 2 - 0.6);
  const tw = Math.min(t + lip.ledge, maxT);
  const hasLip = lipD > 0.01 && tw > t + 0.01;
  const shelfH = hasLip ? h - lipD : h;
  const wallT = hasLip ? tw : t;

  if (shelfH > 0.01) {
    addBox(tris, 0, 0, wz, W, wallT, shelfH);
    addBox(tris, 0, D - wallT, wz, W, wallT, shelfH);
    addBox(tris, 0, wallT, wz, wallT, D - 2 * wallT, shelfH);
    addBox(tris, W - wallT, wallT, wz, wallT, D - 2 * wallT, shelfH);
  }
  if (hasLip) {
    const cz = wz + shelfH;
    addBox(tris, 0, 0, cz, W, t, lipD);
    addBox(tris, 0, D - t, cz, W, t, lipD);
    addBox(tris, 0, t, cz, t, D - 2 * t, lipD);
    addBox(tris, W - t, t, cz, t, D - 2 * t, lipD);
  }

  const dT = p.dividerThickness;
  // a divider stops at the shelf — any taller and it would hold the next bin off its seat
  const dCap = (hh: number) => Math.min(hh, shelfH);
  (bin.dividersX || []).forEach((dv) => {
    const cx = dv.p - dT / 2;
    const a = Math.max(dv.a, wallT), b = Math.min(dv.b, D - wallT);
    if (cx >= wallT && cx + dT <= W - wallT && b - a > 0.01) addBox(tris, cx, a, wz, dT, b - a, dCap(divH(dv, h)));
  });
  (bin.dividersY || []).forEach((dv) => {
    const cy = dv.p - dT / 2;
    const a = Math.max(dv.a, wallT), b = Math.min(dv.b, W - wallT);
    if (cy >= wallT && cy + dT <= D - wallT && b - a > 0.01) addBox(tris, a, cy, wz, b - a, dT, dCap(divH(dv, h)));
  });
  return tris;
}

// ---------- baseplate ----------
/** Break a rectangle into the pieces left over once the holes are punched out of it. */
function rectsMinusHoles(r: Box2, holes: Box2[]) {
  const out: Box2[] = [];
  const rel = holes.filter((h) => h.x0 < r.x1 - 0.01 && h.x1 > r.x0 + 0.01 && h.y0 < r.y1 - 0.01 && h.y1 > r.y0 + 0.01);
  if (!rel.length) {
    if (r.x1 > r.x0 + 0.01 && r.y1 > r.y0 + 0.01) out.push({ x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 });
    return out;
  }
  const ys = new Set([r.y0, r.y1]);
  rel.forEach((h) => {
    if (h.y0 > r.y0) ys.add(h.y0);
    if (h.y1 < r.y1) ys.add(h.y1);
  });
  const bands = [...ys].sort((a, b) => a - b);
  for (let i = 0; i < bands.length - 1; i++) {
    const y0 = bands[i], y1 = bands[i + 1];
    if (y1 - y0 < 0.01) continue;
    const mid = (y0 + y1) / 2;
    const blocks = rel
      .filter((h) => h.y0 <= mid && h.y1 >= mid)
      .map((h) => ({ lo: Math.max(h.x0, r.x0), hi: Math.min(h.x1, r.x1) }));
    freeSegments(r.x0, r.x1, blocks).forEach((sg) => {
      if (sg.hi - sg.lo > 0.01) out.push({ x0: sg.lo, y0, x1: sg.hi, y1 });
    });
  }
  return out;
}

export interface Plate {
  solids: Poly[];
  infos: SocketInfo[];
  dropped: { outer: Box2 }[];
  holes: Box2[];
}

/** Built once for the whole drawer, then clipped per tile. An OPEN lattice: no floor
 *  slab, just the grid of walls between the sockets, with every socket running clear
 *  through. Obstructions come out of the finished plate in one pass at the end. */
export function buildPlate(p: Project): Plate {
  const thick = p.baseThick, fh = p.footH;
  const solids: Poly[] = [];
  const ctx = gridContext(p);
  const holes = ctx.holes;
  const infos: SocketInfo[] = [], dropped: { outer: Box2 }[] = [];
  for (let j = 0; j <= ctx.jMax; j++)
    for (let i = 0; i <= ctx.iMax; i++) {
      const outer = gridCellRect(i, j, ctx);
      if (outer.x1 - outer.x0 < 0.01 || outer.y1 - outer.y0 < 0.01) continue;
      const s = gridSocketAt(i, j, ctx);
      if (s) infos.push(s);
      else dropped.push({ outer });
    }

  // Rim walls around each opening. The taper is confined to the top, matching the
  // foot; below it the opening runs straight down and out through the bottom.
  const ring = (hb: Box2, ht: Box2, O: Box2, zb: number, zt: number) => {
    if (zt - zb <= 0.01) return;
    solids.push(prismPoly([[O.x0, O.y0], [O.x1, O.y0], [hb.x1, hb.y0], [hb.x0, hb.y0]], [[O.x0, O.y0], [O.x1, O.y0], [ht.x1, ht.y0], [ht.x0, ht.y0]], zb, zt));
    solids.push(prismPoly([[O.x1, O.y1], [O.x0, O.y1], [hb.x0, hb.y1], [hb.x1, hb.y1]], [[O.x1, O.y1], [O.x0, O.y1], [ht.x0, ht.y1], [ht.x1, ht.y1]], zb, zt));
    solids.push(prismPoly([[O.x0, O.y1], [O.x0, O.y0], [hb.x0, hb.y0], [hb.x0, hb.y1]], [[O.x0, O.y1], [O.x0, O.y0], [ht.x0, ht.y0], [ht.x0, ht.y1]], zb, zt));
    solids.push(prismPoly([[O.x1, O.y0], [O.x1, O.y1], [hb.x1, hb.y1], [hb.x1, hb.y0]], [[O.x1, O.y0], [O.x1, O.y1], [ht.x1, ht.y1], [ht.x1, ht.y0]], zb, zt));
  };
  const taperZ = Math.max(0, thick - fh); // the tapered mouth occupies the top fh
  infos.forEach((inf) => {
    const A = inf.op, O = inf.outer;
    const narrow = inf.narrow;
    const wide = { x0: A.x0, x1: A.x1, y0: A.y0, y1: A.y1 };
    ring(narrow, narrow, O, 0, taperZ); // straight through-hole below
    ring(narrow, wide, O, taperZ, thick); // tapered mouth the foot wedges into
  });

  if (holes.length) {
    const cut: Poly[] = [];
    solids.forEach((poly) => subtractHoles(poly, holes).forEach((q) => cut.push(q)));
    solids.length = 0;
    cut.forEach((q) => solids.push(q));
  }
  return { solids, infos, dropped, holes };
}

/** Clip the plate to one tile, then give that tile its own edge frame. */
export function tileTriangles(p: Project, tile: Box2, plate: Plate): Tri[] {
  const tris: Tri[] = [];
  plate.solids.forEach((poly) => {
    const cp = clipToRect(poly, tile.x0, tile.y0, tile.x1, tile.y1);
    if (cp) polyToTris(translatePoly(cp, -tile.x0, -tile.y0, 0), tris);
  });

  const tw = tile.x1 - tile.x0, td = tile.y1 - tile.y0;
  const ribW = p.ringW, thick = p.baseThick;
  const blocks = plate.infos.map((i) => ({
    x0: i.outer.x0 - tile.x0,
    x1: i.outer.x1 - tile.x0,
    y0: i.outer.y0 - tile.y0,
    y1: i.outer.y1 - tile.y0,
  }));
  [0, tw - ribW].forEach((px) => {
    const bl = blocks.filter((b) => px < b.x1 && px + ribW > b.x0).map((b) => ({ lo: b.y0, hi: b.y1 }));
    freeSegments(0, td, bl).forEach((sg) => addBox(tris, px, sg.lo, 0, ribW, sg.hi - sg.lo, thick));
  });
  [0, td - ribW].forEach((py) => {
    const bl = blocks.filter((b) => py < b.y1 && py + ribW > b.y0).map((b) => ({ lo: b.x0, hi: b.x1 }));
    freeSegments(0, tw, bl).forEach((sg) => addBox(tris, sg.lo, py, 0, sg.hi - sg.lo, ribW, thick));
  });
  return tris;
}

// ---- Baseplate tiling ----
// planCuts: fewest cuts on one axis is ceil(span/maxSpan). Within that fixed count
// each seam has slack, so slide it into a gap between pockets when possible.
function planCuts(lo: number, hi: number, maxSpan: number, blocks: Interval[]) {
  const span = hi - lo;
  const n = Math.max(1, Math.ceil(span / maxSpan - 1e-9));
  const merged = mergeIntervals(blocks);
  const inBlock = (pos: number) => merged.some((b) => pos > b.lo + 0.01 && pos < b.hi - 0.01);
  const cuts = [lo];
  let cutsThroughPocket = 0;

  for (let i = 1; i < n; i++) {
    const ideal = lo + (span * i) / n;
    const winLo = Math.max(lo + 1, hi - (n - i) * maxSpan); // keep every tile printable
    const winHi = Math.min(hi - 1, lo + i * maxSpan);
    let best = ideal;
    if (inBlock(ideal)) {
      let found: number | null = null;
      const reach = Math.max(winHi - ideal, ideal - winLo);
      for (let d = 0.5; d <= reach + 0.5 && found === null; d += 0.5) {
        const a = ideal - d, b = ideal + d;
        if (a >= winLo && !inBlock(a)) found = a;
        else if (b <= winHi && !inBlock(b)) found = b;
      }
      if (found !== null) best = found;
      else cutsThroughPocket++;
    }
    cuts.push(Math.min(Math.max(best, winLo), winHi));
  }
  cuts.push(hi);
  return { cuts, cutsThroughPocket };
}

/** Tile the drawer for the baseplate — it always covers the whole drawer floor. */
export function computeBaseplateTiles(p: Project) {
  const pad = 4;
  const maxTileW = Math.max(20, p.bed.x - pad * 2);
  const maxTileD = Math.max(20, p.bed.y - pad * 2);
  const bnd = usableBounds(p);
  const plate = buildPlate(p);
  const rects = plate.infos.map((i) => i.outer);

  const X = planCuts(bnd.minX, bnd.maxX, maxTileW, rects.map((r) => ({ lo: r.x0, hi: r.x1 })));
  const Y = planCuts(bnd.minY, bnd.maxY, maxTileD, rects.map((r) => ({ lo: r.y0, hi: r.y1 })));

  const tiles: Box2[] = [];
  for (let r = 0; r < Y.cuts.length - 1; r++)
    for (let c = 0; c < X.cuts.length - 1; c++)
      tiles.push({ x0: X.cuts[c], x1: X.cuts[c + 1], y0: Y.cuts[r], y1: Y.cuts[r + 1] });

  const touch = new Map<Box2, SocketInfo[]>();
  let splitCount = 0;
  plate.infos.forEach((inf) => {
    const hit = tiles.filter(
      (t) => inf.outer.x0 < t.x1 - 0.01 && inf.outer.x1 > t.x0 + 0.01 && inf.outer.y0 < t.y1 - 0.01 && inf.outer.y1 > t.y0 + 0.01,
    );
    if (hit.length > 1) splitCount++;
    hit.forEach((t) => {
      if (!touch.has(t)) touch.set(t, []);
      touch.get(t)!.push(inf);
    });
  });

  return { tiles, plate, touch, splitCount, seamsThroughPockets: X.cutsThroughPocket + Y.cutsThroughPocket };
}

// ---------- stacked plate printing ----------
// One print job with every baseplate section piled up. Alternate flips put mouth
// against mouth and throat against throat; a shared grid keeps walls over walls; and
// biggest-first means nothing juts out over air.
function flipTrisAboutX(tris: Tri[], d: number, h: number): Tri[] {
  // 180° about the X axis — mirroring two axes is a rotation, so winding survives
  return tris.map((t) => t.map((v) => [v[0], d - v[1], h - v[2]]) as Tri);
}

// Sections cut for stacking are cut on cell boundaries, so every section is a whole
// number of cells and no socket is ever split across a seam.
function stackCuts(lo: number, hi: number, maxSpan: number, unit: number) {
  const per = Math.max(1, Math.floor(maxSpan / unit));
  const cuts = [lo];
  let x = lo;
  while (hi - x > per * unit + 0.01) {
    x += per * unit;
    cuts.push(x);
  }
  cuts.push(hi);
  if (cuts.length >= 3) {
    const last = cuts[cuts.length - 1] - cuts[cuts.length - 2];
    const prev = cuts[cuts.length - 2] - cuts[cuts.length - 3];
    if (last < unit * 0.5 && last + prev <= maxSpan) cuts.splice(cuts.length - 2, 1);
  }
  return cuts;
}
function stackTiles(p: Project) {
  const bnd = usableBounds(p), unit = pegGeometry(p).unit, pad = 4;
  const maxW = Math.max(unit, p.bed.x - pad * 2), maxD = Math.max(unit, p.bed.y - pad * 2);
  const X = stackCuts(bnd.minX, bnd.maxX, maxW, unit);
  const Y = stackCuts(bnd.minY, bnd.maxY, maxD, unit);
  const tiles: Box2[] = [];
  for (let r = 0; r < Y.length - 1; r++)
    for (let c = 0; c < X.length - 1; c++) tiles.push({ x0: X[c], x1: X[c + 1], y0: Y[r], y1: Y[r + 1] });
  return tiles.filter((t) => t.x1 - t.x0 > 0.5 && t.y1 - t.y0 > 0.5);
}

/** The material a section presents at one of its faces, as plain rectangles. */
function faceRects(tile: Box2, plate: Plate, kind: 'mouth' | 'throat') {
  const out: Box2[] = [];
  plate.infos.forEach((inf) => {
    const o = {
      x0: Math.max(inf.outer.x0, tile.x0),
      x1: Math.min(inf.outer.x1, tile.x1),
      y0: Math.max(inf.outer.y0, tile.y0),
      y1: Math.min(inf.outer.y1, tile.y1),
    };
    if (o.x1 <= o.x0 + 0.01 || o.y1 <= o.y0 + 0.01) return;
    const h = kind === 'mouth' ? inf.op : inf.narrow;
    rectsMinusHoles(o, [h].concat(plate.holes || [])).forEach((r) => out.push(r));
  });
  return out;
}
function placeRects(rects: Box2[], tile: Box2, flip: boolean, nd: number, dx: number, dy: number) {
  return rects.map((r) => {
    let y0 = r.y0 - tile.y0, y1 = r.y1 - tile.y0;
    if (flip) {
      const t = y0;
      y0 = nd - y1;
      y1 = nd - t;
    }
    return { x0: r.x0 - tile.x0 + dx, x1: r.x1 - tile.x0 + dx, y0: y0 + dy, y1: y1 + dy };
  });
}
function rectArea(r: Box2) {
  return Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
}
/** how much of `upper` has nothing under it — the exact overhang, in mm² */
function unsupportedArea(upper: Box2[], lower: Box2[]) {
  let a = 0;
  upper.forEach((r) => rectsMinusHoles(r, lower).forEach((q) => (a += rectArea(q))));
  return a;
}

export interface MeshObject {
  id: number;
  tris: Tri[];
  transform: Vec3;
  name?: string;
  plate?: number;
}

export function buildStackedPlates(p: Project) {
  const plate = buildPlate(p);
  const tiles = stackTiles(p);
  if (!tiles.length)
    return { piles: [], objects: [] as MeshObject[], notes: ['There are no baseplate sections to stack.'], height: 0, count: 0 };
  const thick = p.baseThick;
  const unit = pegGeometry(p).unit;
  const gapH = Math.max(0.2, p.stackGap);

  const sections = tiles
    .map((t) => {
      const w = t.x1 - t.x0, d = t.y1 - t.y0;
      return { t, w, d, nd: Math.ceil(d / unit - 1e-6) * unit };
    })
    .sort((a, b) => b.w * b.d - a.w * a.d);
  type Section = (typeof sections)[number];
  interface Pile {
    items: { s: Section; flip: boolean; dx: number; dy: number }[];
    topRects: Box2[];
    x0: number;
    x1: number;
    y0: number;
    y1: number;
  }

  // A section joins a pile only where its underside lands entirely on what is already there.
  const piles: Pile[] = [];
  const notes: string[] = [];
  sections.forEach((s) => {
    for (const pile of piles) {
      const flip = pile.items.length % 2 === 1;
      const raw = faceRects(s.t, plate, flip ? 'mouth' : 'throat');
      const my0 = flip ? s.nd - s.d : 0;
      let best: { dx: number; dy: number; bad: number } | null = null;
      for (let dx = pile.x0; dx + s.w <= pile.x1 + 0.01; dx += unit) {
        for (let dy = pile.y0 - my0; dy + my0 + s.d <= pile.y1 + 0.01; dy += unit) {
          const cand = placeRects(raw, s.t, flip, s.nd, dx, dy);
          const bad = unsupportedArea(cand, pile.topRects);
          if (!best || bad < best.bad) best = { dx, dy, bad };
          if (bad < 0.01) break;
        }
        if (best && best.bad < 0.01) break;
      }
      if (best && best.bad < 0.01) {
        pile.items.push({ s, flip, dx: best.dx, dy: best.dy });
        pile.topRects = placeRects(faceRects(s.t, plate, flip ? 'throat' : 'mouth'), s.t, flip, s.nd, best.dx, best.dy);
        pile.x0 = best.dx;
        pile.x1 = best.dx + s.w;
        pile.y0 = best.dy + my0;
        pile.y1 = best.dy + my0 + s.d;
        return;
      }
    }
    piles.push({
      items: [{ s, flip: false, dx: 0, dy: 0 }],
      topRects: placeRects(faceRects(s.t, plate, 'mouth'), s.t, false, s.nd, 0, 0),
      x0: 0, x1: s.w, y0: 0, y1: s.d,
    });
  });

  // Lay the piles out side by side, each pile ONE object (slicers drop free-standing
  // objects to the bed). Sections are separated by plain air for support to fill.
  const objects: MeshObject[] = [];
  let id = 0, originX = 0, tallest = 0;
  piles.forEach((pile) => {
    let z = 0, pw = 0;
    const merged: Tri[] = [];
    pile.items.forEach((it, k) => {
      const { s, flip, dx, dy } = it;
      if (k > 0) z += gapH;
      const tris = tileTriangles(p, s.t, plate);
      const oriented = flip ? flipTrisAboutX(tris, s.nd, thick) : tris;
      const zz = z;
      oriented.forEach((t) => merged.push(t.map((v) => [v[0] + dx, v[1] + dy, v[2] + zz]) as Tri));
      z += thick;
      pw = Math.max(pw, dx + s.w);
    });
    if (merged.length) objects.push({ id: ++id, tris: merged, transform: [originX, 0, 0] });
    tallest = Math.max(tallest, z);
    originX += pw + 6;
  });
  if (piles.length > 1)
    notes.push(
      'The sections could not all carry one another, so they are laid out as ' +
        piles.length +
        ' separate piles side by side — print them together if they fit your bed, or move them into separate jobs.',
    );
  return { piles, objects, notes, height: tallest, count: sections.length };
}

// ---------- plate packing ----------
export interface Placement {
  bin: Bin;
  x: number;
  y: number;
  w: number;
  d: number;
  rotated: boolean;
  oversize: boolean;
}
/** Shelf-pack every bin across build plates. */
export function packPlates(p: Project): Placement[][] {
  const bed = p.bed, margin = p.gap;
  const items = p.bins.map((b) => ({ bin: b, w: b.w, d: b.d })).sort((a, b) => b.d - a.d);
  const plates: Placement[][] = [];
  let plate: Placement[] = [], x = 0, shelfY = 0, shelfH = 0;
  const newPlate = () => {
    if (plate.length) plates.push(plate);
    plate = [];
    x = 0;
    shelfY = 0;
    shelfH = 0;
  };
  items.forEach((item) => {
    let w = item.w, d = item.d, rotated = false;
    const fitsNormal = w <= bed.x && d <= bed.y;
    const fitsRotated = d <= bed.x && w <= bed.y;
    if (!fitsNormal && fitsRotated) {
      [w, d] = [d, w];
      rotated = true;
    } else if (!fitsNormal && !fitsRotated) {
      plate.push({ bin: item.bin, x: 0, y: shelfY, w: Math.min(w, bed.x), d: Math.min(d, bed.y), rotated: false, oversize: true });
      return;
    }
    if (x + w > bed.x) {
      x = 0;
      shelfY += shelfH + margin;
      shelfH = 0;
    }
    if (shelfY + d > bed.y) newPlate();
    plate.push({ bin: item.bin, x, y: shelfY, w, d, rotated, oversize: false });
    x += w + margin;
    shelfH = Math.max(shelfH, d);
  });
  if (plate.length) plates.push(plate);
  return plates;
}

/** A bin laid down turned a quarter turn, brought back into the positive quadrant. */
function rotateTrisQuarter(tris: Tri[], d: number): Tri[] {
  return tris.map((t) => t.map((v) => [d - v[1], v[0], v[2]]) as Tri);
}
export function placedBinTris(p: Project, pl: Placement) {
  const tris = binTriangles(p, pl.bin);
  return pl.rotated ? rotateTrisQuarter(tris, pl.bin.d) : tris;
}

/** Level-1 bins, used by the plate previews for reference outlines. */
export function floorBins(p: Project) {
  return binsAtLevel(p, 1);
}
