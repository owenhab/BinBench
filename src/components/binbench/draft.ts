// The bin currently being drafted or edited, and the drag maths that reshape it.
import {
  type Divider,
  type Project,
  autoSpan,
  bestRef,
  binById,
  binLevel,
  cloneDividers,
  edgeCandidates,
  endSnapCandidates,
  getSnap,
  nearestCand,
  numOr,
  snapEnd,
  snapTo,
  usableBounds,
} from '@/lib/binbench/model';

export interface Draft {
  x: number;
  y: number;
  w: number;
  d: number;
  heightMM: number;
  dividersX: Divider[];
  dividersY: Divider[];
  label: string;
}
export interface Editing {
  mode: 'new' | 'edit';
  id?: number;
  color: string;
}
export type DragType =
  | 'move' | 'nw' | 'ne' | 'sw' | 'se'
  | 'divx' | 'divy' | 'divxa' | 'divxb' | 'divya' | 'divyb';

export interface Guides {
  x: number[];
  y: number[];
}
export interface SnapHint {
  x: number;
  y: number;
}

export function cloneDraft(d: Draft): Draft {
  return { ...d, dividersX: cloneDividers(d.dividersX), dividersY: cloneDividers(d.dividersY) };
}

/** Which level the thing being edited belongs to: an existing bin keeps its own, a
 *  fresh draft belongs to whichever level the user is looking at. */
export function draftLevel(p: Project, editing: Editing | null, activeLevel: number) {
  if (editing && editing.mode === 'edit') {
    const b = binById(p, editing.id);
    if (b) return binLevel(p, b);
  }
  return activeLevel || 1;
}

/** Resize the footprint, scaling dividers with it. Height is deliberately NOT scaled. */
export function setDraftSize(d: Draft, newW: number, newD: number) {
  const kW = d.w > 0 && newW > 0 ? newW / d.w : 1;
  const kD = d.d > 0 && newD > 0 ? newD / d.d : 1;
  if (kW !== 1 || kD !== 1) {
    d.dividersX = d.dividersX.map((dv) => ({ p: dv.p * kW, a: dv.a * kD, b: dv.b * kD, h: dv.h }));
    d.dividersY = d.dividersY.map((dv) => ({ p: dv.p * kD, a: dv.a * kW, b: dv.b * kW, h: dv.h }));
  }
  d.w = newW;
  d.d = newD;
}

export function clampDividers(d: Draft, wall: number) {
  const t = wall;
  const fix = (arr: Divider[], ownMax: number, perpMax: number) =>
    arr
      .map((dv) => {
        const p = Math.min(Math.max(dv.p, t + 0.5), ownMax - t - 0.5);
        let a = Math.min(Math.max(dv.a, t), perpMax - t);
        let b = Math.min(Math.max(dv.b, t), perpMax - t);
        if (b < a) [a, b] = [b, a];
        if (b - a < 1) b = Math.min(perpMax - t, a + 1);
        // h == null means full height; anything at/over the bin height collapses back to null
        let h = dv.h;
        if (h != null) {
          h = Math.max(0.4, numOr(h, d.heightMM));
          if (h >= d.heightMM - 0.01) h = null;
        }
        return { p, a, b, h };
      })
      .sort((m, n) => m.p - n.p);
  d.dividersX = fix(d.dividersX, d.w, d.d);
  d.dividersY = fix(d.dividersY, d.d, d.w);
}

export function addDivider(d: Draft, axis: 'x' | 'y', wall: number): Draft {
  const n = cloneDraft(d);
  const t = wall;
  if (axis === 'x') {
    const pos = n.w / 2;
    const ref = bestRef(pos, n.dividersY, t, n.d - t);
    const span = autoSpan(pos, ref, n.dividersY, t, n.d - t);
    n.dividersX.push({ p: pos, a: span.a, b: span.b, h: null });
    n.dividersX.sort((a, b) => a.p - b.p);
  } else {
    const pos = n.d / 2;
    const ref = bestRef(pos, n.dividersX, t, n.w - t);
    const span = autoSpan(pos, ref, n.dividersX, t, n.w - t);
    n.dividersY.push({ p: pos, a: span.a, b: span.b, h: null });
    n.dividersY.sort((a, b) => a.p - b.p);
  }
  return n;
}

export interface DragCtx {
  project: Project;
  scale: number;
  excludeId: number | null;
  level: number;
}

/** Apply a pointer drag of (dx, dy) mm to a copy of `orig`. */
export function applyDrag(
  type: DragType,
  index: number,
  orig: Draft,
  dx: number,
  dy: number,
  ctx: DragCtx,
): { draft: Draft; guides: Guides; snapHint: SnapHint | null } {
  const p = ctx.project;
  const inc = getSnap(p);
  const bnd = usableBounds(p);
  const d = cloneDraft(orig);
  const guides: Guides = { x: [], y: [] };
  const t = p.wall;

  if (type === 'divx' || type === 'divy') {
    const isX = type === 'divx';
    const arr = isX ? d.dividersX : d.dividersY;
    const src = isX ? orig.dividersX : orig.dividersY;
    const ownMax = isX ? d.w : d.d;
    const delta = isX ? dx : dy;
    arr[index].p = Math.min(Math.max(snapTo(src[index].p + delta, inc), t + 0.5), ownMax - t - 0.5);
    return { draft: d, guides, snapHint: null };
  }
  if (type.startsWith('divx') || type.startsWith('divy')) {
    const isX = type.startsWith('divx');
    const key = type.endsWith('a') ? 'a' : 'b';
    const arr = isX ? d.dividersX : d.dividersY;
    const src = isX ? orig.dividersX : orig.dividersY;
    const perps = isX ? d.dividersY : d.dividersX;
    const perpMax = isX ? d.d : d.w;
    const delta = isX ? dy : dx;
    const pos = arr[index].p;

    let v = src[index][key] + delta;
    // snap radius is ~9 screen px, so it feels like a real magnet at any zoom
    const tol = Math.max(inc, 9 / ctx.scale);
    const hit = snapEnd(v, endSnapCandidates(pos, perps, arr, index, t, perpMax - t), tol);
    let snapHint: SnapHint | null = null;
    if (hit) {
      v = hit.v;
      snapHint = isX ? { x: pos, y: v } : { x: v, y: pos };
    } else {
      v = snapTo(v, inc);
    }
    v = Math.min(Math.max(v, t), perpMax - t);
    const other = key === 'a' ? arr[index].b : arr[index].a;
    if (key === 'a') arr[index].a = Math.min(v, other - 1);
    else arr[index].b = Math.max(v, other + 1);
    return { draft: d, guides, snapHint };
  }

  const cand = edgeCandidates(p, ctx.excludeId, ctx.level);
  const tol = Math.max(inc, 8 / ctx.scale);

  if (type === 'move') {
    let x = snapTo(orig.x + dx, inc), y = snapTo(orig.y + dy, inc);
    const sL = nearestCand(x, cand.L, tol), sR = nearestCand(x + d.w, cand.R, tol);
    if (sL != null && (sR == null || Math.abs(sL - x) <= Math.abs(sR - (x + d.w)))) { x = sL; guides.x.push(x); }
    else if (sR != null) { x = sR - d.w; guides.x.push(sR); }
    const sT = nearestCand(y, cand.T, tol), sB = nearestCand(y + d.d, cand.B, tol);
    if (sT != null && (sB == null || Math.abs(sT - y) <= Math.abs(sB - (y + d.d)))) { y = sT; guides.y.push(y); }
    else if (sB != null) { y = sB - d.d; guides.y.push(sB); }
    d.x = Math.min(Math.max(x, bnd.minX), bnd.maxX - d.w);
    d.y = Math.min(Math.max(y, bnd.minY), bnd.maxY - d.d);
    return { draft: d, guides, snapHint: null };
  }

  // corner resize — snap whichever edges are moving
  let left = orig.x, top = orig.y, right = orig.x + orig.w, bottom = orig.y + orig.d;
  const minSize = Math.max(inc, 4);
  if (type.includes('w')) {
    left = snapTo(orig.x + dx, inc);
    const sn = nearestCand(left, cand.L, tol); if (sn != null) { left = sn; guides.x.push(sn); }
  }
  if (type.includes('e')) {
    right = snapTo(orig.x + orig.w + dx, inc);
    const sn = nearestCand(right, cand.R, tol); if (sn != null) { right = sn; guides.x.push(sn); }
  }
  if (type.includes('n')) {
    top = snapTo(orig.y + dy, inc);
    const sn = nearestCand(top, cand.T, tol); if (sn != null) { top = sn; guides.y.push(sn); }
  }
  if (type.includes('s')) {
    bottom = snapTo(orig.y + orig.d + dy, inc);
    const sn = nearestCand(bottom, cand.B, tol); if (sn != null) { bottom = sn; guides.y.push(sn); }
  }
  if (right - left < minSize) { if (type.includes('w')) left = right - minSize; else right = left + minSize; }
  if (bottom - top < minSize) { if (type.includes('n')) top = bottom - minSize; else bottom = top + minSize; }
  left = Math.max(left, bnd.minX); top = Math.max(top, bnd.minY);
  right = Math.min(right, bnd.maxX); bottom = Math.min(bottom, bnd.maxY);

  // rescale from the original size
  setDraftSize(d, Math.max(minSize, right - left), Math.max(minSize, bottom - top));
  d.x = left;
  d.y = top;
  clampDividers(d, t);
  return { draft: d, guides, snapHint: null };
}

/** Snap a freshly dragged-out rectangle (creating a bin) to edges. */
export function createRect(p: Project, start: { x: number; y: number }, cur: { x: number; y: number }, scale: number, level: number) {
  const inc = getSnap(p), bnd = usableBounds(p);
  let x0 = snapTo(Math.min(start.x, cur.x), inc), x1 = snapTo(Math.max(start.x, cur.x), inc);
  let y0 = snapTo(Math.min(start.y, cur.y), inc), y1 = snapTo(Math.max(start.y, cur.y), inc);
  const cand = edgeCandidates(p, null, level);
  const tol = Math.max(inc, 8 / scale);
  const guides: Guides = { x: [], y: [] };
  const sx0 = nearestCand(x0, cand.L, tol); if (sx0 != null) { x0 = sx0; guides.x.push(x0); }
  const sx1 = nearestCand(x1, cand.R, tol); if (sx1 != null) { x1 = sx1; guides.x.push(x1); }
  const sy0 = nearestCand(y0, cand.T, tol); if (sy0 != null) { y0 = sy0; guides.y.push(y0); }
  const sy1 = nearestCand(y1, cand.B, tol); if (sy1 != null) { y1 = sy1; guides.y.push(y1); }
  const x = Math.max(x0, bnd.minX), y = Math.max(y0, bnd.minY);
  return {
    rect: { x, y, w: Math.max(Math.min(x1, bnd.maxX) - x, inc), d: Math.max(Math.min(y1, bnd.maxY) - y, inc) },
    guides,
  };
}
