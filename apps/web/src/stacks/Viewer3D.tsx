import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Region, Slab3 } from '@psc/core';
import { lookOf, roleOf, type Appearance } from './appearance';

export type SlabState = 'solid' | 'ghost';
export interface ViewSlab extends Slab3 { state: SlabState; ap?: Appearance }
type Look = 'realistic' | 'schematic';

const U = 0.25;          // scene units per mm of footprint
const GAP = 0.6;         // exploded spacing per layer (scene units)
const DROP = 4;          // height layers fall from / rise to
const ROLE_SCH: Record<string, number> = { glass: 0xc9d3dc, ito: 0x5b8def, perov: 0x6b4432, htl: 0xe0912f, etl: 0x7c6fd0, bcp: 0xb8d8b0, metal: 0x2ea043, other: 0x9aa0a6 };

/** Layer material from its look (colour, opacity, roughness, metallic: the layer's own or the default for its kind). */
function material(s: ViewSlab, look: Look): THREE.MeshStandardMaterial {
  const r = roleOf(s), L = lookOf(s, s.ap);
  if (look === 'schematic') return new THREE.MeshStandardMaterial({ color: s.ap?.c ?? ROLE_SCH[r] ?? ROLE_SCH.other, roughness: 0.65, transparent: true, opacity: s.ap?.o ?? (r === 'ito' ? 0.75 : 1) });
  const base = { color: L.c, roughness: L.r, metalness: L.m, transparent: true, opacity: L.o };
  const P = THREE.MeshPhysicalMaterial;
  switch (r) {
    case 'glass': return new P({ ...base, transmission: 0.9, ior: 1.5, thickness: 0.8 });
    case 'ito': return new P({ ...base, clearcoat: 0.6 });
    case 'perov': return new P({ ...base, iridescence: 0.7, iridescenceIOR: 1.8, clearcoat: 0.5 });
    case 'htl': return new P({ ...base, clearcoat: 0.3 });
    default: return new P(base);
  }
}
const baseOpacity = (m: THREE.Material) => (m.userData.base as number | undefined) ?? 1;

/** Extruded geometry of a region (mm) centred on the glass, rising along +Y from 0 to h (scene units). */
function geometry(region: Region, h: number, W: number, H: number) {
  const v = ([x, y]: [number, number]) => new THREE.Vector2((x - W / 2) * U, -(y - H / 2) * U);
  const shapes = region.filter((p) => p[0]?.length >= 3).map((rings) => {
    const s = new THREE.Shape(rings[0].map(v));
    rings.slice(1).forEach((r) => s.holes.push(new THREE.Path(r.map(v))));
    return s;
  });
  const g = new THREE.ExtrudeGeometry(shapes, { depth: Math.max(h, 0.001), bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  return g;
}

/** One layer: a mesh per part (each part starts on what is below it and ends at the layer's common top), sharing one material. */
function slabMesh(s: ViewSlab, W: number, H: number, look: Look) {
  const mat = material(s, look), g = new THREE.Group(), top = s.y0 + s.h;
  mat.userData.base = mat.opacity;
  // parts with their own thickness (evaporated metal) rise to the level of the highest part in the exploded view
  const level = Math.max(...s.parts.map((p) => p.y0));
  for (const p of s.parts) {
    const mesh = new THREE.Mesh(geometry(p.region, (p.h ?? top - p.y0) * U, W, H), mat);
    mesh.position.y = (p.y0 - s.y0) * U;
    mesh.userData.rest = (p.y0 - s.y0) * U; mesh.userData.lift = p.h !== undefined ? (level - p.y0) * U : 0;
    // leader-line targets: the outline of each separate piece (each metal strip or pixel), halfway up its edge
    const ht = (p.h ?? top - p.y0) * U;
    mesh.userData.outlines = p.region.filter((poly) => poly[0]?.length >= 3).map((poly) => poly[0].map(([x, y]) => new THREE.Vector3((x - W / 2) * U, ht / 2, (y - H / 2) * U)));
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
  }
  g.userData.mat = mat;
  return g;
}
const matOf = (g: THREE.Group) => g.userData.mat as THREE.MeshStandardMaterial;
function dispose(g: THREE.Group) { g.children.forEach((c) => (c as THREE.Mesh).geometry.dispose()); matOf(g).dispose(); }
const sig = (s: ViewSlab, look: Look) => `${look}|${JSON.stringify(s.ap ?? {})}|${s.kind}|${s.mat}|${s.name}|${s.y0.toFixed(4)}|${s.h.toFixed(4)}|${JSON.stringify(s.parts)}`;

function lights(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(6, 12, 8); sun.castShadow = true; scene.add(sun);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.16 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.01; floor.receiveShadow = true; scene.add(floor);
}
/** Camera distance that fits a box of footprint radius r and height h for a vertical field of view. */
const fitDistance = (r: number, h: number, fov: number, aspect: number) => {
  const rad = Math.hypot(r, h / 2) * 1.12, v = THREE.MathUtils.degToRad(fov) / 2, hz = Math.atan(Math.tan(v) * aspect);
  return rad / Math.sin(Math.min(v, hz));
};

type Item = { mesh: THREE.Group; slab: ViewSlab; idx: number; ex: number; sig: string; off: number; offT: number; op: number; opT: number; base: number; removing: boolean; el: HTMLDivElement; ln: SVGPathElement; hidden?: boolean };
/** Layer legend: tags (rounded labels), lines (a leader line from the layer to underlined text) or hidden. */
export type LegendMode = 'tags' | 'lines' | 'off';
const SVGNS = 'http://www.w3.org/2000/svg';
const readMode = (): LegendMode => { try { const v = localStorage.getItem('psc-legend'); return v === 'lines' || v === 'off' ? v : 'tags'; } catch { return 'tags'; } };

/**
 * Device stack in 3D. The camera only orbits the centre of the stack (rotation and view angle from top to side); there is no zoom
 * or pan. Scrolling or pinching opens the exploded view. Layers drop in when added and rise out when removed; a ghost layer
 * previews the layer being chosen.
 */
/**
 * `cog`: the view controls open from a cog in the bottom-left corner, as a bar along the bottom of the view (batch pages),
 * instead of a bar below it. `corner`: something placed in the bottom-right corner of the view (the batch's schedule button).
 */
export default function Viewer3D({ slabs, w, h, height = 520, cog = false, corner }: { slabs: ViewSlab[]; w: number; h: number; height?: number; cog?: boolean; corner?: React.ReactNode }) {
  const [panel, setPanel] = useState(false), cogRef = useRef<HTMLDivElement>(null), panelRef = useRef<HTMLDivElement>(null);
  // the open settings bar must not cover the stack: refit it into the space above the bar
  useEffect(() => { api.current?.inset(panel && panelRef.current ? panelRef.current.offsetHeight + 62 : 0); }, [panel]); // the bar, the cog under it and the margins
  useEffect(() => {
    if (!panel) return;
    const away = (e: MouseEvent) => { if (!cogRef.current?.contains(e.target as Node)) setPanel(false); }, esc = (e: KeyboardEvent) => e.key === 'Escape' && setPanel(false);
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [panel]);
  const host = useRef<HTMLDivElement>(null), api = useRef<{ sync: (s: ViewSlab[], look: Look) => void; reset: () => void; png: () => string; explode: (v: number | ((x: number) => number)) => void; flip: (on: boolean) => void; inset: (px: number) => void } | null>(null);
  const [look, setLook] = useState<Look>('realistic'), [ex, setEx] = useState(0), [flipped, setFlipped] = useState(false), [legend, setLegendState] = useState<LegendMode>(readMode);
  const mode = useRef<LegendMode>(legend); mode.current = legend;
  const setLegend = (m: LegendMode) => { setLegendState(m); try { localStorage.setItem('psc-legend', m); } catch { /* private window */ } };
  const dims = useRef({ w, h }); dims.current = { w, h };

  useEffect(() => {
    const el = host.current!, size = { w: 1, h: 1 }, items = new Map<string, Item>();
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    el.prepend(renderer.domElement);
    const scene = new THREE.Scene(); lights(scene, renderer);
    const leaders = document.createElementNS(SVGNS, 'svg'); leaders.classList.add('leaders'); el.appendChild(leaders);
    const root = new THREE.Group(); scene.add(root); // the whole stack; turned over by Flip
    const cam = new THREE.PerspectiveCamera(24, 1, 0.1, 400), ctl = new OrbitControls(cam, renderer.domElement);
    Object.assign(ctl, { enableZoom: false, enablePan: false, enableDamping: true, minPolarAngle: 0.02, maxPolarAngle: Math.PI / 2 - 0.03, rotateSpeed: 0.8 });
    let explode = 0, explodeT = 0, dist = 40, first = true, frames = 0, flip = 0, flipT = 0;
    const shift = { x: 0, y: 0 };
    const dir = new THREE.Vector3();
    const reset = () => { const s = new THREE.Spherical(1, THREE.MathUtils.degToRad(58), THREE.MathUtils.degToRad(40)); dir.setFromSpherical(s); cam.position.copy(ctl.target).addScaledVector(dir, dist); ctl.update(); };
    reset();

    const sync = (list: ViewSlab[], lk: Look) => {
      const { w: W, h: H } = dims.current, keep = new Set(list.map((s) => s.key));
      let rank = 0; // exploded-view position: the ITO stays on its glass, every later layer gets its own gap
      list.forEach((s, idx) => {
        const ex = s.kind === 'glass' || s.kind === 'ito' ? 0 : ++rank;
        const sg = sig(s, lk), ghost = s.state === 'ghost';
        let it = items.get(s.key);
        if (it && !it.removing && it.sig !== sg) { root.remove(it.mesh); dispose(it.mesh); it.mesh = slabMesh(s, W, H, lk); root.add(it.mesh); it.sig = sg; }
        if (!it || it.removing) {
          if (it) { root.remove(it.mesh); dispose(it.mesh); it.el.remove(); it.ln.remove(); }
          const mesh = slabMesh(s, W, H, lk), lbl = document.createElement('div'), ln = document.createElementNS(SVGNS, 'path');
          lbl.className = 'lbl'; el.appendChild(lbl); leaders.appendChild(ln); root.add(mesh);
          it = { mesh, slab: s, idx, ex, sig: sg, off: first ? 0 : DROP, offT: 0, op: first ? 1 : 0, opT: 1, base: s.y0, removing: false, el: lbl, ln };
          if (ghost && !first) { it.off = 0.6; }
          items.set(s.key, it);
        }
        Object.assign(it, { slab: s, idx, ex, offT: ghost ? 0.45 : 0, opT: ghost ? 0.32 : 1 });
        // glass and ITO share one label: "Glass + ITO · 12 × 12 mm · ITO 150 nm"
        const ito = s.kind === 'glass' ? list.find((x) => x.kind === 'ito') : undefined;
        const label = ito ? `Glass + ITO · ${s.label.split(' · ').slice(1).join(' · ')}${ito.label.includes(' · ') ? ' · ITO ' + ito.label.split(' · ')[1] : ''}` : s.label;
        it.hidden = s.kind === 'ito' && list.some((x) => x.kind === 'glass');
        it.el.textContent = (size.w < 560 ? label.split(' · ')[0] : label) + (ghost ? ' (preview)' : '');
        it.el.dataset.full = label;
        it.el.classList.toggle('ghost', ghost);
      });
      for (const [k, it] of items) if (!keep.has(k) && !it.removing) Object.assign(it, { removing: true, offT: DROP, opT: 0 });
      first = false;
    };
    const png = () => { // without the label column offset, so the stack is centred in the image
      const o = cam.view ? { ...cam.view } : null; cam.clearViewOffset(); renderer.render(scene, cam); const url = renderer.domElement.toDataURL('image/png');
      if (o) cam.setViewOffset(o.fullWidth, o.fullHeight, o.offsetX, o.offsetY, o.width, o.height); return url; };
    let inset = 0; // px at the bottom of the view covered by the settings bar: the stack is fitted above it
    api.current = { inset: (px) => { inset = px; frames = 6; }, sync, reset: () => { flipT = 0; setFlipped(false); reset(); }, png, flip: (on) => { flipT = on ? 1 : 0; }, explode: (v) => { explodeT = Math.max(0, Math.min(1, typeof v === 'function' ? v(explodeT) : v)); setEx(explodeT); } };

    const ro = new ResizeObserver(() => { size.w = el.clientWidth; size.h = el.clientHeight; items.forEach((it) => { const f = it.el.dataset.full ?? ''; const g = it.el.classList.contains('ghost'); it.el.textContent = (size.w < 560 ? f.split(' · ')[0] : f) + (g ? ' (preview)' : ''); }); renderer.setSize(size.w, size.h); cam.aspect = size.w / size.h; cam.updateProjectionMatrix(); });
    ro.observe(el);
    const wheel = (e: WheelEvent) => { e.preventDefault(); api.current!.explode((x) => x - e.deltaY * 0.0015); };
    renderer.domElement.addEventListener('wheel', wheel, { passive: false });
    const touches = new Map<number, [number, number]>(); let pinch = 0;
    const pd = (e: PointerEvent) => { if (e.pointerType === 'touch') touches.set(e.pointerId, [e.clientX, e.clientY]); };
    const pm = (e: PointerEvent) => {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (touches.size === 2) { const [a, b] = [...touches.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) api.current!.explode((x) => x + (d - pinch) * 0.004); pinch = d; }
    };
    const pu = (e: PointerEvent) => { touches.delete(e.pointerId); if (touches.size < 2) pinch = 0; };
    renderer.domElement.addEventListener('pointerdown', pd); window.addEventListener('pointermove', pm); window.addEventListener('pointerup', pu);

    const v = new THREE.Vector3(); let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      explode += (explodeT - explode) * 0.14;
      const live = [...items.values()].filter((i) => !i.removing), top = live.reduce((m, i) => Math.max(m, (i.slab.y0 + i.slab.h) * U), 0.5);
      const totalH = top + explode * GAP * live.reduce((m, i) => Math.max(m, i.ex), 0), { w: W, h: H } = dims.current;
      flip += (flipT - flip) * 0.12; // turn the stack over about its long axis, keeping it on the floor
      const th = flip * Math.PI; root.rotation.x = th; root.position.y = (totalH * (1 - Math.cos(th))) / 2; root.updateMatrixWorld();
      const W2 = (x: number, y: number, z: number) => v.set(x, y, z).applyMatrix4(root.matrixWorld);
      ctl.target.lerp(v.set(0, totalH / 2, 0), 0.15);
      dir.copy(cam.position).sub(ctl.target).normalize(); cam.position.copy(ctl.target).addScaledVector(dir, dist);
      // fit: the stack plus the label column fill the view; the stack sits left of its labels at any angle
      const md = mode.current, gapPx = md === 'lines' ? 46 : 14;
      const lw = md === 'off' ? 0 : Math.max(0, ...[...items.values()].filter((i) => i.op > 0.05).map((i) => i.el.offsetWidth || 120));
      const lab = md === 'off' ? 0 : Math.min(0.9, (2 * (lw + gapPx + 10)) / Math.max(size.w, 1));
      cam.clearViewOffset(); cam.updateMatrixWorld();
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const cx of [-1, 1]) for (const cz of [-1, 1]) for (const cy of [0, totalH]) {
        v.set(cx * W * U / 2, cy, cz * H * U / 2).project(cam); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
      }
      if (x1 > x0) {
        const ib = Math.min(0.6, inset / Math.max(size.h, 1)), f = Math.max((x1 - x0) / (1.84 - lab), (y1 - y0) / (1.64 * (1 - ib))), k = frames < 12 ? 0.6 : 0.15;
        dist += (dist * f - dist) * k;
        shift.x += (-(x1 - x0 + lab) / 2 - x0 - shift.x) * k; shift.y += (ib - (y0 + y1) / 2 - shift.y) * k;
      }
      frames++;
      cam.setViewOffset(size.w, size.h, (-shift.x * size.w) / 2, (shift.y * size.h) / 2, size.w, size.h); cam.updateMatrixWorld();
      // label column: just right of the stack's rightmost projected corner
      let rx = -Infinity, corner = [W / 2, H / 2];
      for (const cx of [-1, 1]) for (const cz of [-1, 1]) { W2(cx * W * U / 2, 0, cz * H * U / 2).project(cam); if (v.x > rx) { rx = v.x; corner = [cx * W / 2, cz * H / 2]; } }
      for (const cx of [-1, 1]) for (const cz of [-1, 1]) { W2(cx * W * U / 2, totalH, cz * H * U / 2).project(cam); rx = Math.max(rx, v.x); }
      const lx = (rx * 0.5 + 0.5) * size.w + gapPx;
      const tags: { it: Item; x: number; y: number; ax: number; ay: number }[] = [];
      for (const [k, it] of items) {
        it.off += (it.offT - it.off) * 0.12; it.op += (it.opT - it.op) * 0.14; it.base += (it.slab.y0 - it.base) * 0.15;
        const m = matOf(it.mesh);
        const clear = it.slab.kind === 'glass' ? 1 - 0.7 * flip : 1; // from below, look through the glass at the ITO and the device
        m.opacity = baseOpacity(m) * clear * Math.max(0, Math.min(1, it.op)); m.depthWrite = it.op > 0.95 && clear > 0.95 && baseOpacity(m) > 0.98;
        it.mesh.position.y = it.base * U + it.off + explode * GAP * it.ex;
        for (const c of it.mesh.children) if (c.userData.lift) c.position.y = c.userData.rest + c.userData.lift * Math.min(1, explode / 0.02);
        if (it.removing && it.op < 0.02) { root.remove(it.mesh); dispose(it.mesh); it.el.remove(); it.ln.remove(); items.delete(k); continue; }
        W2(corner[0] * U, it.mesh.position.y + (it.slab.h * U) / 2, corner[1] * U).project(cam);
        let ax = (v.x * 0.5 + 0.5) * size.w, ay = (-v.y * 0.5 + 0.5) * size.h;
        // the line ends on the layer's own edge nearest the label column (closest point of any of its outlines, on screen), so
        // layers cut away in the scrape zone and metal strips are met where they really are
        if (it.mesh.children.length) {
          it.mesh.updateMatrixWorld(true);
          let best = Infinity; const qx = lx, qy = ay;
          const scr = (a: THREE.Vector3, m: THREE.Matrix4): [number, number] => { v.copy(a).applyMatrix4(m).project(cam); return [(v.x * 0.5 + 0.5) * size.w, (-v.y * 0.5 + 0.5) * size.h]; };
          for (const c of it.mesh.children) for (const ring of (c.userData.outlines ?? []) as THREE.Vector3[][]) {
            const pts = ring.map((a) => scr(a, c.matrixWorld));
            pts.forEach((p0, i) => {
              const p1 = pts[(i + 1) % pts.length], dx = p1[0] - p0[0], dy = p1[1] - p0[1], L = dx * dx + dy * dy;
              const t = L ? Math.max(0, Math.min(1, ((qx - p0[0]) * dx + (qy - p0[1]) * dy) / L)) : 0, px = p0[0] + t * dx, py = p0[1] + t * dy, d = Math.hypot(qx - px, qy - py);
              if (d < best) { best = d; ax = px; ay = py; }
            });
          }
        }
        if (it.hidden) { it.el.style.opacity = '0'; it.ln.setAttribute('d', ''); continue; }
        it.el.style.opacity = md === 'off' ? '0' : String(Math.min(1, it.op * 1.4));
        it.el.classList.toggle('line', md === 'lines');
        tags.push({ it, x: lx, y: ay - 10, ax, ay });
      }
      // labels: in stack order (lowest layer on screen lowest; reversed when flipped), at least one label height apart, inside the view
      tags.sort((a, b) => (flip > 0.5 ? b.it.idx - a.it.idx : a.it.idx - b.it.idx));
      let prev = Infinity;
      for (const t of tags) {
        if (t.it.op < 0.05) continue;
        const w0 = t.it.el.offsetWidth || 120;
        t.y = Math.min(t.y, prev - 24, size.h - 30 - inset); prev = t.y;
        t.x = Math.min(t.x, size.w - w0 - 6);
      }
      let floor = 4; // keep the top labels inside the view: push down from the top, still one label height apart
      for (const t of [...tags].reverse()) { if (t.it.op < 0.05) continue; t.y = Math.max(t.y, floor); floor = t.y + 24; }
      for (const t of tags) {
        if (t.it.op >= 0.05) t.it.el.style.transform = `translate(${t.x}px,${t.y}px)`;
        // leader line: from the layer's edge to the start of the underlined text, then the underline itself is the label's border
        if (md === 'lines' && t.it.op >= 0.05) {
          const uy = t.y + (t.it.el.offsetHeight || 18) - 0.5, ex = t.x - 10;
          t.it.ln.setAttribute('d', `M${t.ax.toFixed(1)},${t.ay.toFixed(1)}L${ex.toFixed(1)},${uy.toFixed(1)}L${t.x.toFixed(1)},${uy.toFixed(1)}`);
          t.it.ln.style.opacity = String(Math.min(1, t.it.op * 1.4));
        } else t.it.ln.setAttribute('d', '');
      }
      ctl.update(); renderer.render(scene, cam);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); ctl.dispose();
      renderer.domElement.removeEventListener('wheel', wheel); window.removeEventListener('pointermove', pm); window.removeEventListener('pointerup', pu);
      items.forEach((it) => { dispose(it.mesh); it.el.remove(); }); leaders.remove();
      renderer.dispose(); renderer.domElement.remove(); api.current = null;
    };
  }, []);

  useEffect(() => { api.current?.sync(slabs, look); }, [slabs, look, w, h]);

  const save = () => { const a = document.createElement('a'); a.href = api.current!.png(); a.download = 'device-stack.png'; a.click(); };
  const controls = (
      <div className="viewer-bar">
        <div className="seg sm">
          <button className={look === 'realistic' ? 'on' : ''} onClick={() => setLook('realistic')}>Realistic</button>
          <button className={look === 'schematic' ? 'on' : ''} onClick={() => setLook('schematic')}>Schematic</button>
        </div>
        <label className="inline small explode">Exploded <input type="range" min={0} max={1} step={0.01} value={ex} onChange={(e) => api.current?.explode(+e.target.value)} /></label>
        <div className="grow" />
        <label className="inline small"><input type="checkbox" checked={legend !== 'off'} onChange={(e) => setLegend(e.target.checked ? 'tags' : 'off')} /> Legend</label>
        {legend !== 'off' && <div className="seg sm">
          <button className={legend === 'tags' ? 'on' : ''} onClick={() => setLegend('tags')}>Tags</button>
          <button className={legend === 'lines' ? 'on' : ''} onClick={() => setLegend('lines')}>Lines</button>
        </div>}
        <button className={'link flip-btn' + (flipped ? ' on' : '')} aria-pressed={flipped} onClick={() => { const f = !flipped; setFlipped(f); api.current?.flip(f); }}>{flipped ? 'Show top side' : 'Flip: view from below'}</button>
        <button className="link" onClick={() => api.current?.reset()}>Reset view</button>
        <button className="link" onClick={save}>Export PNG</button>
      </div>
  );
  if (cog) return (
    <div className="viewer3d with-cog">
      <div ref={host} className="viewer" style={{ height }} />
      <div className="viewer-cog" ref={cogRef}>
        {panel && <div className="viewer-panel" ref={panelRef} role="group" aria-label="View settings">{controls}<p className="mut small viewer-hint">Drag to rotate · scroll or pinch to separate the layers · glass 1 mm, films 100 nm = 0.1 mm (schematic)</p></div>}
        <button className={'cog-btn' + (panel ? ' on' : '')} aria-label="View settings" aria-expanded={panel} title="View settings" onClick={() => setPanel(!panel)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
        </button>
      </div>
      {corner && !panel && <div className="viewer-corner">{corner}</div>}
    </div>
  );
  return (
    <div className="viewer3d">
      <div ref={host} className="viewer" style={{ height }} />
      {controls}
      <p className="mut small viewer-hint">Drag to rotate · scroll or pinch to separate the layers · glass 1 mm, films 100 nm = 0.1 mm (schematic)</p>
    </div>
  );
}

/** Still image of a stack for library cards (rendered offscreen, all layers in place). */
export function renderThumb(slabs: ViewSlab[], W: number, H: number, size: [number, number] = [360, 240]) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(size[0], size[1]); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene(); lights(scene, renderer);
  const meshes = slabs.map((s) => { const m = slabMesh(s, W, H, 'realistic'); m.position.y = s.y0 * U; scene.add(m); return m; });
  const top = slabs.reduce((m, s) => Math.max(m, (s.y0 + s.h) * U), 0.5), cam = new THREE.PerspectiveCamera(24, size[0] / size[1], 0.1, 400);
  const d = fitDistance(Math.hypot(W, H) * U / 2, top, 24, size[0] / size[1]) * 0.92, target = new THREE.Vector3(0, top / 2, 0);
  cam.position.copy(target).add(new THREE.Vector3().setFromSpherical(new THREE.Spherical(d, THREE.MathUtils.degToRad(58), THREE.MathUtils.degToRad(40))));
  cam.lookAt(target);
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/png');
  meshes.forEach(dispose);
  renderer.dispose(); renderer.forceContextLoss();
  return url;
}
