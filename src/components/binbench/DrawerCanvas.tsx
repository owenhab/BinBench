import { type PointerEvent as RPointerEvent, memo, useLayoutEffect, useRef, useState } from 'react';
import {
  type Bin,
  type Obstruction,
  type Project,
  type Rect,
  PALETTE,
  binFit,
  binName,
  binsAtLevel,
  childrenOf,
  isPartial,
  levelBaseZ,
  obstructionH,
  snapMove,
  usableBounds,
  getSnap,
  snapTo,
} from '@/lib/binbench/model';
import {
  type Draft,
  type DragType,
  type Editing,
  type Guides,
  type SnapHint,
  applyDrag,
  cloneDraft,
  createRect,
  draftLevel,
} from './draft';
import type { Units } from './units';

export const ORIGIN_X = 30;
export const ORIGIN_Y = 30;

type Interaction =
  | { kind: 'create'; start: { x: number; y: number }; base: Draft; last: Draft }
  | { kind: 'block'; start: { x: number; y: number }; rect: Rect | null }
  | { kind: 'quick'; bin: Bin; start: { x: number; y: number }; moved: boolean; pos: { x: number; y: number } | null }
  | { kind: 'drag'; type: DragType; index: number; start: { x: number; y: number }; orig: Draft };

interface Props {
  project: Project;
  units: Units;
  mode: 'design' | 'block';
  activeLevel: number;
  draft: Draft | null;
  editing: Editing | null;
  onDraftChange: (d: Draft | null) => void;
  onBeginEdit: (e: Editing) => void;
  onCloseEditor: () => void;
  onOpenBin: (bin: Bin) => void;
  onMoveBin: (id: number, x: number, y: number) => void;
  onAddObstruction: (r: Rect) => void;
  onDeleteObstruction: (id: number) => void;
  /** reports the svg element and scale so the floating editor can sit beside the draft */
  onLayout: (svg: SVGSVGElement | null, scale: number) => void;
}

const NO_GUIDES: Guides = { x: [], y: [] };

export default function DrawerCanvas(props: Props) {
  const { project: p, units, mode, activeLevel, draft, editing } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const inter = useRef<Interaction | null>(null);
  const [wrapW, setWrapW] = useState(700);
  const [guides, setGuides] = useState<Guides>(NO_GUIDES);
  const [snapHint, setSnapHint] = useState<SnapHint | null>(null);
  const [blockDraft, setBlockDraft] = useState<Rect | null>(null);
  const [quickPos, setQuickPos] = useState<{ id: number; x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWrapW(el.clientWidth));
    ro.observe(el);
    setWrapW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // fit the drawer into the column; tall drawers are limited by height instead
  const maxPxW = Math.max(220, Math.min(wrapW - 32 - ORIGIN_X - 20, 900));
  let scale = Math.min(maxPxW / p.drawer.w, 560 / p.drawer.d, 2.4);
  if (!(scale > 0) || !isFinite(scale)) scale = 1;

  useLayoutEffect(() => {
    props.onLayout(svgRef.current, scale);
  });

  const W = p.drawer.w * scale, D = p.drawer.d * scale;
  const X = (mm: number) => ORIGIN_X + mm * scale;
  const Y = (mm: number) => ORIGIN_Y + mm * scale;

  const mmFromClient = (cx: number, cy: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (cx - r.left - ORIGIN_X) / scale, y: (cy - r.top - ORIGIN_Y) / scale };
  };

  const begin = (e: RPointerEvent, it: Interaction) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    svgRef.current?.setPointerCapture(e.pointerId);
    inter.current = it;
  };

  const level = draftLevel(p, editing, activeLevel);
  const excludeId = editing && editing.mode === 'edit' ? editing.id ?? null : null;

  const onPaperDown = (e: RPointerEvent) => {
    const mm = mmFromClient(e.clientX, e.clientY);
    if (mode === 'block') {
      begin(e, { kind: 'block', start: mm, rect: null });
      setBlockDraft({ x: mm.x, y: mm.y, w: 0, d: 0 });
      return;
    }
    const base: Draft = {
      x: mm.x, y: mm.y, w: 0, d: 0,
      heightMM: Math.min(p.drawer.h - 2, 42),
      dividersX: [], dividersY: [], label: '',
    };
    begin(e, { kind: 'create', start: mm, base, last: base });
    props.onCloseEditor();
    props.onDraftChange(base);
  };

  const onMove = (e: RPointerEvent) => {
    const it = inter.current;
    if (!it) return;
    const cur = mmFromClient(e.clientX, e.clientY);
    const dx = cur.x - it.start.x, dy = cur.y - it.start.y;
    if (it.kind === 'quick') {
      if (Math.hypot(dx, dy) > 1) it.moved = true;
      if (!it.moved) return;
      const tol = Math.max(getSnap(p), 8 / scale);
      const lv = draftLevel(p, { mode: 'edit', id: it.bin.id, color: '' }, activeLevel);
      const r = snapMove(p, it.bin, it.bin.x, it.bin.y, dx, dy, it.bin.id, lv, tol);
      setGuides(r.guides);
      it.pos = { x: r.x, y: r.y };
      setQuickPos({ id: it.bin.id, x: r.x, y: r.y });
    } else if (it.kind === 'block') {
      const inc = getSnap(p);
      const x0 = snapTo(Math.min(it.start.x, cur.x), inc), x1 = snapTo(Math.max(it.start.x, cur.x), inc);
      const y0 = snapTo(Math.min(it.start.y, cur.y), inc), y1 = snapTo(Math.max(it.start.y, cur.y), inc);
      it.rect = { x: x0, y: y0, w: Math.max(x1 - x0, inc), d: Math.max(y1 - y0, inc) };
      setBlockDraft(it.rect);
    } else if (it.kind === 'create') {
      const { rect, guides: g } = createRect(p, it.start, cur, scale, activeLevel);
      setGuides(g);
      it.last = { ...it.base, ...rect };
      props.onDraftChange(it.last);
    } else if (it.kind === 'drag') {
      const r = applyDrag(it.type, it.index, it.orig, dx, dy, { project: p, scale, excludeId, level });
      setGuides(r.guides);
      setSnapHint(r.snapHint);
      props.onDraftChange(r.draft);
    }
  };

  const onUp = () => {
    const it = inter.current;
    inter.current = null;
    setGuides(NO_GUIDES);
    setSnapHint(null);
    if (!it) return;
    if (it.kind === 'quick') {
      if (it.moved && it.pos) props.onMoveBin(it.bin.id, it.pos.x, it.pos.y);
      else if (!it.moved) props.onOpenBin(it.bin);
      setQuickPos(null);
    } else if (it.kind === 'block') {
      // dragged obstructions start full-height (the safe reading of "something is in
      // the way"); lower it in the Obstructions list to let a stack clear it
      if (it.rect && it.rect.w >= 1 && it.rect.d >= 1) props.onAddObstruction(it.rect);
      setBlockDraft(null);
    } else if (it.kind === 'create') {
      if (it.last.w < 1 || it.last.d < 1) props.onDraftChange(null);
      else props.onBeginEdit({ mode: 'new', color: PALETTE[p.bins.length % PALETTE.length] });
    }
  };

  const lv = activeLevel;
  const lvBaseZ = levelBaseZ(p, lv);
  const bnd = usableBounds(p);
  const hiddenId = editing && editing.mode === 'edit' ? editing.id : null;
  const editable = !!(draft && editing);

  const handle = (type: DragType, index = 0) => (e: RPointerEvent) => {
    if (!draft) return;
    begin(e, { kind: 'drag', type, index, start: mmFromClient(e.clientX, e.clientY), orig: cloneDraft(draft) });
  };

  return (
    <div
      ref={wrapRef}
      className="overflow-auto rounded-field border p-4"
      style={{ background: 'var(--bb-ink)', borderColor: 'var(--bb-line)' }}
    >
      <svg
        ref={svgRef}
        width={W + ORIGIN_X + 20}
        height={D + ORIGIN_Y + 20}
        className="block touch-none select-none"
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        role="application"
        aria-label="Drawer layout grid"
      >
        <defs>
          <pattern id="bbHatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--bb-warn)" strokeWidth="2" />
          </pattern>
        </defs>
        <rect
          x={ORIGIN_X} y={ORIGIN_Y} width={W} height={D}
          fill="var(--bb-paper)" stroke="var(--bb-paper-line)" strokeWidth={1}
          style={{ cursor: 'crosshair' }}
          onPointerDown={onPaperDown}
        />
        <GridLines w={p.drawer.w} d={p.drawer.d} unit={p.unit} scale={scale} />
        <rect
          x={X(bnd.minX)} y={Y(bnd.minY)}
          width={(bnd.maxX - bnd.minX) * scale} height={(bnd.maxY - bnd.minY) * scale}
          fill="none" stroke="var(--bb-rule)" strokeWidth={1} strokeDasharray="3,3" opacity={0.6} pointerEvents="none"
        />

        {/* the level below shows through as a ghost — that outline is what you have to span */}
        {lv > 1 &&
          binsAtLevel(p, lv - 1).map((b) => (
            <g key={'ghost' + b.id} pointerEvents="none">
              <rect x={X(b.x)} y={Y(b.y)} width={b.w * scale} height={b.d * scale} fill={b.color} opacity={0.16}
                stroke={b.color} strokeWidth={1.5} strokeDasharray="5,4" rx={3} />
              <text x={X(b.x) + 6} y={Y(b.y) + b.d * scale - 7} fontSize={9} fill="var(--bb-ink)" opacity={0.5}>
                on {binName(b)}
              </text>
            </g>
          ))}

        {p.blocked.map((bl) => (
          <ObstructionRect key={'bl' + bl.id} p={p} bl={bl} scale={scale} reaches={obstructionH(p, bl) > lvBaseZ + 0.01}
            units={units} onDelete={() => props.onDeleteObstruction(bl.id)} />
        ))}

        {binsAtLevel(p, lv).map((bin) => {
          if (bin.id === hiddenId) return null;
          const pos = quickPos && quickPos.id === bin.id ? quickPos : bin;
          const x = X(pos.x), y = Y(pos.y), w = bin.w * scale, d = bin.d * scale;
          const fit = binFit(p, bin);
          const kids = childrenOf(p, bin.id).length;
          return (
            <g key={'bin' + bin.id}>
              <rect x={x} y={y} width={w} height={d} fill={bin.color} opacity={0.85}
                stroke={fit.ok ? '#000' : 'var(--bb-warn)'} strokeWidth={fit.ok ? 0.5 : 2} rx={3}
                style={{ cursor: mode === 'design' ? 'move' : 'default' }}
                onPointerDown={(e) => {
                  if (mode !== 'design') return;
                  if (editing) props.onCloseEditor();
                  begin(e, { kind: 'quick', bin, start: mmFromClient(e.clientX, e.clientY), moved: false, pos: null });
                }}
              >
                <title>{binName(bin)} — click to edit, drag to move</title>
              </rect>
              {bin.dividersX.map((dv, i) => (
                <line key={'x' + i} x1={x + dv.p * scale} y1={y + dv.a * scale} x2={x + dv.p * scale} y2={y + dv.b * scale}
                  stroke="rgba(0,0,0,0.45)" strokeWidth={1.5} strokeDasharray={isPartial(dv, bin.heightMM) ? '4,3' : undefined}
                  pointerEvents="none" />
              ))}
              {bin.dividersY.map((dv, i) => (
                <line key={'y' + i} x1={x + dv.a * scale} y1={y + dv.p * scale} x2={x + dv.b * scale} y2={y + dv.p * scale}
                  stroke="rgba(0,0,0,0.45)" strokeWidth={1.5} strokeDasharray={isPartial(dv, bin.heightMM) ? '4,3' : undefined}
                  pointerEvents="none" />
              ))}
              <text x={x + 6} y={y + 16} fontSize={11} fill="var(--bb-ink)" fontWeight={700} pointerEvents="none">
                {binName(bin)}
              </text>
              <text x={x + 6} y={y + 30} fontSize={9.5} fill="var(--bb-ink)" pointerEvents="none">
                {units.fmt(bin.w)}×{units.fmt(bin.d)}×{units.fmt(bin.heightMM)}
                {kids ? ' · ' + kids + ' stacked' : ''}
                {fit.ok ? '' : ' ⚠ exceeds bed'}
              </text>
            </g>
          );
        })}

        {/* draft overlay */}
        <g>
          {blockDraft && (
            <rect x={X(blockDraft.x)} y={Y(blockDraft.y)} width={blockDraft.w * scale} height={blockDraft.d * scale}
              fill="var(--bb-warn)" fillOpacity={0.3} stroke="var(--bb-warn)" strokeWidth={2} strokeDasharray="4,3" />
          )}
          {guides.x.map((gx, i) => (
            <line key={'gx' + i} x1={X(gx)} y1={ORIGIN_Y} x2={X(gx)} y2={ORIGIN_Y + D}
              stroke="var(--bb-ok)" strokeWidth={1} strokeDasharray="4,3" pointerEvents="none" />
          ))}
          {guides.y.map((gy, i) => (
            <line key={'gy' + i} x1={ORIGIN_X} y1={Y(gy)} x2={ORIGIN_X + W} y2={Y(gy)}
              stroke="var(--bb-ok)" strokeWidth={1} strokeDasharray="4,3" pointerEvents="none" />
          ))}
          {draft && (
            <DraftShape draft={draft} editing={editing} scale={scale} editable={editable} handle={handle} snapHint={snapHint} />
          )}
        </g>
      </svg>
    </div>
  );
}

const GridLines = memo(function GridLines({ w, d, unit, scale }: { w: number; d: number; unit: number; scale: number }) {
  const els = [];
  const W = w * scale, D = d * scale;
  for (let x = 0; x <= w + 0.01; x += unit) {
    const px = ORIGIN_X + x * scale;
    els.push(
      <g key={'gx' + x}>
        <line x1={px} y1={ORIGIN_Y} x2={px} y2={ORIGIN_Y + D} stroke="var(--bb-paper-line)" strokeWidth={0.75} opacity={0.6} />
        <line x1={px} y1={ORIGIN_Y - 6} x2={px} y2={ORIGIN_Y} stroke="var(--bb-rule)" strokeWidth={1} />
        <text x={px} y={ORIGIN_Y - 9} fontSize={9} fill="var(--bb-measure)" textAnchor="middle">{Math.round(x)}</text>
      </g>,
    );
  }
  for (let y = 0; y <= d + 0.01; y += unit) {
    const py = ORIGIN_Y + y * scale;
    els.push(
      <g key={'gy' + y}>
        <line x1={ORIGIN_X} y1={py} x2={ORIGIN_X + W} y2={py} stroke="var(--bb-paper-line)" strokeWidth={0.75} opacity={0.6} />
        <line x1={ORIGIN_X - 6} y1={py} x2={ORIGIN_X} y2={py} stroke="var(--bb-rule)" strokeWidth={1} />
        <text x={ORIGIN_X - 9} y={py + 3} fontSize={9} fill="var(--bb-measure)" textAnchor="end">{Math.round(y)}</text>
      </g>,
    );
  }
  return <g pointerEvents="none">{els}</g>;
});

function ObstructionRect({
  p, bl, scale, reaches, units, onDelete,
}: { p: Project; bl: Obstruction; scale: number; reaches: boolean; units: Units; onDelete: () => void }) {
  // an obstruction the current level clears sits "under" it — draw it faint so it
  // reads as something you're passing over rather than something in your way
  return (
    <rect
      x={ORIGIN_X + bl.x * scale} y={ORIGIN_Y + bl.y * scale} width={bl.w * scale} height={bl.d * scale}
      fill={reaches ? 'url(#bbHatch)' : 'none'} stroke="var(--bb-warn)" strokeWidth={1}
      strokeDasharray={reaches ? undefined : '3,3'} opacity={reaches ? 0.75 : 0.35}
      style={{ cursor: 'pointer' }}
      onClick={(e) => {
        e.stopPropagation();
        onDelete();
      }}
    >
      <title>
        {(bl.label || 'Obstruction') + ' — ' + units.fmt(bl.w) + '×' + units.fmt(bl.d) + '×' + units.fmt(obstructionH(p, bl)) +
          (reaches ? '' : ' (clears this level)') + ' · click to delete'}
      </title>
    </rect>
  );
}

function DraftShape({
  draft, editing, scale, editable, handle, snapHint,
}: {
  draft: Draft;
  editing: Editing | null;
  scale: number;
  editable: boolean;
  handle: (type: DragType, index?: number) => (e: RPointerEvent) => void;
  snapHint: SnapHint | null;
}) {
  const x = ORIGIN_X + draft.x * scale, y = ORIGIN_Y + draft.y * scale, w = draft.w * scale, d = draft.d * scale;
  const hs = 10;
  return (
    <>
      <rect x={x} y={y} width={w} height={d} fill={editing ? editing.color : 'var(--bb-rule)'} fillOpacity={0.35}
        stroke="var(--bb-rule)" strokeWidth={2} strokeDasharray={editing ? undefined : '6,3'}
        style={{ cursor: editable ? 'move' : undefined }}
        onPointerDown={editable ? handle('move') : undefined} />
      {editable && (
        <>
          {draft.dividersX.map((dv, i) => {
            const lx = x + dv.p * scale, ya = y + dv.a * scale, yb = y + dv.b * scale;
            return (
              <g key={'dx' + i}>
                <line x1={lx} y1={ya} x2={lx} y2={yb} stroke="var(--bb-ink)" strokeWidth={2}
                  strokeDasharray={isPartial(dv, draft.heightMM) ? '5,3' : undefined} pointerEvents="none" />
                <rect x={lx - 5} y={(ya + yb) / 2 - 9} width={10} height={18} rx={2} fill="var(--bb-rule)"
                  stroke="var(--bb-ink)" strokeWidth={1} style={{ cursor: 'ew-resize' }} onPointerDown={handle('divx', i)} />
                <circle cx={lx} cy={ya} r={4.5} fill="var(--bb-ink)" stroke="var(--bb-rule)" strokeWidth={1.5}
                  style={{ cursor: 'ns-resize' }} onPointerDown={handle('divxa', i)} />
                <circle cx={lx} cy={yb} r={4.5} fill="var(--bb-ink)" stroke="var(--bb-rule)" strokeWidth={1.5}
                  style={{ cursor: 'ns-resize' }} onPointerDown={handle('divxb', i)} />
              </g>
            );
          })}
          {draft.dividersY.map((dv, i) => {
            const ly = y + dv.p * scale, xa = x + dv.a * scale, xb = x + dv.b * scale;
            return (
              <g key={'dy' + i}>
                <line x1={xa} y1={ly} x2={xb} y2={ly} stroke="var(--bb-ink)" strokeWidth={2}
                  strokeDasharray={isPartial(dv, draft.heightMM) ? '5,3' : undefined} pointerEvents="none" />
                <rect x={(xa + xb) / 2 - 9} y={ly - 5} width={18} height={10} rx={2} fill="var(--bb-rule)"
                  stroke="var(--bb-ink)" strokeWidth={1} style={{ cursor: 'ns-resize' }} onPointerDown={handle('divy', i)} />
                <circle cx={xa} cy={ly} r={4.5} fill="var(--bb-ink)" stroke="var(--bb-rule)" strokeWidth={1.5}
                  style={{ cursor: 'ew-resize' }} onPointerDown={handle('divya', i)} />
                <circle cx={xb} cy={ly} r={4.5} fill="var(--bb-ink)" stroke="var(--bb-rule)" strokeWidth={1.5}
                  style={{ cursor: 'ew-resize' }} onPointerDown={handle('divyb', i)} />
              </g>
            );
          })}
          {([['nw', x, y], ['ne', x + w, y], ['sw', x, y + d], ['se', x + w, y + d]] as const).map(([type, hx, hy]) => (
            <rect key={type} x={hx - hs / 2} y={hy - hs / 2} width={hs} height={hs} fill="var(--bb-rule)" stroke="var(--bb-ink)"
              strokeWidth={1} style={{ cursor: type === 'nw' || type === 'se' ? 'nwse-resize' : 'nesw-resize' }}
              onPointerDown={handle(type)} />
          ))}
          {snapHint && (
            <g pointerEvents="none">
              <circle cx={x + snapHint.x * scale} cy={y + snapHint.y * scale} r={8} fill="none" stroke="var(--bb-ok)" strokeWidth={2} />
              <circle cx={x + snapHint.x * scale} cy={y + snapHint.y * scale} r={2.5} fill="var(--bb-ok)" />
            </g>
          )}
        </>
      )}
    </>
  );
}
