// Starting sizes for things people actually put in drawers, plus whatever sizes the
// user decides are worth keeping. Nothing here is authoritative — a "AA batteries"
// bin is a sensible place to begin, not a measurement — so every one of them is
// dropped in as an ordinary bin you can then resize.
import { type Project } from './model';
import { GF, gfSnapHeight, gfSnaps } from './gridfinity';

export interface ContainerPreset {
  id: string;
  /** which drawer this tends to turn up in */
  group: string;
  name: string;
  /** outside size of the bin, in mm */
  w: number;
  d: number;
  h: number;
  /** saved by the user rather than shipped with the app */
  mine?: boolean;
}

export const BUILT_IN_CONTAINERS: ContainerPreset[] = [
  { id: 'k-cutlery', group: 'Kitchen', name: 'Teaspoons / cutlery', w: 210, d: 60, h: 45 },
  { id: 'k-measure', group: 'Kitchen', name: 'Measuring spoons', w: 110, d: 60, h: 40 },
  { id: 'k-spice', group: 'Kitchen', name: 'Spice jars', w: 130, d: 130, h: 70 },
  { id: 'k-sponge', group: 'Kitchen', name: 'Sponges / scourers', w: 120, d: 80, h: 55 },

  { id: 'd-pens', group: 'Desk', name: 'Pens & pencils', w: 170, d: 45, h: 35 },
  { id: 'd-markers', group: 'Desk', name: 'Markers', w: 140, d: 45, h: 40 },
  { id: 'd-sticky', group: 'Desk', name: 'Sticky notes', w: 80, d: 80, h: 30 },
  { id: 'd-clips', group: 'Desk', name: 'Paper clips', w: 55, d: 55, h: 25 },
  { id: 'd-bands', group: 'Desk', name: 'Rubber bands', w: 70, d: 70, h: 30 },
  { id: 'd-cards', group: 'Desk', name: 'Business cards', w: 95, d: 60, h: 35 },
  { id: 'd-scissors', group: 'Desk', name: 'Scissors', w: 200, d: 50, h: 35 },

  { id: 't-aa', group: 'Tech', name: 'AA batteries', w: 85, d: 45, h: 30 },
  { id: 't-aaa', group: 'Tech', name: 'AAA batteries', w: 75, d: 40, h: 25 },
  { id: 't-usb', group: 'Tech', name: 'USB sticks & SD cards', w: 70, d: 50, h: 25 },
  { id: 't-cables', group: 'Tech', name: 'Phone cables', w: 110, d: 80, h: 45 },
  { id: 't-buds', group: 'Tech', name: 'Earbuds case', w: 75, d: 75, h: 40 },

  { id: 'w-bits', group: 'Workshop', name: 'Screwdriver bits', w: 70, d: 50, h: 25 },
  { id: 'w-hex', group: 'Workshop', name: 'Hex keys', w: 110, d: 45, h: 30 },
  { id: 'w-tape', group: 'Workshop', name: 'Tape measure', w: 85, d: 85, h: 50 },
  { id: 'w-ties', group: 'Workshop', name: 'Cable ties', w: 95, d: 60, h: 35 },
  { id: 'w-fixings', group: 'Workshop', name: 'Screws & fixings', w: 60, d: 60, h: 35 },

  { id: 'b-meds', group: 'Bathroom', name: 'Medicine bottles', w: 85, d: 85, h: 80 },
  { id: 'b-tubes', group: 'Bathroom', name: 'Lipsticks / small tubes', w: 90, d: 60, h: 45 },
  { id: 'b-ties', group: 'Bathroom', name: 'Hair ties & clips', w: 70, d: 70, h: 35 },
];

export const MY_GROUP = 'Saved';

/** How much a preset may be squeezed to avoid buying a whole extra 42 mm cell. These
 *  sizes are round numbers someone picked, not measurements, so an 85 mm suggestion
 *  landing 1.5 mm over the two-cell size should take two cells, not three. */
const SQUEEZE = 5;

/** The size a preset actually comes out as. Under Gridfinity's whole-cell snapping a
 *  footprint rounds UP, give or take `SQUEEZE` — a 60 mm item really does need two
 *  42 mm cells, and rounding down would hand back a bin it doesn't fit in. Height
 *  rounds to the nearest unit, where a few mm shallow only leaves the contents
 *  standing a little proud. */
export function containerSize(p: Project, c: ContainerPreset) {
  if (!gfSnaps(p)) return { w: c.w, d: c.d, heightMM: c.h };
  const cells = (mm: number) => Math.max(1, Math.ceil((mm - SQUEEZE + 2 * GF.clear) / GF.pitch - 1e-6));
  return {
    w: cells(c.w) * GF.pitch - 2 * GF.clear,
    d: cells(c.d) * GF.pitch - 2 * GF.clear,
    heightMM: gfSnapHeight(p, c.h),
  };
}

// ---------- the user's own list ----------
// Kept outside the project file on purpose: a library of sizes you reach for is
// yours, not one drawer's, so it follows you from project to project.
export const CONTAINERS_KEY = 'binBenchContainers';

export function parseContainers(raw: string | null): ContainerPreset[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .map((c): ContainerPreset | null => {
        if (!c || typeof c !== 'object') return null;
        const o = c as Record<string, unknown>;
        const n = (v: unknown) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : null);
        const w = n(o.w), d = n(o.d), h = n(o.h);
        if (w == null || d == null || h == null) return null;
        return {
          id: typeof o.id === 'string' && o.id ? o.id : 'mine-' + Math.random().toString(36).slice(2, 9),
          group: MY_GROUP,
          name: typeof o.name === 'string' && o.name.trim() ? o.name.trim() : 'Saved size',
          w, d, h,
          mine: true,
        };
      })
      .filter(Boolean) as ContainerPreset[];
  } catch {
    return [];
  }
}

export function serializeContainers(list: ContainerPreset[]) {
  return JSON.stringify(list.map((c) => ({ id: c.id, name: c.name, w: c.w, d: c.d, h: c.h })));
}

export function newContainerId() {
  return 'mine-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
