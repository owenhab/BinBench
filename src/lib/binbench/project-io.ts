// Project files: serialize to the v5 JSON format, and load every format Bin Bench has
// ever written.
import {
  type Bin,
  type Divider,
  type Obstruction,
  type Project,
  PALETTE,
  canStackOn,
  defaultProject,
  evenDividers,
  num,
  numOr,
  obstructionH,
  shelveBin,
} from './model';

const divOut = (v: Divider) => ({ p: v.p, a: v.a, b: v.b, h: v.h == null ? null : v.h });

export function serializeProject(p: Project) {
  const bins = p.bins.map((b) => ({
    id: b.id, color: b.color, label: b.label || '',
    x: b.x, y: b.y, w: b.w, d: b.d, heightMM: b.heightMM,
    parentId: b.parentId == null ? null : b.parentId,
    dividersX: (b.dividersX || []).map(divOut),
    dividersY: (b.dividersY || []).map(divOut),
  }));
  const blocked = p.blocked.map((b) => ({ id: b.id, label: b.label || '', x: b.x, y: b.y, w: b.w, d: b.d, h: obstructionH(p, b) }));
  const shelvedBins = p.shelvedBins.map((s) => ({
    shelfId: s.shelfId, color: s.color, label: s.label || '',
    w: s.w, d: s.d, heightMM: s.heightMM, lastX: s.lastX, lastY: s.lastY,
    dividersX: (s.dividersX || []).map(divOut),
    dividersY: (s.dividersY || []).map(divOut),
  }));
  return JSON.stringify(
    {
      version: 5, app: 'bin-bench',
      projectName: p.projectName,
      bed: p.bed, printerPreset: p.printerPreset, drawer: p.drawer,
      unit: p.unit, clearance: p.clearance, gap: p.gap, wall: p.wall, floor: p.floor,
      dividerThickness: p.dividerThickness, minGap: p.minGap,
      baseplateEnabled: p.baseplateEnabled, baseThick: p.baseThick,
      footH: p.footH, footTaper: p.footTaper, fitClear: p.fitClear, ringW: p.ringW,
      stackGap: p.stackGap, paperGrid: p.paperGrid,
      bins, blocked, shelvedBins,
      binCounter: p.binCounter, blockCounter: p.blockCounter, shelfCounter: p.shelfCounter,
    },
    null,
    2,
  );
}

// Accepts every format this app has ever written:
//   v1: grid cells {c0,r0,c1,r1} + subdivide
//   v2: {x,y,w,d} + columns/rows
//   v3: {x,y,w,d} + dividersX/Y as plain numbers (full span)
//   v4: {x,y,w,d} + dividersX/Y as {p,a,b} segments
//   v5: + divider heights, bin stacking (parentId), obstruction heights
// Returns null if the bin can't be salvaged.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrateBin(raw: any, wall: number, unit: number): Bin | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = { ...raw };
  const t = wall;
  const u = unit || 42;

  if (b.w == null && b.c0 != null) {
    b.x = numOr(b.c0, 0) * u;
    b.y = numOr(b.r0, 0) * u;
    b.w = (numOr(b.c1, 0) - numOr(b.c0, 0) + 1) * u;
    b.d = (numOr(b.r1, 0) - numOr(b.r0, 0) + 1) * u;
    if (b.subdivide) {
      b.columns = Math.round(b.w / u);
      b.rows = Math.round(b.d / u);
    }
  }
  const x = numOr(b.x, 0), y = numOr(b.y, 0), w = numOr(b.w, 0), d = numOr(b.d, 0);
  const heightMM = numOr(b.heightMM, 30);
  if (!(w > 0) || !(d > 0)) return null;

  let dX = b.dividersX, dY = b.dividersY;
  if (!dX && !dY) {
    dX = evenDividers(w, Math.max(1, numOr(b.columns, 1)), t, d - t);
    dY = evenDividers(d, Math.max(1, numOr(b.rows, 1)), t, w - t);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const up = (arr: any, perpMax: number): Divider[] =>
    (Array.isArray(arr) ? arr : [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((v: any) => {
        if (typeof v === 'number') return { p: v, a: t, b: perpMax - t, h: null };
        if (v && typeof v === 'object' && v.p != null)
          return { p: numOr(v.p, 0), a: numOr(v.a, t), b: numOr(v.b, perpMax - t), h: v.h == null ? null : num(v.h, null) };
        return null;
      })
      .filter(Boolean) as Divider[];

  return {
    id: numOr(b.id, 0),
    color: typeof b.color === 'string' && b.color ? b.color : PALETTE[0],
    label: typeof b.label === 'string' ? b.label : '',
    x, y, w, d, heightMM,
    parentId: b.parentId == null ? null : num(b.parentId, null),
    dividersX: up(dX, d),
    dividersY: up(dY, w),
  };
}

export interface LoadResult {
  project: Project;
  msg: string;
  err: boolean;
}

/** Parse + validate project text. Keeps the current snap setting (it isn't saved). */
export function loadProjectText(text: string, sourceName: string, current: Project): LoadResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error("That file isn't valid JSON: " + (err as Error).message);
  }
  if (!data || typeof data !== 'object') throw new Error('Could not load that project: not a Bin Bench project file');

  const p: Project = defaultProject();
  p.snap = current.snap;
  p.projectName = data.projectName || 'Untitled drawer';
  Object.assign(p.bed, data.bed || {});
  p.printerPreset = data.printerPreset || 'custom';
  Object.assign(p.drawer, data.drawer || {});
  if (data.stackGap == null && data.sacLayer != null) data.stackGap = Math.max(0.4, numOr(data.sacLayer, 1));
  const numericKeys = ['unit', 'clearance', 'gap', 'wall', 'floor', 'dividerThickness', 'minGap', 'baseThick', 'footH',
    'footTaper', 'fitClear', 'ringW', 'stackGap', 'paperGrid'] as const;
  numericKeys.forEach((k) => {
    if (data[k] != null) p[k] = numOr(data[k], p[k]);
  });
  if (data.baseplateEnabled != null) p.baseplateEnabled = !!data.baseplateEnabled;

  const rawBins = Array.isArray(data.bins) ? data.bins : [];
  const loaded = rawBins.map((b: unknown) => migrateBin(b, p.wall, numOr(data.unit, p.unit))).filter(Boolean) as Bin[];
  const dropped = rawBins.length - loaded.length;
  p.bins = loaded;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  p.blocked = (Array.isArray(data.blocked) ? data.blocked : []).map((b: any): Obstruction => ({
    id: b.id, label: typeof b.label === 'string' ? b.label : '',
    x: numOr(b.x, 0), y: numOr(b.y, 0), w: Math.max(1, numOr(b.w, 10)), d: Math.max(1, numOr(b.d, 10)),
    // pre-v5 obstructions had no height and blocked everything, so that's what they keep meaning
    h: b.h == null || !(numOr(b.h, 0) > 0) ? p.drawer.h : numOr(b.h, p.drawer.h),
  }));

  // ensure every bin has a unique id so edit/delete/move can target it
  let maxId = 0;
  p.bins.forEach((b) => {
    if (!b.id || p.bins.filter((o) => o.id === b.id).length > 1) b.id = 0;
    maxId = Math.max(maxId, b.id || 0);
  });
  p.bins.forEach((b) => {
    if (!b.id) b.id = ++maxId;
  });
  p.binCounter = Math.max(numOr(data.binCounter, 0), maxId);
  p.blockCounter = Math.max(numOr(data.blockCounter, 0), p.blocked.reduce((m, b) => Math.max(m, b.id || 0), 0));
  p.blocked.forEach((b) => {
    if (!b.id) b.id = ++p.blockCounter;
  });

  // Find any parent link that doesn't resolve, can't actually carry the bin, or forms a cycle.
  const byId = new Map(p.bins.map((b) => [b.id, b]));
  const unsupported = p.bins.filter((b) => {
    if (b.parentId == null) return false;
    const par = byId.get(b.parentId);
    if (!par || par === b || !canStackOn(b, par)) return true;
    const seen = new Set([b.id]);
    let cur: Bin | null | undefined = par;
    while (cur) {
      if (seen.has(cur.id)) return true;
      seen.add(cur.id);
      cur = cur.parentId != null ? byId.get(cur.parentId) : null;
    }
    return false;
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  p.shelvedBins = Array.isArray(data.shelvedBins) ? data.shelvedBins.map((s: any) => ({
    shelfId: s.shelfId, color: s.color || PALETTE[0], label: s.label || '',
    w: numOr(s.w, 50), d: numOr(s.d, 50), heightMM: numOr(s.heightMM, 30),
    lastX: s.lastX, lastY: s.lastY,
    dividersX: Array.isArray(s.dividersX) ? s.dividersX.map((v: Divider) => ({ ...v })) : [],
    dividersY: Array.isArray(s.dividersY) ? s.dividersY.map((v: Divider) => ({ ...v })) : [],
  })) : [];
  let maxShelfId = 0;
  p.shelvedBins.forEach((s) => {
    if (!s.shelfId || p.shelvedBins.filter((o) => o.shelfId === s.shelfId).length > 1) s.shelfId = 0;
    maxShelfId = Math.max(maxShelfId, s.shelfId || 0);
  });
  p.shelvedBins.forEach((s) => {
    if (!s.shelfId) s.shelfId = ++maxShelfId;
  });
  p.shelfCounter = Math.max(numOr(data.shelfCounter, 0), maxShelfId);

  // Bins whose stack link didn't survive validation go to the shelf rather than the floor.
  let result = p;
  let msg = '', err = false;
  if (unsupported.length) {
    unsupported.forEach((b) => {
      const live = result.bins.find((x) => x.id === b.id);
      if (live) result = shelveBin(result, live).project;
    });
    msg = unsupported.length + " bin(s) were stacked on something that can't support them — moved to Shelved bins.";
    err = true;
  } else {
    const where = sourceName ? ' from ' + sourceName : '';
    if (rawBins.length === 0) {
      msg = 'Opened' + where + ' — but this file contains no bins.';
      err = true;
    } else if (dropped > 0) {
      msg = 'Loaded ' + loaded.length + ' bin(s)' + where + '; skipped ' + dropped + ' malformed.';
      err = true;
    } else {
      msg = 'Loaded ' + loaded.length + ' bin(s)' + where + '.';
    }
  }
  return { project: result, msg, err };
}

export function projectFileName(p: Project) {
  const n = (p.projectName || 'bin-bench').trim().replace(/[^a-z0-9 _-]+/gi, '').replace(/\s+/g, '-');
  return (n || 'bin-bench') + '.json';
}
