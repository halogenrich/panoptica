import { useState } from 'react';
import { Check } from '../views/common';
import type { BoxGroup } from './charts';

/**
 * Box plots in article style (2 × 2: Jsc, FF / Voc, PCE), on screen and for export. Axes fitted around the data, closed frame with outward ticks,
 * light grid. Each group (device group, batch or stack) has its own colour: the backward box in that colour, the forward box a lighter
 * shade of it, joined to the backward one; the pixels as dots, the outliers (beyond 1.5 × IQR) as triangles and the optional density
 * curve in a darker shade. Hover a dot or box for its values. With outliers hidden, the axis is fitted to the boxes and whiskers,
 * and points beyond it are an arrow at the edge with how many there are (they still count in the box and the statistics).
 */
export const BFW = 1100,
  BFH = 660;
const FONT = '"DejaVu Sans", Verdana, Arial, sans-serif',
  INK = '#111',
  GRID = '#d9d9d9';

/** Colour helpers on #rrggbb (the figure is exported as a standalone SVG, so no CSS colour functions). */
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (c: number[]) =>
  '#' +
  c
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
export const lighter = (h: string, k = 0.45) => hex(rgb(h).map((v) => v + (255 - v) * k));
export const darker = (h: string, k = 0.38) => hex(rgb(h).map((v) => v * (1 - k)));

/** "Show outliers", remembered in this browser and shared by every box plot (statistics, batch report, comparisons, slides). */
export function useOutliers(): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(() => {
    try {
      return localStorage.getItem('psc-outliers') !== '0';
    } catch {
      return true;
    }
  });
  return [
    v,
    (x: boolean) => {
      setV(x);
      try {
        localStorage.setItem('psc-outliers', x ? '1' : '0');
      } catch {
        /* private window */
      }
    },
  ];
}
/** The checkbox for it. */
export function OutlierToggle({ v, on }: { v: boolean; on: (v: boolean) => void }) {
  return (
    <label
      className="inline small"
      title="Untick when one far-off value squeezes the boxes: the axis then fits the boxes and whiskers, and points beyond it show as an arrow with their number. They still count in the statistics."
    >
      <Check v={v} on={on} /> Show outliers
    </label>
  );
}

export type Panel = { key: string; title: React.ReactNode; groups: BoxGroup[] };

/**
 * Axis range around the data so the boxes sit in the middle: the data range plus a quarter of it on each side, widened to
 * round ticks (3–5 intervals), never below 0 (all four quantities are positive).
 */
const nice = (min: number, max: number) => {
  const span = max - min || Math.abs(max) * 0.1 || 1,
    lo0 = Math.max(0, min - span * 0.25),
    hi0 = max + span * 0.25;
  for (const step of [0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100]) {
    const lo = Math.floor(lo0 / step + 1e-9) * step,
      hi = Math.ceil(hi0 / step - 1e-9) * step;
    if ((hi - lo) / step <= 5) return { lo, top: hi > lo ? hi : lo + step, step };
  }
  return { lo: 0, top: Math.ceil(max / 100) * 100, step: 100 };
};
const jit = (k: number, w: number) => (((k * 2654435761) % 1000) / 1000 - 0.5) * w;

/** Gaussian kernel density (Silverman bandwidth) on a grid, normalised to a peak of 1. */
function density(vals: number[], lo: number, hi: number, n = 48): [number, number][] {
  const v = vals.filter(Number.isFinite);
  if (v.length < 5) return []; // too few points for a meaningful density
  const mean = v.reduce((a, x) => a + x, 0) / v.length,
    sd = Math.sqrt(v.reduce((a, x) => a + (x - mean) ** 2, 0) / (v.length - 1));
  const s = [...v].sort((a, b) => a - b),
    iqr = s[Math.floor(0.75 * (s.length - 1))] - s[Math.floor(0.25 * (s.length - 1))];
  const h = 0.9 * Math.max(1e-9, Math.min(sd, iqr / 1.34 || sd)) * v.length ** -0.2;
  const a = Math.max(lo, s[0] - 2.5 * h),
    b = Math.min(hi, s[s.length - 1] + 2.5 * h);
  const pts = Array.from({ length: n }, (_, i) => {
    const y = a + ((b - a) * i) / (n - 1);
    return [y, v.reduce((acc, x) => acc + Math.exp(-0.5 * ((y - x) / h) ** 2), 0)] as [number, number];
  });
  const m = Math.max(...pts.map((p) => p[1])) || 1;
  return pts.map(([y, d]) => [y, d / m]);
}

type Logo = { watermark?: string; group?: string };
type Rect = [number, number, number, number]; // x0, y0, x1, y1
const hit = (a: Rect, b: Rect) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));

/**
 * Where the logo goes inside the plot frame: bottom centre; if a box, whisker, dot or density curve is in the way, top centre,
 * then the corners (bottom left, bottom right, top left, top right); if every spot is taken, the one that covers the least.
 */
function logoSpot(frame: Rect, busy: Rect[], W: number, H: number): [number, number] {
  const m = 8,
    [x0, y0, x1, y1] = frame,
    cx = (x0 + x1) / 2 - W / 2;
  const spots: [number, number][] = [
    [cx, y1 - m - H],
    [cx, y0 + m],
    [x0 + m, y1 - m - H],
    [x1 - m - W, y1 - m - H],
    [x0 + m, y0 + m],
    [x1 - m - W, y0 + m],
  ];
  const rect = ([x, y]: [number, number]): Rect => [x - 4, y - 4, x + W + 4, y + H + 4];
  const free = spots.find((sp) => !busy.some((b) => hit(rect(sp), b)));
  if (free) return free;
  const cost = (sp: [number, number]) => busy.reduce((a, b) => a + overlap(rect(sp), b), 0);
  return spots.reduce((best, sp) => (cost(sp) < cost(best) ? sp : best));
}

function LogoMark({ logo, at, W }: { logo: Logo; at: [number, number]; W: number }) {
  return (
    <g opacity={0.5}>
      {logo.watermark && (
        <image
          href={logo.watermark}
          x={at[0]}
          y={at[1]}
          width={W}
          height={36}
          opacity={0.7}
          preserveAspectRatio="xMidYMid meet"
        />
      )}
      {logo.group && (
        <text x={at[0] + W / 2} y={at[1] + (logo.watermark ? 36 : 0) + 11} fontSize={10} textAnchor="middle" fill={INK}>
          {logo.group}
        </text>
      )}
    </g>
  );
}

function PanelSvg({
  p,
  x,
  y,
  w,
  h,
  unit,
  digits,
  showDensity,
  onTip,
  log = false,
  logo,
  outliers = true,
}: {
  p: Panel;
  x: number;
  y: number;
  w: number;
  h: number;
  unit: string;
  digits: number;
  showDensity: boolean;
  onTip: (t: { x: number; y: number; text: string } | null) => void;
  log?: boolean;
  logo?: Logo;
  outliers?: boolean;
}) {
  const L = 62,
    R = 14,
    T = 34,
    B = 40,
    pw = w - L - R,
    ph = h - T - B,
    ox = x + L,
    oy = y + T;
  // log axis (shunt resistance spans decades): plotted in log10, labelled in the original unit
  const f = (v: number) => (log ? Math.log10(Math.max(v, 1e-9)) : v);
  // outliers hidden: the axis is fitted to the points inside the whiskers only
  const vals = p.groups
    .flatMap((g) =>
      g.series.flatMap((s) =>
        s.points.map((q) => q.v).filter((v) => outliers || !s.stats || (v >= s.stats.lo && v <= s.stats.hi)),
      ),
    )
    .filter((v) => Number.isFinite(v) && (!log || v > 0))
    .map(f);
  const { lo, top, step } = log
    ? (() => {
        const a = Math.floor(Math.min(...vals, 0) - 0.15),
          b = Math.ceil(Math.max(...vals, 1) + 0.15);
        return { lo: a, top: b > a ? b : a + 1, step: 1 };
      })()
    : nice(vals.length ? Math.min(...vals) : 0, vals.length ? Math.max(...vals) : 1);
  const Y = (v: number) => oy + ph - ((Math.max(lo, Math.min(top, f(v))) - lo) / (top - lo)) * ph;
  const Yf = (fv: number) => oy + ph - ((Math.max(lo, Math.min(top, fv)) - lo) / (top - lo)) * ph;
  const gw = pw / Math.max(1, p.groups.length),
    nS = Math.max(1, ...p.groups.map((g) => g.series.length));
  const bw = Math.min(nS > 1 ? 40 : 56, (gw * (showDensity ? 0.42 : 0.55)) / nS),
    dw = Math.min(34, (gw - nS * bw) / 2 - 6);
  const ticks = Array.from({ length: Math.round((top - lo) / step) + 1 }, (_, i) => +(lo + i * step).toFixed(6));
  const dig = step < 0.1 ? 2 : step < 1 ? (step === 0.25 ? 2 : 1) : step === 2.5 ? 1 : 0;
  const tip = (e: React.PointerEvent, text: string) => onTip({ x: e.clientX, y: e.clientY, text });
  // everything drawn in the frame, for placing the logo
  const busy: Rect[] = [];
  let mark: React.ReactNode = null;
  if (logo && (logo.watermark || logo.group)) {
    p.groups.forEach((g, gi) =>
      g.series.forEach((se, si) => {
        const n = g.series.length,
          cx = ox + gw * (gi + 0.5) + (si - (n - 1) / 2) * bw,
          s = se.stats;
        if (!s) return;
        const ys = [s.lo, s.hi, ...se.points.map((q) => q.v)].map(Y),
          side = n > 1 && si === 0 ? -1 : 1;
        busy.push([cx - bw / 2, Math.min(...ys) - 6, cx + bw / 2, Math.max(...ys) + 6]);
        if (showDensity && dw > 6 && se.points.length >= 5) {
          const a = cx + side * (bw / 2 + 4),
            b = a + side * dw;
          busy.push([Math.min(a, b), Math.min(...ys) - 6, Math.max(a, b), Math.max(...ys) + 6]);
        }
      }),
    );
    const W = Math.max(logo.watermark ? 96 : 0, (logo.group?.length ?? 0) * 6),
      H = (logo.watermark ? 36 : 0) + (logo.group ? 14 : 0);
    mark = <LogoMark logo={logo} W={W} at={logoSpot([ox, oy, ox + pw, oy + ph], busy, W, H)} />;
  }
  return (
    <g>
      <text x={ox + pw / 2} y={y + 20} textAnchor="middle" fontSize={17} fill={INK}>
        {p.title}
      </text>
      {ticks.map((t) => (
        <line key={t} x1={ox} x2={ox + pw} y1={Yf(t)} y2={Yf(t)} stroke={GRID} strokeWidth={1} />
      ))}
      {p.groups.map((_, gi) => (
        <line
          key={gi}
          x1={ox + gw * (gi + 0.5)}
          x2={ox + gw * (gi + 0.5)}
          y1={oy}
          y2={oy + ph}
          stroke={GRID}
          strokeWidth={1}
        />
      ))}
      {p.groups.map((g, gi) =>
        g.series.map((se, si) => {
          const n = g.series.length,
            cx = ox + gw * (gi + 0.5) + (si - (n - 1) / 2) * bw,
            s = se.stats;
          if (!s) return null;
          const base = se.color,
            fill = se.light ? lighter(base) : base,
            dark = darker(base),
            edge = darker(base, 0.2);
          const out = (v: number) => v < s.lo || v > s.hi;
          // beyond the axis (only when outliers are hidden): not drawn, counted in an arrow at the edge
          const beyond = (v: number) => !outliers && (f(v) > top || f(v) < lo);
          const above = outliers ? [] : se.points.filter((q) => f(q.v) > top).map((q) => q.v),
            below = outliers ? [] : se.points.filter((q) => f(q.v) < lo).map((q) => q.v);
          const edgeTip = (vs: number[], where: string) =>
            `${g.label}${se.label ? ` · ${se.label}` : ''}: ${vs.length} outlier${vs.length > 1 ? 's' : ''} ${where} the axis (${vs
              .sort((a, b) => a - b)
              .map((v) => v.toFixed(digits))
              .join(', ')} ${unit}), counted in the box`;
          const arrow = (vs: number[], up: boolean) => {
            if (!vs.length) return null;
            const yA = up ? oy + 4 : oy + ph - 4,
              d = up ? 1 : -1,
              t = edgeTip(vs, up ? 'above' : 'below');
            return (
              <g
                onPointerEnter={(e) => tip(e, t)}
                onPointerMove={(e) => tip(e, t)}
                onPointerLeave={() => onTip(null)}
                className="box-edge"
              >
                <title>{t}</title>
                <path
                  d={`M${cx.toFixed(1)},${yA.toFixed(1)}l5.5,${9.5 * d}h-11z`}
                  fill={dark}
                  stroke="#fff"
                  strokeWidth={1}
                />
                <text
                  x={cx + 8}
                  y={yA + 5.5 * d}
                  dominantBaseline="central"
                  fontSize={11}
                  fontWeight={600}
                  fill={dark}
                  paintOrder="stroke"
                  stroke="#fff"
                  strokeWidth={3}
                >
                  {vs.length}
                </text>
              </g>
            );
          };
          const side = n > 1 && si === 0 ? -1 : 1,
            dx = cx + side * (bw / 2 + 4);
          const dens =
            showDensity && dw > 6
              ? density(
                  se.points.map((q) => f(q.v)),
                  lo,
                  top,
                )
              : []; // computed on the plotted scale
          const dpath = dens
            .map(([v, d], i) => `${i ? 'L' : 'M'}${(dx + side * d * dw).toFixed(1)},${Yf(v).toFixed(1)}`)
            .join('');
          const label = `${g.label}${se.label ? ` · ${se.label}` : ''}: median ${s.median.toFixed(digits)} ${unit}, IQR ${s.q1.toFixed(digits)}–${s.q3.toFixed(digits)}, n = ${s.n}`;
          return (
            <g key={`${gi}-${si}`}>
              {dpath && (
                <path
                  d={dpath}
                  fill="none"
                  stroke={se.light ? lighter(dark, 0.25) : dark}
                  strokeWidth={1.6}
                  strokeLinejoin="round"
                />
              )}
              <g
                onPointerEnter={(e) => tip(e, label)}
                onPointerMove={(e) => tip(e, label)}
                onPointerLeave={() => onTip(null)}
              >
                <line x1={cx} x2={cx} y1={Y(s.hi)} y2={Y(s.q3)} stroke={edge} strokeWidth={1.4} />
                <line x1={cx} x2={cx} y1={Y(s.q1)} y2={Y(s.lo)} stroke={edge} strokeWidth={1.4} />
                <line x1={cx - bw / 4} x2={cx + bw / 4} y1={Y(s.hi)} y2={Y(s.hi)} stroke={edge} strokeWidth={1.4} />
                <line x1={cx - bw / 4} x2={cx + bw / 4} y1={Y(s.lo)} y2={Y(s.lo)} stroke={edge} strokeWidth={1.4} />
                <rect
                  x={cx - bw / 2}
                  y={Y(s.q3)}
                  width={bw}
                  height={Math.max(1, Y(s.q1) - Y(s.q3))}
                  fill={fill}
                  fillOpacity={0.85}
                  stroke={edge}
                  strokeWidth={1.4}
                />
                <line
                  x1={cx - bw / 2}
                  x2={cx + bw / 2}
                  y1={Y(s.median)}
                  y2={Y(s.median)}
                  stroke={dark}
                  strokeWidth={2.2}
                />
              </g>
              {arrow(above, true)}
              {arrow(below, false)}
              {se.points.map((q, k) => {
                if (beyond(q.v)) return null;
                const px = cx + jit(k + gi * 31 + si * 7, bw * 0.7),
                  py = Y(q.v),
                  t = `${q.v.toFixed(digits)} ${unit} · ${q.tip}`;
                const ev = {
                  onPointerEnter: (e: React.PointerEvent) => tip(e, t),
                  onPointerMove: (e: React.PointerEvent) => tip(e, t),
                  onPointerLeave: () => onTip(null),
                };
                return out(q.v) ? (
                  <path key={k} d={`M${px.toFixed(1)},${(py - 5).toFixed(1)}l4.6,8h-9.2z`} fill={dark} {...ev} />
                ) : (
                  <circle
                    key={k}
                    cx={px}
                    cy={py}
                    r={q.best ? 4.8 : 3.6}
                    fill={dark}
                    stroke={q.best ? '#d4a017' : 'none'}
                    strokeWidth={q.best ? 1.8 : 0}
                    {...ev}
                  />
                );
              })}
              {n > 1 && (
                <text x={cx} y={oy + ph + 16} textAnchor="middle" fontSize={10} fill="#555">
                  {se.light ? 'fwd' : 'bwd'}
                </text>
              )}
            </g>
          );
        }),
      )}
      {mark}
      <rect x={ox} y={oy} width={pw} height={ph} fill="none" stroke={INK} strokeWidth={1.2} />
      {ticks.map((t) => (
        <g key={t}>
          <line x1={ox - 5} x2={ox} y1={Yf(t)} y2={Yf(t)} stroke={INK} strokeWidth={1.2} />
          <text x={ox - 8} y={Yf(t)} textAnchor="end" dominantBaseline="central" fontSize={13} fill={INK}>
            {log ? (
              <>
                10
                <tspan fontSize={9} dy={-6}>
                  {t}
                </tspan>
              </>
            ) : (
              t.toFixed(dig)
            )}
          </text>
        </g>
      ))}
      {p.groups.map((g, gi) => (
        <g key={gi}>
          <line
            x1={ox + gw * (gi + 0.5)}
            x2={ox + gw * (gi + 0.5)}
            y1={oy + ph}
            y2={oy + ph + 5}
            stroke={INK}
            strokeWidth={1.2}
          />
          <text x={ox + gw * (gi + 0.5)} y={oy + ph + (nS > 1 ? 33 : 19)} textAnchor="middle" fontSize={13} fill={INK}>
            {(() => {
              const m = Math.max(6, Math.floor((gw - 8) / 7.2));
              return g.label.length > m ? g.label.slice(0, m - 1) + '…' : g.label;
            })()}
            <title>{g.label}</title>
          </text>
        </g>
      ))}
    </g>
  );
}

/** One metric as its own figure (for the screen and for export), with the group logo when chosen. */
export const PW = 560,
  PH = 360;
export function BoxPanel({
  panel,
  svgRef,
  showDensity = false,
  logo,
  log = false,
  outliers = true,
}: {
  panel: Panel & { unit: string; digits: number };
  svgRef?: React.Ref<SVGSVGElement>;
  showDensity?: boolean;
  logo?: { watermark?: string; group?: string };
  log?: boolean;
  /** false: axis fitted to the boxes; points beyond it shown as edge arrows with their count */
  outliers?: boolean;
}) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  return (
    <>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${PW} ${PH}`}
        width="100%"
        className="box-figure"
        xmlns="http://www.w3.org/2000/svg"
        fontFamily={FONT}
        role="img"
        aria-label={`Box plot of ${panel.key}`}
      >
        <rect width={PW} height={PH} fill="#fff" />
        <PanelSvg
          p={panel}
          unit={panel.unit}
          digits={panel.digits}
          showDensity={showDensity}
          onTip={setTip}
          x={0}
          y={0}
          w={PW}
          h={PH}
          log={log}
          logo={logo}
          outliers={outliers}
        />
      </svg>
      {tip && (
        <div className="c-tip fixed" style={{ left: Math.min(tip.x + 12, window.innerWidth - 260), top: tip.y + 12 }}>
          {tip.text}
        </div>
      )}
    </>
  );
}

export function BoxFigure({
  panels,
  svgRef,
  showDensity = false,
  logo,
  outliers = true,
}: {
  panels: (Panel & { unit: string; digits: number })[];
  svgRef?: React.Ref<SVGSVGElement>;
  showDensity?: boolean;
  logo?: { watermark?: string; group?: string };
  outliers?: boolean;
}) {
  const w = BFW / 2,
    h = BFH / 2,
    [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  return (
    <>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${BFW} ${BFH}`}
        width="100%"
        className="box-figure"
        xmlns="http://www.w3.org/2000/svg"
        fontFamily={FONT}
        role="img"
        aria-label="Box plots of Jsc, FF, Voc and PCE"
      >
        <rect width={BFW} height={BFH} fill="#fff" />
        {panels.slice(0, 4).map((p, i) => (
          <PanelSvg
            key={p.key}
            p={p}
            unit={p.unit}
            digits={p.digits}
            showDensity={showDensity}
            onTip={setTip}
            x={(i % 2) * w}
            y={Math.floor(i / 2) * h}
            w={w}
            h={h}
            logo={logo}
            outliers={outliers}
          />
        ))}
      </svg>
      {tip && (
        <div className="c-tip fixed" style={{ left: Math.min(tip.x + 12, window.innerWidth - 260), top: tip.y + 12 }}>
          {tip.text}
        </div>
      )}
    </>
  );
}

/** Axis titles in the usual notation: italic symbol with subscript, unit with superscript. */
export const TITLES: Record<string, React.ReactNode> = {
  jsc: (
    <>
      <tspan fontStyle="italic">J</tspan>
      <tspan fontSize={12} dy={4}>
        SC
      </tspan>
      <tspan dy={-4}> (mA cm</tspan>
      <tspan fontSize={12} dy={-6}>
        −2
      </tspan>
      <tspan dy={6}>)</tspan>
    </>
  ),
  ff: <>FF (%)</>,
  voc: (
    <>
      <tspan fontStyle="italic">V</tspan>
      <tspan fontSize={12} dy={4}>
        OC
      </tspan>
      <tspan dy={-4}> (V)</tspan>
    </>
  ),
  pce: <>PCE (%)</>,
  rs: (
    <>
      <tspan fontStyle="italic">R</tspan>
      <tspan fontSize={12} dy={4}>
        S
      </tspan>
      <tspan dy={-4}> (Ω cm</tspan>
      <tspan fontSize={12} dy={-6}>
        2
      </tspan>
      <tspan dy={6}>)</tspan>
    </>
  ),
  rsh: (
    <>
      <tspan fontStyle="italic">R</tspan>
      <tspan fontSize={12} dy={4}>
        SH
      </tspan>
      <tspan dy={-4}> (Ω cm</tspan>
      <tspan fontSize={12} dy={-6}>
        2
      </tspan>
      <tspan dy={6}>)</tspan>
    </>
  ),
};

/**
 * All shown plots as one figure: the panels side by side (2 or 3 per row), each with its own logo as on screen.
 * Built from the panels already drawn, so it matches what is on the page.
 */
export function combinePanels(svgs: SVGSVGElement[]): SVGSVGElement {
  const n = svgs.length,
    cols = n <= 3 ? n : n === 4 ? 2 : 3,
    rows = Math.ceil(n / cols),
    NS = 'http://www.w3.org/2000/svg';
  const out = document.createElementNS(NS, 'svg');
  out.setAttribute('viewBox', `0 0 ${cols * PW} ${rows * PH}`);
  out.setAttribute('width', String(cols * PW));
  out.setAttribute('height', String(rows * PH));
  out.setAttribute('xmlns', NS);
  out.setAttribute('font-family', FONT);
  const bg = document.createElementNS(NS, 'rect');
  bg.setAttribute('width', String(cols * PW));
  bg.setAttribute('height', String(rows * PH));
  bg.setAttribute('fill', '#fff');
  out.appendChild(bg);
  svgs.forEach((s, i) => {
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('transform', `translate(${(i % cols) * PW} ${Math.floor(i / cols) * PH})`);
    for (const c of Array.from(s.childNodes)) g.appendChild(c.cloneNode(true));
    out.appendChild(g);
  });
  return out;
}
