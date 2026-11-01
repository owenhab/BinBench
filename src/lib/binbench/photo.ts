// Turning a photograph into millimetres.
//
// A ruler in the shot gives you scale, but scale alone is only honest if the camera
// was square-on — tilt the phone and one end of the ruler is nearer than the other,
// so a pixel is worth less there. Four points of a rectangle you know the size of
// pin down the whole plane instead, and that is what a homography is: the 3×3 that
// maps the photographed plane back to a flat one. Everything lying on that plane —
// the printed sheet, the item sitting on it — comes back true.
export type Pt = [number, number];

/** Row-major 3×3, the last entry fixed at 1. */
export type Homography = number[];

/** Solve the 8 unknowns of the map taking each `src` point to its `dst` partner.
 *  Four correspondences, no more and no fewer, which is what four corners gives. */
export function solveHomography(src: Pt[], dst: Pt[]): Homography | null {
  if (src.length !== 4 || dst.length !== 4) return null;
  // two rows per point: the usual direct linear transform, written out
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  const h = gauss(A, 8);
  if (!h) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** Gauss-Jordan with partial pivoting on an n×(n+1) augmented matrix. */
function gauss(m: number[][], n: number): number[] | null {
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    if (Math.abs(m[piv][c]) < 1e-12) return null; // the four points are not a quadrilateral
    [m[c], m[piv]] = [m[piv], m[c]];
    const d = m[c][c];
    for (let k = c; k <= n; k++) m[c][k] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c];
      if (!f) continue;
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.slice(0, n).map((row) => row[n]);
}

export function applyH(H: Homography, p: Pt): Pt {
  const w = H[6] * p[0] + H[7] * p[1] + H[8];
  const s = Math.abs(w) < 1e-12 ? 1e-12 : w;
  return [(H[0] * p[0] + H[1] * p[1] + H[2]) / s, (H[3] * p[0] + H[4] * p[1] + H[5]) / s];
}

/** The map for a photo taken square-on: one known length sets the scale, and the
 *  line's own direction sets which way is "along". Perspective is assumed away. */
export function scaleOnly(a: Pt, b: Pt, mm: number): Homography | null {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const px = Math.hypot(dx, dy);
  if (px < 1e-6 || !(mm > 0)) return null;
  const k = mm / px;
  // rotate so the measured line lies along x, then scale pixels to mm
  const c = (dx / px) * k, s = (dy / px) * k;
  return [c, s, -(c * a[0] + s * a[1]), -s, c, -(-s * a[0] + c * a[1]), 0, 0, 1];
}

export function bbox(poly: Pt[]) {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/** Shoelace, absolute — mm² once the points are in mm. */
export function polyArea(poly: Pt[]) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const q = poly[(i + 1) % poly.length];
    a += poly[i][0] * q[1] - q[0] * poly[i][1];
  }
  return Math.abs(a) / 2;
}

/** Ramer–Douglas–Peucker. A hand-traced outline carries far more points than the
 *  shape needs, and every one of them becomes wall segments in the end. */
export function simplify(poly: Pt[], tol: number): Pt[] {
  if (poly.length < 3) return poly.slice();
  const keep = new Array(poly.length).fill(false);
  keep[0] = keep[poly.length - 1] = true;
  const stack: [number, number][] = [[0, poly.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let far = -1, best = tol;
    for (let k = i + 1; k < j; k++) {
      const d = segDist(poly[k], poly[i], poly[j]);
      if (d > best) { best = d; far = k; }
    }
    if (far > 0) {
      keep[far] = true;
      stack.push([i, far], [far, j]);
    }
  }
  return poly.filter((_, i) => keep[i]);
}

function segDist(p: Pt, a: Pt, b: Pt) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Push every point out from the centroid by `mm`. A crude offset — a proper one
 *  walks each edge outward and reintersects them — but for a drop-in clearance on a
 *  roughly convex outline it is close enough to try. */
export function grow(poly: Pt[], mm: number): Pt[] {
  if (!poly.length) return poly;
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  return poly.map(([x, y]) => {
    const dx = x - cx, dy = y - cy;
    const r = Math.hypot(dx, dy) || 1;
    return [x + (dx / r) * mm, y + (dy / r) * mm] as Pt;
  });
}
