// Display units. mm is the source of truth everywhere in state; this is just display.
export type LengthUnit = 'mm' | 'in';
const MM_PER_IN = 25.4;

export function roundTo(v: number, n: number) {
  const f = Math.pow(10, n);
  return Math.round(v * f) / f;
}

export interface Units {
  unit: LengthUnit;
  suffix: string;
  toDisplay: (mm: number) => number;
  toMM: (v: number) => number;
  fmt: (mm: number) => string;
}

export function makeUnits(unit: LengthUnit): Units {
  const inch = unit === 'in';
  return {
    unit,
    suffix: inch ? 'in' : 'mm',
    toDisplay: (mm) => (inch ? roundTo(mm / MM_PER_IN, 4) : roundTo(mm, 2)),
    toMM: (v) => (inch ? v * MM_PER_IN : v),
    fmt: (mm) => (inch ? roundTo(mm / MM_PER_IN, 2) + '"' : Math.round(mm) + 'mm'),
  };
}

// localStorage is unavailable in some contexts (strict privacy modes, sandboxed
// frames) where merely reading it throws — never let that take the app down.
export function safeLocalGet(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function safeLocalSet(key: string, val: string) {
  try {
    localStorage.setItem(key, val);
  } catch {
    /* not persisted */
  }
}
