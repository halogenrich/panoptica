import { useLayoutEffect, useRef, useState } from 'react';
import { pct, plural } from '@web/views/overview/parts';

/**
 * Best and median device efficiency per period (or per measurement): one axis, two lines labelled at their ends, a crosshair
 * with the values on hover, and a table view for exact numbers.
 */
export default function LineChart({
  points,
  xLabel,
  unitTick,
  h = 260,
  empty,
}: {
  points: { x: string; best: number | null; median: number | null; n: number; title?: string }[];
  xLabel: string;
  unitTick: (x: string) => string;
  h?: number;
  empty: string;
}) {
  const box = useRef<HTMLDivElement>(null),
    [w, setW] = useState(640),
    [hover, setHover] = useState<number | null>(null),
    [table, setTable] = useState(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const has = points.some((p) => p.best != null);
  if (!has) return <p className="mut chart-empty">{empty}</p>;
  const L = 44,
    R = 64,
    T = 14,
    B = 34,
    PW = Math.max(120, w - L - R),
    PH = h - T - B;
  const vals = points.flatMap((p) => [p.best, p.median]).filter((v): v is number => v != null);
  const lo = Math.max(0, Math.floor((Math.min(...vals) - 2) / 5) * 5),
    hi = Math.ceil((Math.max(...vals) + 1) / 5) * 5;
  const X = (i: number) => L + (points.length === 1 ? PW / 2 : (i / (points.length - 1)) * PW),
    Y = (v: number) => T + PH - ((v - lo) / (hi - lo || 1)) * PH;
  // the end labels: when the two lines end close together (one device: best = median), spread them so they do not overlap
  const labelY = (k: 'best' | 'median') => {
    const lb = last('best'),
      lm = last('median'),
      y = Y(points[last(k)][k]!);
    if (lb < 0 || lm < 0 || lb !== lm) return y;
    const gap = Y(points[lm].median!) - Y(points[lb].best!);
    return gap >= 14 ? y : k === 'best' ? y - (14 - gap) / 2 : y + (14 - gap) / 2;
  };
  const yt = Array.from({ length: Math.round((hi - lo) / 5) + 1 }, (_, i) => lo + i * 5).filter(
    (_, i, a) => a.length <= 7 || i % 2 === 0,
  );
  const line = (k: 'best' | 'median') => {
    let d = '',
      pen = false;
    points.forEach((p, i) => {
      const v = p[k];
      if (v == null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const last = (k: 'best' | 'median') => {
    for (let i = points.length - 1; i >= 0; i--) if (points[i][k] != null) return i;
    return -1;
  };
  const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(PW / 70))));
  return (
    <div className="chart" ref={box}>
      <div className="inline chart-tools">
        <span className="ov-key">
          <i className="k-best" />
          Best device
        </span>
        <span className="ov-key">
          <i className="k-median" />
          Typical device
        </span>
        <div className="grow" />
        <button className="link small" onClick={() => setTable(!table)}>
          {table ? 'Show chart' : 'Show numbers'}
        </button>
      </div>
      {table ? (
        <table className="pp-table">
          <thead>
            <tr>
              <th>{xLabel}</th>
              <th>Best device</th>
              <th>Typical device (median)</th>
              <th>Cells</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.x}>
                <td>{p.title ?? unitTick(p.x)}</td>
                <td>{pct(p.best, 2)}</td>
                <td>{pct(p.median, 2)}</td>
                <td>{p.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <svg
          width={w}
          height={h}
          className="viz"
          role="img"
          aria-label={`Best and median device PCE by ${xLabel.toLowerCase()}`}
          onPointerMove={(ev) => {
            const r = (ev.currentTarget as SVGSVGElement).getBoundingClientRect(),
              x = ev.clientX - r.left;
            let bi = 0,
              bd = Infinity;
            points.forEach((_, i) => {
              const dd = Math.abs(X(i) - x);
              if (dd < bd) {
                bd = dd;
                bi = i;
              }
            });
            setHover(bd < 40 ? bi : null);
          }}
          onPointerLeave={() => setHover(null)}
        >
          {yt.map((v) => (
            <g key={v}>
              <line x1={L} x2={L + PW} y1={Y(v)} y2={Y(v)} className="viz-grid" />
              <text x={L - 8} y={Y(v)} className="viz-tick" textAnchor="end" dominantBaseline="central">
                {v}
              </text>
            </g>
          ))}
          <text x={8} y={T - 2} className="viz-tick" dominantBaseline="hanging">
            %
          </text>
          {points.map((p, i) =>
            i % every === 0 || i === points.length - 1 ? (
              <text key={p.x} x={X(i)} y={T + PH + 20} className="viz-tick" textAnchor="middle">
                {unitTick(p.x)}
              </text>
            ) : null,
          )}
          {hover !== null && <line x1={X(hover)} x2={X(hover)} y1={T} y2={T + PH} className="viz-cross" />}
          {(['median', 'best'] as const).map((k) => (
            <g key={k} className={'viz-s viz-' + k}>
              <path d={line(k)} fill="none" />
              {points.map((p, i) => p[k] != null && <circle key={i} cx={X(i)} cy={Y(p[k]!)} r={hover === i ? 5 : 4} />)}
              {last(k) >= 0 && (
                <text x={X(last(k)) + 10} y={labelY(k)} dominantBaseline="central" className="viz-label">
                  {k === 'best' ? 'Best' : 'Typical'}
                </text>
              )}
            </g>
          ))}
        </svg>
      )}
      {!table &&
        hover !== null &&
        (() => {
          const p = points[hover],
            left = Math.min(Math.max(X(hover) + 12, 0), w - 190);
          return (
            <div className="viz-tip" style={{ left, top: 8 }}>
              <b>{p.title ?? unitTick(p.x)}</b>
              <span>
                <i className="k-best" />
                Best {pct(p.best, 2)}
              </span>
              <span>
                <i className="k-median" />
                Typical (median) {pct(p.median, 2)}
              </span>
              <span className="mut">{plural(p.n, 'cell')}</span>
            </div>
          );
        })()}
    </div>
  );
}
