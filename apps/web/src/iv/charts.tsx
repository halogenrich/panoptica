import { useEffect, useRef, useState, type ReactNode } from 'react';
import { interp, type BoxStats } from '@psc/core';

/** Width of a container, so charts are drawn at their real size (text stays 11–12 px on a phone). */
function useWidth(min = 260) {
  const ref = useRef<HTMLDivElement>(null),
    [w, setW] = useState(min);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(min, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}
const nice = (v: number) => {
  const p = 10 ** Math.floor(Math.log10(Math.abs(v) || 1)),
    m = Math.abs(v) / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
};
const ticks = (lo: number, hi: number, n: number) => {
  const s = nice((hi - lo) / n),
    out: number[] = [];
  for (let t = Math.ceil(lo / s) * s; t <= hi + s * 1e-9; t += s) out.push(+t.toFixed(10));
  return out;
};

export interface JvSeries {
  label: string;
  V: number[];
  J: number[];
  color: string;
  dash?: boolean;
  mpp?: { v: number; j: number };
}

/** J–V curves in the power quadrant (and a little around it), with a crosshair readout. */
export function JvPlot({ series, height = 300 }: { series: JvSeries[]; height?: number }) {
  const [ref, W] = useWidth(),
    [hx, setHx] = useState<number | null>(null);
  const all = series.flatMap((s) => s.J.filter(Number.isFinite)),
    jmax = Math.max(5, ...all.map((j) => j));
  const vs = series.flatMap((s) => s.V),
    v0 = Math.min(0, ...vs),
    v1 = Math.max(0.1, ...vs);
  const y0 = -0.25 * jmax,
    y1 = jmax * 1.12,
    L = 46,
    R = 12,
    T = 12,
    B = 34,
    w = W - L - R,
    h = height - T - B;
  const X = (v: number) => L + ((v - v0) / (v1 - v0)) * w,
    Y = (j: number) => T + h - ((Math.max(y0 - 50, Math.min(y1 + 50, j)) - y0) / (y1 - y0)) * h;
  const path = (s: JvSeries) =>
    s.V.map((v, i) => [v, s.J[i]] as const)
      .filter(([v, j]) => Number.isFinite(v) && Number.isFinite(j))
      .map(([v, j], i) => `${i ? 'L' : 'M'}${X(v).toFixed(1)},${Y(j).toFixed(1)}`)
      .join('');
  const hv = hx === null ? null : v0 + ((hx - L) / w) * (v1 - v0);
  const clip = useRef(`jv${Math.random().toString(36).slice(2)}`).current;
  return (
    <div ref={ref} className="chart">
      <svg
        width={W}
        height={height}
        role="img"
        aria-label={`J–V curves: ${series.map((s) => s.label).join(', ')}`}
        onPointerMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(),
            x = e.clientX - r.left;
          setHx(x >= L && x <= L + w ? x : null);
        }}
        onPointerLeave={() => setHx(null)}
      >
        <defs>
          <clipPath id={clip}>
            <rect x={L} y={T} width={w} height={h} />
          </clipPath>
        </defs>
        {ticks(y0, y1, 5).map((t) => (
          <g key={'y' + t}>
            <line x1={L} x2={L + w} y1={Y(t)} y2={Y(t)} className={t === 0 ? 'c-base' : 'c-grid'} />
            <text x={L - 6} y={Y(t)} className="c-tick" textAnchor="end" dominantBaseline="middle">
              {t}
            </text>
          </g>
        ))}
        {ticks(v0, v1, W < 420 ? 4 : 6).map((t) => (
          <g key={'x' + t}>
            <line x1={X(t)} x2={X(t)} y1={T} y2={T + h} className={t === 0 ? 'c-base' : 'c-grid'} />
            <text x={X(t)} y={T + h + 15} className="c-tick" textAnchor="middle">
              {t}
            </text>
          </g>
        ))}
        <text x={L + w / 2} y={height - 3} className="c-axis" textAnchor="middle">
          Voltage (V)
        </text>
        <text transform={`translate(11 ${T + h / 2}) rotate(-90)`} className="c-axis" textAnchor="middle">
          J (mA/cm²)
        </text>
        <g clipPath={`url(#${clip})`}>
          {series.map((s, i) => (
            <path
              key={i}
              d={path(s)}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dash ? '6 4' : undefined}
              strokeLinejoin="round"
            />
          ))}
          {series.map(
            (s, i) =>
              s.mpp &&
              Number.isFinite(s.mpp.v) && (
                <circle key={'m' + i} cx={X(s.mpp.v)} cy={Y(s.mpp.j)} r={4.5} fill={s.color} className="c-ring" />
              ),
          )}
        </g>
        {hv !== null && hx !== null && <line x1={hx} x2={hx} y1={T} y2={T + h} className="c-cross" />}
      </svg>
      {hv !== null && hx !== null && (
        <div className="c-tip" style={{ left: hx > W / 2 ? Math.max(0, hx - 200) : hx + 12, top: T + h * 0.5 }}>
          <b>{hv.toFixed(3)} V</b>
          {series.map((s, i) => (
            <span key={i}>
              <i style={{ background: s.color }} className={s.dash ? 'dash' : ''} />
              {s.label} {interp(s.V, s.J, hv).toFixed(2)} mA/cm²
            </span>
          ))}
        </div>
      )}
      {series.length > 1 && (
        <div className="legend c-legend">
          {series.map((s, i) => (
            <span key={i}>
              <i style={{ background: s.color }} className={'line' + (s.dash ? ' dash' : '')} />
              {s.label}
            </span>
          ))}
          <span>
            <i className="dot" />
            maximum power point
          </span>
        </div>
      )}
    </div>
  );
}

export interface BoxSeries {
  label: string;
  color: string;
  light?: boolean;
  stats: BoxStats | null;
  points: { v: number; tip: string; best?: boolean }[];
}
export interface BoxGroup {
  label: string;
  series: BoxSeries[];
}

/** Gaussian kernel density (Silverman bandwidth) on a grid, normalised to a peak of 1. */
function density(vals: number[], lo: number, hi: number, n = 48): [number, number][] {
  const v = vals.filter(Number.isFinite);
  if (v.length < 2) return [];
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
const tint = (c: string, light?: boolean, k = 45) => (light ? `color-mix(in srgb, ${c} ${k}%, #fff)` : c);

/**
 * One metric across groups: per series a Tukey box with the measured pixels as dots centred on it, and optionally their
 * density curve. Two series of a group (backward = full colour, forward = lighter shade) are drawn as one joined box pair,
 * their density curves on the outer sides.
 */
export function BoxPlot({
  title,
  unit,
  groups,
  digits = 2,
  height = 250,
  showDensity = false,
}: {
  title: string;
  unit: string;
  groups: BoxGroup[];
  digits?: number;
  height?: number;
  showDensity?: boolean;
}) {
  const [ref, W] = useWidth(240),
    [tip, setTip] = useState<{ x: number; y: number; text: ReactNode } | null>(null);
  const vals = groups.flatMap((g) => g.series.flatMap((s) => s.points.map((p) => p.v))).filter(Number.isFinite);
  if (!vals.length)
    return (
      <div className="chart box-chart">
        <h4>{title}</h4>
        <p className="mut small">No working pixels in the selection.</p>
      </div>
    );
  let lo = Math.min(...vals),
    hi = Math.max(...vals);
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.12;
  lo -= pad;
  hi += pad;
  const nS = Math.max(1, ...groups.map((g) => g.series.length)),
    L = 44,
    R = 8,
    T = 10,
    w = W - L - R;
  const gw = w / groups.length;
  const bw = Math.min(nS > 1 ? 30 : 36, (gw * (showDensity ? 0.5 : 0.7)) / nS),
    dw = Math.min(30, (gw - nS * bw) / 2 - 4);
  const labels = nS > 1 && bw >= 44,
    B = labels ? 58 : 44,
    h = height - T - B;
  const Y = (v: number) => T + h - ((v - lo) / (hi - lo)) * h;
  const jit = (k: number) => (((k * 2654435761) % 1000) / 1000 - 0.5) * bw * 0.62; // fixed jitter inside the box width: same picture every time
  const show = (e: React.PointerEvent, text: ReactNode) => {
    const r = ((e.currentTarget as SVGElement).ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, text });
  };
  return (
    <div ref={ref} className="chart box-chart">
      <h4>
        {title} <span className="mut">({unit})</span>
      </h4>
      <svg width={W} height={height} role="img" aria-label={`${title} by group`} onPointerLeave={() => setTip(null)}>
        {ticks(lo, hi, 4).map((t) => (
          <g key={t}>
            <line x1={L} x2={L + w} y1={Y(t)} y2={Y(t)} className="c-grid dashed" />
            <line x1={L} x2={L + 6} y1={Y(t)} y2={Y(t)} className="c-frame" />
            <line x1={L + w - 6} x2={L + w} y1={Y(t)} y2={Y(t)} className="c-frame" />
            <text x={L - 6} y={Y(t)} className="c-tick" textAnchor="end" dominantBaseline="middle">
              {+t.toFixed(digits)}
            </text>
          </g>
        ))}
        <rect x={L} y={T} width={w} height={h} fill="none" className="c-frame" />
        {groups.map((g, gi) => (
          <g key={gi}>
            {g.series.map((se, si) => {
              const n = g.series.length,
                cx = L + gi * gw + gw / 2,
                bx = cx + (si - (n - 1) / 2) * bw,
                s = se.stats;
              const fill = tint(se.color, se.light),
                edge = se.light ? tint(se.color, true, 80) : se.color;
              // density on the outer side: left of the first box when there are two, otherwise right
              const side = n > 1 && si === 0 ? -1 : 1,
                dx = bx + side * (bw / 2 + 3);
              const dens =
                showDensity && dw > 6
                  ? density(
                      se.points.map((p) => p.v),
                      lo,
                      hi,
                    )
                  : [];
              const dpath = dens.length
                ? dens
                    .map(([y, d], i) => `${i ? 'L' : 'M'}${(dx + side * d * dw).toFixed(1)},${Y(y).toFixed(1)}`)
                    .join('')
                : '';
              return (
                <g key={si}>
                  {dpath && (
                    <path
                      d={dpath}
                      style={{ fill: 'none', stroke: se.light ? tint(se.color, true, 70) : se.color }}
                      strokeWidth={1.6}
                      strokeLinejoin="round"
                    />
                  )}
                  {s && (
                    <g
                      onPointerEnter={(e) =>
                        show(
                          e,
                          <>
                            <b>
                              {g.label}
                              {se.label ? ` · ${se.label}` : ''}
                            </b>
                            <span>
                              median {s.median.toFixed(digits)} · IQR {s.q1.toFixed(digits)}–{s.q3.toFixed(digits)} · n
                              = {s.n}
                            </span>
                          </>,
                        )
                      }
                    >
                      <line x1={bx} x2={bx} y1={Y(s.hi)} y2={Y(s.q3)} className="c-whisk" />
                      <line x1={bx} x2={bx} y1={Y(s.q1)} y2={Y(s.lo)} className="c-whisk" />
                      <line x1={bx - bw / 4} x2={bx + bw / 4} y1={Y(s.hi)} y2={Y(s.hi)} className="c-whisk" />
                      <line x1={bx - bw / 4} x2={bx + bw / 4} y1={Y(s.lo)} y2={Y(s.lo)} className="c-whisk" />
                      <rect
                        x={bx - bw / 2}
                        y={Y(s.q3)}
                        width={bw}
                        height={Math.max(1, Y(s.q1) - Y(s.q3))}
                        style={{ fill, stroke: edge }}
                        fillOpacity={se.light ? 0.9 : 0.3}
                        strokeWidth={1.5}
                      />
                      <line
                        x1={bx - bw / 2}
                        x2={bx + bw / 2}
                        y1={Y(s.median)}
                        y2={Y(s.median)}
                        style={{ stroke: se.light ? tint(se.color, true, 85) : se.color }}
                        strokeWidth={2.5}
                      />
                    </g>
                  )}
                  {se.points.map((p, k) => (
                    <circle
                      key={k}
                      cx={bx + jit(k + gi * 31 + si * 7)}
                      cy={Y(p.v)}
                      r={p.best ? 5 : 3.2}
                      style={{ fill }}
                      className={p.best ? 'c-best' : 'c-ring'}
                      onPointerEnter={(e) =>
                        show(
                          e,
                          <>
                            <b>
                              {p.v.toFixed(digits)} {unit}
                            </b>
                            <span>{p.tip}</span>
                          </>,
                        )
                      }
                    />
                  ))}
                  {labels && (
                    <text x={bx} y={T + h + 14} className="c-tick" textAnchor="middle">
                      {se.label}
                    </text>
                  )}
                </g>
              );
            })}
            <text x={L + gi * gw + gw / 2} y={T + h + (labels ? 30 : 16)} className="c-label" textAnchor="middle">
              {g.label.length > 24 ? g.label.slice(0, 23) + '…' : g.label}
              <title>{g.label}</title>
            </text>
            <text x={L + gi * gw + gw / 2} y={T + h + (labels ? 45 : 31)} className="c-tick" textAnchor="middle">
              n = {g.series.map((s) => s.stats?.n ?? 0).join(' / ')}
            </text>
          </g>
        ))}
      </svg>
      {tip && (
        <div className="c-tip" style={{ left: Math.min(tip.x + 10, W - 210), top: Math.max(0, tip.y - 44) }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}
