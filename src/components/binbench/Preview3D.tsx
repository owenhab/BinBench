import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { type Project, binBaseZ, binLevel, maxLevel, obstructionH } from '@/lib/binbench/model';
import { type Tri, addBox, binTriangles, computeBaseplateTiles, tileTriangles } from '@/lib/binbench/geometry';
import { Section } from './fields';

// App space is X=width, Y=depth, Z=height. Three.js is Y-up, so we map
// (x, y, z) -> (x, z, y) and re-centre the model on the origin.
interface View {
  theta: number;
  phi: number;
  dist: number;
  pan: [number, number, number];
  center: [number, number, number];
  radius: number;
}

function meshFromTris(tris: Tri[], material: THREE.Material, offX: number, offY: number, offZ: number, bbox: THREE.Box3) {
  const pos = new Float32Array(tris.length * 9);
  let i = 0;
  const v = new THREE.Vector3();
  tris.forEach((t) => {
    // swapping two axes flips handedness, so the winding must be reversed too
    [t[0], t[2], t[1]].forEach((p) => {
      const X = p[0] + offX, Y = p[2] + offZ, Z = p[1] + offY;
      pos[i++] = X; pos[i++] = Y; pos[i++] = Z;
      bbox.expandByPoint(v.set(X, Y, Z));
    });
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}

/** The camera's own right/up axes at the current orbit angles, for panning. */
function camBasis(view: View) {
  const sp = Math.sin(view.phi), cp = Math.cos(view.phi), st = Math.sin(view.theta), ct = Math.cos(view.theta);
  const f = [-sp * st, -cp, -sp * ct];
  let right = [-f[2], 0, f[0]];
  const rl = Math.hypot(right[0], right[1], right[2]) || 1;
  right = right.map((x) => x / rl);
  const up = [right[1] * f[2] - right[2] * f[1], right[2] * f[0] - right[0] * f[2], right[0] * f[1] - right[1] * f[0]];
  return { right, up };
}

export default function Preview3D({ project: p }: { project: Project }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const three = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; root: THREE.Group } | null>(null);
  const view = useRef<View>({ theta: -0.85, phi: 1.05, dist: 700, pan: [0, 0, 0], center: [0, 0, 0], radius: 300 });
  const [failed, setFailed] = useState('');
  const [show, setShow] = useState({ drawer: true, plate: true, bins: true, lift: false });
  const [info, setInfo] = useState('');
  const [dragging, setDragging] = useState(false);

  const draw = () => {
    const t = three.current;
    if (!t) return;
    const v = view.current;
    const tx = v.center[0] + v.pan[0], ty = v.center[1] + v.pan[1], tz = v.center[2] + v.pan[2];
    t.camera.position.set(
      tx + v.dist * Math.sin(v.phi) * Math.sin(v.theta),
      ty + v.dist * Math.cos(v.phi),
      tz + v.dist * Math.sin(v.phi) * Math.cos(v.theta),
    );
    t.camera.lookAt(tx, ty, tz);
    t.renderer.render(t.scene, t.camera);
  };
  const fit = () => {
    const v = view.current;
    const r = v.radius > 1 ? v.radius : Math.max(p.drawer.w, p.drawer.d, p.drawer.h * 2) / 2;
    Object.assign(v, { dist: r * 3.1 + 80, theta: -0.85, phi: 1.05, pan: [0, 0, 0] });
  };

  // one-time renderer setup
  useEffect(() => {
    const host = hostRef.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setFailed("This browser or device has WebGL disabled, so the 3D preview can't run.");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    host.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 1, 8000);
    scene.add(new THREE.AmbientLight(0xffffff, 0.55 * Math.PI));
    const key = new THREE.DirectionalLight(0xffffff, 0.75 * Math.PI);
    key.position.set(300, 600, 400);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xc3d6c8, 0.35 * Math.PI);
    fill.position.set(-400, 250, -300);
    scene.add(fill);
    const root = new THREE.Group();
    scene.add(root);
    three.current = { renderer, scene, camera, root };

    let first = true;
    const resize = () => {
      const w = host.clientWidth || 600, h = host.clientHeight || 420;
      if (w < 2 || h < 2) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (first) { first = false; fit(); }
      draw();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    // orbit / pan / zoom
    const el = renderer.domElement;
    el.style.touchAction = 'none';
    let drag: { x: number; y: number; pan: boolean } | null = null;
    const down = (e: PointerEvent) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
      setDragging(true);
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      const v = view.current;
      if (drag.pan) {
        const b = camBasis(v), k = v.dist * 0.0016;
        for (let i = 0; i < 3; i++) v.pan[i] += (-b.right[i] * dx + b.up[i] * dy) * k;
      } else {
        v.theta -= dx * 0.008;
        v.phi = Math.max(0.08, Math.min(Math.PI / 2 - 0.02, v.phi - dy * 0.006));
      }
      draw();
    };
    const up = () => { drag = null; setDragging(false); };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
      const amount = Math.max(-300, Math.min(300, e.deltaY * unit));
      const v = view.current;
      v.dist = Math.max(60, Math.min(4000, v.dist * Math.exp(amount * 0.0016)));
      draw();
    };
    const ctx = (e: Event) => e.preventDefault();
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('contextmenu', ctx);

    return () => {
      ro.disconnect();
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('contextmenu', ctx);
      root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
      renderer.dispose();
      host.removeChild(el);
      three.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // rebuild the scene whenever the project or toggles change
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    const root = t.root;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    });
    root.clear();
    const bbox = new THREE.Box3();
    const cx = -p.drawer.w / 2, cy = -p.drawer.d / 2;
    const showPlate = show.plate && p.baseplateEnabled;
    const lift = show.lift ? Math.max(30, p.drawer.h * 0.55) : 0;
    let triCount = 0;
    const wallT = 8;

    if (show.drawer) {
      const dw = p.drawer.w, dd = p.drawer.d, dh = p.drawer.h;
      const woodMat = new THREE.MeshLambertMaterial({ color: 0x7d6f5a, transparent: true, opacity: 0.26, side: THREE.DoubleSide });
      const baseMat = new THREE.MeshPhongMaterial({ color: 0x6f6252, flatShading: true, shininess: 6 });
      const bottom: Tri[] = [];
      addBox(bottom, 0, 0, -wallT, dw, dd, wallT);
      root.add(meshFromTris(bottom, baseMat, cx, cy, 0, bbox));
      const walls: Tri[] = [];
      addBox(walls, -wallT, -wallT, -wallT, wallT, dd + 2 * wallT, dh + wallT);
      addBox(walls, dw, -wallT, -wallT, wallT, dd + 2 * wallT, dh + wallT);
      addBox(walls, 0, -wallT, -wallT, dw, wallT, dh + wallT);
      addBox(walls, 0, dd, -wallT, dw, wallT, dh + wallT);
      root.add(meshFromTris(walls, woodMat, cx, cy, 0, bbox));
      triCount += bottom.length + walls.length;
    }
    if (showPlate) {
      const { tiles, plate } = computeBaseplateTiles(p);
      const plateMat = new THREE.MeshPhongMaterial({ color: 0x5c6b5f, flatShading: true, shininess: 6 });
      tiles.forEach((tile) => {
        const tris = tileTriangles(p, tile, plate);
        if (!tris.length) return;
        root.add(meshFromTris(tris, plateMat, cx + tile.x0, cy + tile.y0, 0, bbox));
        triCount += tris.length;
      });
    }
    // obstructions are real objects in the drawer, so show them — otherwise a notched
    // baseplate looks like it has holes for no reason
    if (show.drawer && p.blocked.length) {
      const blkMat = new THREE.MeshPhongMaterial({ color: 0x8f5148, flatShading: true, shininess: 4, transparent: true, opacity: 0.55 });
      const blk: Tri[] = [];
      p.blocked.forEach((bl) => addBox(blk, bl.x, bl.y, 0, bl.w, bl.d, obstructionH(p, bl)));
      root.add(meshFromTris(blk, blkMat, cx, cy, 0, bbox));
      triCount += blk.length;
    }
    if (show.bins) {
      p.bins.forEach((bin) => {
        const mat = new THREE.MeshPhongMaterial({ color: new THREE.Color(bin.color), flatShading: true, shininess: 8 });
        const tris = binTriangles(p, bin);
        const z = binBaseZ(p, bin) + lift * binLevel(p, bin);
        root.add(meshFromTris(tris, mat, cx + bin.x, cy + bin.y, z, bbox));
        triCount += tris.length;
      });
    }

    // aim at the drawer's centre when it's shown, so the container sits dead-centre
    const v = view.current;
    if (show.drawer) {
      v.center = [0, (p.drawer.h - wallT) / 2, 0];
      v.radius = Math.max(p.drawer.w, p.drawer.d, p.drawer.h) / 2 + wallT;
    } else if (!bbox.isEmpty()) {
      const c = bbox.getCenter(new THREE.Vector3()), s = bbox.getSize(new THREE.Vector3());
      v.center = [c.x, c.y, c.z];
      v.radius = Math.max(s.x, s.y, s.z) / 2 || 100;
    } else {
      v.center = [0, 0, 0];
      v.radius = 100;
    }
    const lv = maxLevel(p);
    setInfo(p.bins.length
      ? '— ' + p.bins.length + ' bin(s)' + (lv > 1 ? ' in ' + lv + ' levels' : '') + ', ' + triCount.toLocaleString() + ' triangles'
      : '— add bins to see them here');
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, show]);

  const toggle = (k: keyof typeof show, label: string) => (
    <label className="flex cursor-pointer items-center gap-1.5 text-xs">
      <input type="checkbox" className="checkbox checkbox-xs checkbox-primary" checked={show[k]}
        onChange={(e) => setShow((s) => ({ ...s, [k]: e.target.checked }))} />
      {label}
    </label>
  );

  return (
    <Section title="3D preview" badge={info} tour="view3d">
      <div className="mb-2.5 flex flex-wrap items-center gap-3.5">
        {toggle('drawer', 'Drawer')}
        {toggle('plate', 'Baseplate')}
        {toggle('bins', 'Bins')}
        {toggle('lift', 'Lift bins out')}
        <button type="button" className="bb-btn bb-btn-xs ml-auto" onClick={() => { fit(); draw(); }}>Reset view</button>
      </div>
      <div
        ref={hostRef}
        className={'relative h-[320px] w-full overflow-hidden rounded-field border sm:h-[420px] ' + (dragging ? 'cursor-grabbing' : 'cursor-grab')}
        style={{ borderColor: 'var(--bb-line)', background: 'linear-gradient(180deg,#232827 0%, #151817 100%)' }}
      >
        {failed && <div className="bb-empty absolute inset-0 flex items-center justify-center">{failed}</div>}
      </div>
      <p className="bb-hint">Drag to orbit · scroll to zoom · right-drag or shift-drag to pan</p>
    </Section>
  );
}
