import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  bbox,
  fitShape,
  makeShape,
  moveShape,
  outline,
  polys,
  type Pt,
  type QuadS,
  type Shape,
  type ShapeKind,
} from '@psc/core';
import { COLORS, markerPoly, path, type Layer, type Marker } from './DesignSvg';

export type Tool = 'select' | ShapeKind;
type View = { k: number; ox: number; oy: number }; // px per mm, origin offset in px
type Drag =
  | { t: 'pan'; x: number; y: number; v: View }
  | { t: 'draw'; a: Pt; b: Pt }
  | { t: 'move'; id: string; a: Pt; orig: Shape; moved: boolean }
  | { t: 'box'; id: string; corner: number; orig: Shape; moved: boolean }
  | { t: 'vertex'; id: string; i: number; orig: QuadS; moved: boolean };

const snapTo = (v: number, s: number) => (s > 0 ? Math.round(v / s) * s : v);

/**
 * Editable 2D canvas in millimetres. Shapes are drawn with the active tool, moved by dragging, resized by their corner
 * handles (quadrilaterals by their vertices). Wheel zooms around the cursor; dragging empty space pans.
 * `onChange(shapes, commit)` — commit is true once at the start of each gesture so the caller can record undo history.
 */
export default function Canvas({
  w,
  h,
  marker = 'none',
  background = [],
  shapes,
  color,
  selected,
  onSelect,
  tool,
  setTool,
  snap,
  onChange,
  labels = [],
}: {
  w: number;
  h: number;
  marker?: Marker;
  background?: Layer[];
  shapes: Shape[];
  color: string;
  selected: string | null;
  labels?: { at: Pt; text: string }[];
  onSelect: (id: string | null) => void;
  tool: Tool;
  setTool: (t: Tool) => void;
  snap: number;
  onChange: (s: Shape[], commit: boolean) => void;
}) {
  const box = useRef<HTMLDivElement>(null),
    [size, setSize] = useState({ w: 600, h: 400 });
  const [view, setView] = useState<View | null>(null),
    [drag, setDrag] = useState<Drag | null>(null),
    [cursor, setCursor] = useState<Pt | null>(null);

  const fit = (sw = size.w, sh = size.h): View => {
    const k = Math.min((sw - 60) / w, (sh - 60) / h);
    return { k, ox: (sw - w * k) / 2, oy: (sh - h * k) / 2 };
  };
  const measured = useRef(false),
    mounted = useRef(false);
  useLayoutEffect(() => {
    const el = box.current!;
    const measure = () => {
      const s = { w: el.clientWidth, h: el.clientHeight };
      if (!s.w || !s.h) return;
      setSize(s);
      if (!measured.current) {
        measured.current = true;
        setView(fit(s.w, s.h));
      } // first real size: fit the glass
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (mounted.current) setView(fit());
    mounted.current = true;
  }, [w, h]); // glass size changed: refit
  const v = view ?? fit();
  const toMm = (e: { clientX: number; clientY: number }): Pt => {
    const r = box.current!.getBoundingClientRect();
    return [(e.clientX - r.left - v.ox) / v.k, (e.clientY - r.top - v.oy) / v.k];
  };
  const sp = (p: Pt): Pt => [snapTo(p[0], snap), snapTo(p[1], snap)];
  const replace = (s: Shape, commit: boolean) =>
    onChange(
      shapes.map((x) => (x.id === s.id ? s : x)),
      commit,
    );

  useEffect(() => {
    // wheel zoom (non-passive so the page does not scroll)
    const el = box.current!;
    const h = (e: WheelEvent) => {
      e.preventDefault();
      setView((cur) => {
        const c = cur ?? fit(),
          r = el.getBoundingClientRect(),
          mx = e.clientX - r.left,
          my = e.clientY - r.top;
        const k = Math.min(Math.max(c.k * Math.exp(-e.deltaY * 0.0015), 2), 400);
        return { k, ox: mx - ((mx - c.ox) / c.k) * k, oy: my - ((my - c.oy) / c.k) * k };
      });
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, [w, h]);

  const down = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const p = toMm(e),
      target = (e.target as Element).closest('[data-h]') as HTMLElement | null;
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      setDrag({ t: 'pan', x: e.clientX, y: e.clientY, v });
      return;
    }
    if (tool !== 'select') {
      setDrag({ t: 'draw', a: sp(p), b: sp(p) });
      return;
    }
    if (target) {
      const [kind, id, n] = target.dataset.h!.split(':'),
        s = shapes.find((x) => x.id === id);
      if (!s) return;
      onSelect(id);
      if (kind === 'shape') setDrag({ t: 'move', id, a: p, orig: s, moved: false });
      else if (kind === 'box') setDrag({ t: 'box', id, corner: +n, orig: s, moved: false });
      else if (kind === 'vtx' && s.kind === 'quad') setDrag({ t: 'vertex', id, i: +n, orig: s, moved: false });
      return;
    }
    onSelect(null);
    setDrag({ t: 'pan', x: e.clientX, y: e.clientY, v });
  };
  const move = (e: React.PointerEvent) => {
    const p = toMm(e);
    setCursor(p);
    if (!drag) return;
    if (drag.t === 'pan') {
      setView({ ...drag.v, ox: drag.v.ox + e.clientX - drag.x, oy: drag.v.oy + e.clientY - drag.y });
      return;
    }
    if (drag.t === 'draw') {
      setDrag({ ...drag, b: sp(p) });
      return;
    }
    const first = !drag.moved;
    if (drag.t === 'move') {
      const dx = snapTo(p[0] - drag.a[0], snap),
        dy = snapTo(p[1] - drag.a[1], snap);
      if (!dx && !dy && first) return;
      replace(moveShape(drag.orig, dx, dy), first);
    } else if (drag.t === 'box') {
      const b = bbox([outline(drag.orig)]),
        q = sp(p);
      const fx = drag.corner === 0 || drag.corner === 3 ? b.x1 : b.x0,
        fy = drag.corner < 2 ? b.y1 : b.y0; // fixed opposite corner
      const [x0, x1] = [Math.min(fx, q[0]), Math.max(fx, q[0])],
        [y0, y1] = [Math.min(fy, q[1]), Math.max(fy, q[1])];
      if (x1 - x0 < 0.05 || y1 - y0 < 0.05) return;
      replace(fitShape(drag.orig, x0, y0, x1, y1), first);
    } else if (drag.t === 'vertex') {
      const pts = drag.orig.pts.map((x, i) => (i === drag.i ? sp(p) : x)) as QuadS['pts'];
      replace({ ...drag.orig, pts }, first);
    }
    if (first) setDrag({ ...drag, moved: true });
  };
  const up = () => {
    if (drag?.t === 'draw') {
      const [x0, x1] = [Math.min(drag.a[0], drag.b[0]), Math.max(drag.a[0], drag.b[0])],
        [y0, y1] = [Math.min(drag.a[1], drag.b[1]), Math.max(drag.a[1], drag.b[1])];
      if (x1 - x0 > 0.05 && y1 - y0 > 0.05) {
        const s = makeShape(tool as ShapeKind, x0, y0, x1 - x0, y1 - y0);
        onChange([...shapes, s], true);
        onSelect(s.id);
        setTool('select');
      }
    }
    setDrag(null);
  };

  const sel = shapes.find((s) => s.id === selected),
    hs = 7 / v.k; // handle size in mm
  const major = 5,
    grid: React.ReactNode[] = [];
  const step = v.k > 18 ? 1 : v.k > 6 ? 5 : 10;
  for (let x = 0; x <= w + 1e-9; x += step)
    grid.push(
      <line key={'x' + x} x1={x} y1={0} x2={x} y2={h} className={Math.abs(x % major) < 1e-9 ? 'g-major' : 'g-minor'} />,
    );
  for (let y = 0; y <= h + 1e-9; y += step)
    grid.push(
      <line key={'y' + y} x1={0} y1={y} x2={w} y2={y} className={Math.abs(y % major) < 1e-9 ? 'g-major' : 'g-minor'} />,
    );
  const mk = markerPoly(marker, w, h);
  const preview =
    drag?.t === 'draw'
      ? [
          Math.min(drag.a[0], drag.b[0]),
          Math.min(drag.a[1], drag.b[1]),
          Math.abs(drag.b[0] - drag.a[0]),
          Math.abs(drag.b[1] - drag.a[1]),
        ]
      : null;

  return (
    <div
      ref={box}
      className={'canvas' + (tool !== 'select' ? ' drawing' : '') + (drag?.t === 'pan' ? ' panning' : '')}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerLeave={() => setCursor(null)}
    >
      <svg width="100%" height="100%">
        <g transform={`translate(${v.ox} ${v.oy}) scale(${v.k})`}>
          <rect
            x={0}
            y={0}
            width={w}
            height={h}
            fill={COLORS.glass}
            stroke="var(--mut)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <g className="grid">{grid}</g>
          {background.map((l, i) => (
            <path
              key={i}
              d={path(l.polys)}
              fill={l.fill}
              fillOpacity={l.opacity ?? 0.5}
              stroke={l.stroke ?? 'none'}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          ))}
          {mk && <path d={path([mk])} fill="var(--fg)" opacity={0.5} pointerEvents="none" />}
          {shapes.map((s) => {
            const [base, ...copies] = polys(s);
            return (
              <g key={s.id}>
                {copies.length > 0 && (
                  <path
                    d={path(copies)}
                    fill={color}
                    fillOpacity={0.35}
                    stroke={color}
                    strokeDasharray="3 2"
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                  />
                )}
                <path
                  d={path([base])}
                  data-h={`shape:${s.id}`}
                  fill={color}
                  fillOpacity={0.55}
                  stroke={s.id === selected ? 'var(--fg)' : color}
                  strokeWidth={s.id === selected ? 2 : 1}
                  vectorEffect="non-scaling-stroke"
                  className="shape"
                />
              </g>
            );
          })}
          {sel &&
            tool === 'select' &&
            (sel.kind === 'quad'
              ? sel.pts.map(([x, y], i) => (
                  <circle
                    key={i}
                    data-h={`vtx:${sel.id}:${i}`}
                    cx={x}
                    cy={y}
                    r={hs * 0.6}
                    className="handle"
                    vectorEffect="non-scaling-stroke"
                  />
                ))
              : (() => {
                  const b = bbox([outline(sel)]);
                  return [
                    [b.x0, b.y0],
                    [b.x1, b.y0],
                    [b.x1, b.y1],
                    [b.x0, b.y1],
                  ].map(([x, y], i) => (
                    <rect
                      key={i}
                      data-h={`box:${sel.id}:${i}`}
                      x={x - hs / 2}
                      y={y - hs / 2}
                      width={hs}
                      height={hs}
                      className="handle"
                      vectorEffect="non-scaling-stroke"
                    />
                  ));
                })())}
          {labels.map((l, i) => (
            <text
              key={i}
              x={l.at[0]}
              y={l.at[1]}
              fontSize={Math.max(w, h) * 0.035}
              textAnchor="middle"
              dominantBaseline="central"
              className="svg-label canvas-label"
              pointerEvents="none"
            >
              {l.text}
            </text>
          ))}
          {preview && (
            <rect
              x={preview[0]}
              y={preview[1]}
              width={preview[2]}
              height={preview[3]}
              fill={color}
              fillOpacity={0.25}
              stroke={color}
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </g>
      </svg>
      <div className="canvas-status">
        {cursor ? `x ${cursor[0].toFixed(2)} · y ${cursor[1].toFixed(2)} mm` : `${w} × ${h} mm glass`}
        <span>
          {tool === 'select'
            ? 'Drag to move · corners to resize · scroll to zoom · drag empty space to pan'
            : 'Drag on the glass to draw'}
        </span>
        <button className="link" onPointerDown={(e) => e.stopPropagation()} onClick={() => setView(fit())}>
          Fit
        </button>
      </div>
    </div>
  );
}
