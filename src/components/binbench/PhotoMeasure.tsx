// A spike: photograph an item next to something whose size you know, and get its
// outline back in millimetres. See docs/measuring.md for where this is meant to go.
import { type PointerEvent as RPointerEvent, useRef, useState } from 'react';
import { type Project, lipGeometry } from '@/lib/binbench/model';
import { type Homography, type Pt, applyH, bbox, polyArea, scaleOnly, simplify, solveHomography } from '@/lib/binbench/photo';
import { Section } from './fields';
import type { Units } from './units';

type RefMode = 'rect' | 'line';
type Step = 'ref' | 'trace';

const RECT_HINT = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];

export default function PhotoMeasure({
  project: p, units, onCreateBin, onStatus,
}: {
  project: Project;
  units: Units;
  onCreateBin: (w: number, d: number, label: string) => void;
  onStatus: (msg: string, err?: boolean) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const [mode, setMode] = useState<RefMode>('rect');
  const [step, setStep] = useState<Step>('ref');
  const [refPts, setRefPts] = useState<Pt[]>([]);
  const [refW, setRefW] = useState(100);
  const [refH, setRefH] = useState(100);
  const [outline, setOutline] = useState<Pt[]>([]);
  const [tol, setTol] = useState(1);
  const svgRef = useRef<SVGSVGElement>(null);

  const need = mode === 'rect' ? 4 : 2;
  const reset = () => { setRefPts([]); setOutline([]); setStep('ref'); };

  const pick = (e: RPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || !nat.w) return;
    const r = svg.getBoundingClientRect();
    const q: Pt = [((e.clientX - r.left) / r.width) * nat.w, ((e.clientY - r.top) / r.height) * nat.h];
    if (step === 'ref') {
      const next = refPts.length >= need ? [q] : refPts.concat([q]);
      setRefPts(next);
      if (next.length === need) setStep('trace');
    } else {
      setOutline(outline.concat([q]));
    }
  };

  // the map from the photograph back to a flat plane in mm
  let H: Homography | null = null;
  if (refPts.length === need) {
    H = mode === 'rect'
      ? solveHomography(refPts, [[0, 0], [refW, 0], [refW, refH], [0, refH]])
      : scaleOnly(refPts[0], refPts[1], refW);
  }
  const mmOutline = H ? simplify(outline.map((q) => applyH(H!, q)), tol) : [];
  const box = mmOutline.length >= 2 ? bbox(mmOutline) : null;
  const size = box ? { w: box.x1 - box.x0, d: box.y1 - box.y0 } : null;

  // a bin that would hold it: the item's footprint plus the walls and the collar
  const lip = lipGeometry(p);
  const tw = p.wall + lip.ledge;
  const binFor = size ? { w: size.w + 2 * tw + 1, d: size.d + 2 * tw + 1 } : null;

  const load = (file: File) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      setNat({ w: im.naturalWidth, h: im.naturalHeight });
      setSrc(url);
      reset();
    };
    im.onerror = () => onStatus('That image could not be read.', true);
    im.src = url;
  };

  const r = Math.max(nat.w, 1) / 290;
  const dot = 7 * r, line = 2.5 * r, font = 16 * r;

  return (
    <Section title="Measure from a photo" tour="photo" badge="spike">
      <input type="file" accept="image/*" className="bb-input mb-2 text-[11px]"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) load(f); }} />

      {!src ? (
        <p className="bb-hint mt-0">
          Lay the item on something you know the size of — the 1:1 paper template this app prints is ideal, it already carries a
          100mm bar and a grid — and photograph the two together.
        </p>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <select className="bb-input max-w-[150px]" value={mode}
              onChange={(e) => { setMode(e.target.value as RefMode); reset(); }}>
              <option value="rect">Rectangle (fixes perspective)</option>
              <option value="line">One length (square-on only)</option>
            </select>
            <button type="button" className="bb-btn bb-btn-xs" onClick={reset}>Start over</button>
          </div>

          <div className="mb-2 flex flex-wrap gap-2">
            <label className="min-w-0 flex-1">
              <span className="bb-label">{mode === 'rect' ? 'Its width (mm)' : 'That length (mm)'}</span>
              <input type="number" className="bb-input" value={refW} min={1}
                onChange={(e) => setRefW(Math.max(1, Number(e.target.value) || 1))} />
            </label>
            {mode === 'rect' && (
              <label className="min-w-0 flex-1">
                <span className="bb-label">Its depth (mm)</span>
                <input type="number" className="bb-input" value={refH} min={1}
                  onChange={(e) => setRefH(Math.max(1, Number(e.target.value) || 1))} />
              </label>
            )}
          </div>

          <svg
            ref={svgRef}
            viewBox={`0 0 ${nat.w} ${nat.h}`}
            className="mb-1 block w-full rounded-field border"
            style={{ borderColor: 'var(--bb-line)', touchAction: 'none', cursor: 'crosshair' }}
            onPointerDown={pick}
          >
            <image href={src} x={0} y={0} width={nat.w} height={nat.h} />
            {refPts.length > 1 && (
              <polygon points={refPts.map((q) => q.join(',')).join(' ')} fill="var(--bb-ok)" fillOpacity={0.12}
                stroke="var(--bb-ok)" strokeWidth={line} />
            )}
            {refPts.map((q, i) => (
              <g key={'r' + i}>
                <circle cx={q[0]} cy={q[1]} r={dot} fill="var(--bb-ok)" stroke="#fff" strokeWidth={line * 0.6} />
                <text x={q[0] + dot * 1.6} y={q[1] - dot} fontSize={font} fill="var(--bb-ok)" fontWeight={700}>{i + 1}</text>
              </g>
            ))}
            {outline.length > 1 && (
              <polygon points={outline.map((q) => q.join(',')).join(' ')} fill="var(--bb-measure)" fillOpacity={0.2}
                stroke="var(--bb-measure)" strokeWidth={line} />
            )}
            {outline.map((q, i) => (
              <circle key={'o' + i} cx={q[0]} cy={q[1]} r={dot * 0.75} fill="var(--bb-measure)" stroke="#fff" strokeWidth={line * 0.5} />
            ))}
          </svg>

          <p className="bb-hint mt-0">
            {step === 'ref'
              ? mode === 'rect'
                ? `Click the ${RECT_HINT[refPts.length]} corner of the rectangle (${refPts.length}/4).`
                : `Click the two ends of the known length (${refPts.length}/2).`
              : 'Now click your way round the item. Every click adds a corner.'}
          </p>

          {step === 'trace' && (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <button type="button" className="bb-btn bb-btn-xs" disabled={!outline.length}
                  onClick={() => setOutline(outline.slice(0, -1))}>Undo point</button>
                <button type="button" className="bb-btn bb-btn-xs" disabled={!outline.length}
                  onClick={() => setOutline([])}>Clear outline</button>
                <label className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--bb-dim)' }}>
                  smooth
                  <input type="range" min={0} max={5} step={0.5} value={tol} className="w-[70px]"
                    onChange={(e) => setTol(Number(e.target.value))} />
                  {units.fine(tol)}
                </label>
              </div>
              {size && box && (
                <p className="font-mono text-[11.5px]" style={{ color: 'var(--bb-dim)' }}>
                  outline {units.fmt(size.w)}×{units.fmt(size.d)} · {Math.round(polyArea(mmOutline))}mm² ·{' '}
                  {mmOutline.length} of {outline.length} points kept
                  {binFor && <><br />a bin to hold it ≈ {units.fmt(binFor.w)}×{units.fmt(binFor.d)}</>}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className="bb-btn bb-btn-xs bb-btn-primary" disabled={!binFor}
                  onClick={() => binFor && onCreateBin(binFor.w, binFor.d, 'From photo')}>Make a bin this size</button>
                <button type="button" className="bb-btn bb-btn-xs" disabled={!mmOutline.length}
                  onClick={() => {
                    const text = JSON.stringify(mmOutline.map((q) => [Math.round(q[0] * 100) / 100, Math.round(q[1] * 100) / 100]));
                    navigator.clipboard.writeText(text).then(
                      () => onStatus(mmOutline.length + ' point outline copied, in mm.'),
                      () => onStatus('Clipboard blocked — the outline is in the console instead.', true),
                    );
                  }}>Copy outline (mm)</button>
              </div>
            </>
          )}
        </>
      )}
      <p className="bb-hint">
        A spike, not a finished feature: it measures and it can size a bin, but it does not yet cut the outline into the bin's floor
        as an insert. The maths and the plan for that are in <b>docs/measuring.md</b>.
      </p>
    </Section>
  );
}
