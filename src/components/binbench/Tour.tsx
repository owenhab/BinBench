import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const STEPS: { tour: string | null; title: string; body: string }[] = [
  { tour: null, title: 'Welcome to Bin Bench', body: 'This quick tour walks through laying out and printing your own drawer bin organizer, panel by panel. Skip anytime — reopen it later from the Tutorial button up top.' },
  { tour: 'units', title: 'Units', body: "Switch every size field between metric (mm) and standard (in). Sizes are always stored in mm internally, so flipping this never changes your actual drawer or bin dimensions — only how they're displayed." },
  { tour: 'bed', title: 'Printer bed', body: 'Pick your printer from the presets, or enter a custom build volume. Bin Bench uses this to warn you when a bin is too big to print in one piece, and to plan how bins get tiled across build plates.' },
  { tour: 'drawer', title: 'Drawer interior', body: "Enter the INSIDE dimensions of the drawer you're organizing — not the drawer face. This sets the size of the grid you'll drop bins into." },
  { tour: 'layout', title: 'Layout & walls', body: 'Fine-tune the grid reference lines and snap increment, the clearance from the drawer walls, and the wall/floor/divider thickness used when bins are generated for printing.' },
  { tour: 'canvas', title: 'Draft a bin', body: 'Drag an empty area on the grid to draft a new bin. A small editor pops up beside it — set its exact size, height, and label there, and add dividers with + Vertical / + Horizontal or by dragging its corners. Bins snap to the drawer walls and to each other automatically.' },
  { tour: 'bins', title: 'Your bins', body: 'Every placed bin shows up here. Edit reopens it, Copy/paste duplicates it, and STL/3MF export just that one bin. The × removes it from the drawer without deleting it — see the next step.' },
  { tour: 'shelf', title: 'Shelved bins', body: 'Removing a bin moves it here instead of deleting it, keeping its size, dividers, and label intact. Click "Add to drawer" anytime to drop it back in; the × here deletes it for good.' },
  { tour: 'baseplate', title: 'Baseplate', body: 'Bins nest into a printed baseplate through a tapered foot and matching pocket, so everything self-aligns and sits flush without supports. Tune the plate thickness, foot size, and fit clearance here.' },
  { tour: 'view3d', title: '3D preview', body: 'See your layout in 3D — toggle the drawer, baseplate, and bins, or lift bins out for a clearer view. Drag to orbit, scroll to zoom, right-drag or shift-drag to pan.' },
  { tour: 'plates', title: 'Print-plate packing preview', body: "Once you have bins, this shows exactly how they'd be tiled across your printer's build plates — so you know how many prints you're signing up for before you start." },
  { tour: 'baseplateSections', title: 'Baseplate sections', body: 'Generates the matching baseplate pieces, split to fit your build plate, ready to download as 3MF alongside your bins.' },
  { tour: 'paper', title: 'Paper template', body: 'Print a true-scale, tiled paper template of your drawer footprint so you can check the layout with a ruler before committing to plastic.' },
  { tour: 'project', title: 'Save & reopen your project', body: "Save keeps updating the same file once you've used Save as… (in browsers that support it). If yours can't write files directly, use Copy JSON / Paste JSON as a reliable fallback." },
  { tour: null, title: "You're ready", body: "That's the whole workflow: set your drawer & printer, draft bins, tune the baseplate, and export. Replay this tour anytime from the Tutorial button up top." },
];

const target = (tour: string | null) => (tour ? document.querySelector<HTMLElement>(`[data-tour="${tour}"]`) : null);

export default function Tour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [spot, setSpot] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [cardPos, setCardPos] = useState({ left: 0, top: 0 });
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (open) setI(0); }, [open]);

  const place = useCallback(() => {
    const step = STEPS[i];
    const el = target(step.tour);
    const vw = window.innerWidth, vh = window.innerHeight, pad = 8, M = 16;
    const card = cardRef.current;
    const cw = card?.offsetWidth || 300, ch = card?.offsetHeight || 160;
    if (el) {
      const r = el.getBoundingClientRect();
      const rect = { left: r.left - pad, top: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
      setSpot(rect);
      let left = rect.left + rect.width / 2 - cw / 2;
      let top = rect.top + rect.height + 20;
      if (top + ch + M > vh) top = rect.top - ch - 20;
      left = Math.min(Math.max(left, M), vw - cw - M);
      top = Math.min(Math.max(top, M), vh - ch - M);
      setCardPos({ left, top });
    } else {
      setSpot(null);
      setCardPos({ left: Math.max(M, vw / 2 - cw / 2), top: Math.max(M, vh / 2 - ch / 2) });
    }
  }, [i]);

  useLayoutEffect(() => {
    if (!open) return;
    const el = target(STEPS[i].tour);
    if (el) {
      // open any collapsed panel the step points at
      for (let n: HTMLElement | null = el; n; n = n.parentElement) if (n instanceof HTMLDetailsElement) n.open = true;
      el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
    }
    place();
    nextRef.current?.focus();
  }, [open, i, place]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') setI((n) => Math.min(n + 1, STEPS.length - 1));
      else if (e.key === 'ArrowLeft') setI((n) => Math.max(n - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
    };
  }, [open, place, onClose]);

  if (!open) return null;
  const step = STEPS[i];
  const last = i === STEPS.length - 1;
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed z-[500] rounded-lg transition-all duration-200"
        style={spot
          ? { ...spot, boxShadow: '0 0 0 4000px rgba(10,12,14,0.72), 0 0 0 2px var(--bb-measure)' }
          : { left: '50%', top: '50%', width: 0, height: 0, boxShadow: '0 0 0 4000px rgba(10,12,14,0.72)' }}
      />
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bbTourTitle"
        className="fixed z-[501] w-[300px] rounded-lg border p-4 shadow-2xl transition-all duration-200"
        style={{ ...cardPos, background: 'var(--bb-panel-2)', borderColor: 'var(--bb-measure)' }}
      >
        <div className="mb-1.5 font-mono text-[10.5px] tracking-[0.08em] text-primary uppercase">Step {i + 1} of {STEPS.length}</div>
        <h3 id="bbTourTitle" className="mb-2 text-[15px] font-semibold">{step.title}</h3>
        <p className="mb-3.5 text-[12.5px] leading-relaxed" style={{ color: 'var(--bb-dim)' }}>{step.body}</p>
        <div className="flex items-center gap-1.5">
          <button type="button" className="bb-btn bb-btn-xs" disabled={i === 0} onClick={() => setI(i - 1)}>Back</button>
          <button ref={nextRef} type="button" className="bb-btn bb-btn-xs bb-btn-primary" onClick={() => (last ? onClose() : setI(i + 1))}>
            {last ? 'Finish' : 'Next'}
          </button>
          <button type="button" className="ml-auto cursor-pointer p-1 text-[11px] underline" style={{ color: 'var(--bb-dim)' }} onClick={onClose}>
            Skip tutorial
          </button>
        </div>
      </div>
    </>
  );
}
