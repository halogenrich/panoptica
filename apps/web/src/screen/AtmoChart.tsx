import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { startOfDay, weekday } from '../phone/parts';

/**
 * One glovebox's O₂ and H₂O on the lab screen (0.59): the readings people type when they answer a booking on it (0.38), as two
 * lines in a closed frame; each limit an admin set as a dashed line in its series' colour, and any part of a line above its limit
 * drawn red. The latest values in large figures above, with "above the limit" in words (not colour alone). 0.60.1 (Richard): today
 * or the last 7 days, and the axis fitted to the readings (0.1 ppm → 0–0.2, 0.5 → 0–1), not to the limits: a limit above the top
 * is written beside the latest value instead of drawn.
 */
export type Glovebox = {
  id: number;
  name: string;
  color: string;
  limits: { o2: number | null; h2o: number | null };
  readings: { at: string; o2: number; h2o: number }[];
};

/** The chart is drawn at the size it gets on the TV (text stays the same size whatever the box), in units of --u. */
function useBox() {
  const ref = useRef<HTMLDivElement>(null),
    [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, box] as const;
}

/** A round top for the axis: 1, 2, 5 × a power of ten. */
function niceTop(v: number) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v)),
    m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}
const num = (v: number) =>
  (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)).replace(/\.?0+$/, '') || '0';

const SERIES = [
  { key: 'o2', label: 'O₂', color: 'var(--series-1)' },
  { key: 'h2o', label: 'H₂O', color: 'var(--series-7)' },
] as const;

export function AtmoChart({ g, now, span = 'week' }: { g: Glovebox; now: Date; span?: 'day' | 'week' }) {
  const clip = useId().replace(/:/g, ''),
    [ref, box] = useBox(),
    u = Math.min(window.innerWidth / 1920, window.innerHeight / 1080),
    fs = Math.round(17 * u),
    W = Math.max(box.w, 100),
    H = Math.max(box.h, 60),
    L = Math.round(48 * u),
    R = Math.round(8 * u),
    T = Math.round(10 * u),
    B = Math.round(34 * u),
    PW = W - L - R,
    PH = H - T - B;
  const t1 = now.getTime(),
    t0 = span === 'day' ? startOfDay(now).getTime() : t1 - 7 * 864e5,
    X = (t: number) => L + ((t - t0) / (t1 - t0)) * PW,
    rs = g.readings.filter((r) => new Date(r.at).getTime() >= t0);
  // the top: the next of 0.1, 0.2, 0.5, 1, 2, 5… above the highest reading shown
  const top = niceTop(Math.max(...rs.flatMap((r) => [r.o2, r.h2o]), 0.05) * 1.1);
  const Y = (v: number) => T + PH - (Math.min(v, top) / top) * PH;
  const yt = [0, top / 2, top];
  // the week: midnights labelled with their weekday; today: every 3 hours
  const days: number[] = [];
  if (span === 'week') for (let d = startOfDay(new Date(t0 + 864e5)).getTime(); d < t1; d += 864e5) days.push(d);
  else for (let d = t0 + 3 * 36e5; d < t1; d += 3 * 36e5) days.push(d);
  // no label so close to the right edge that it would be cut
  const marks = days.filter((t) => X(t) < L + PW - 40 * u);
  const drawn = (lim: number | null): lim is number => lim !== null && lim <= top;
  const last = g.readings.at(-1);
  const label = (t: number) =>
    span === 'week' ? weekday(new Date(t)) : String(new Date(t).getHours()).padStart(2, '0');
  return (
    <figure className="ls-atmo-one">
      <figcaption>
        <span className="ls-eq-name" style={{ '--c': g.color } as CSSProperties}>
          {g.name}
        </span>
        {last ? (
          <span className="ls-atmo-now">
            <span>Latest</span>
            {SERIES.map((s) => {
              const v = last[s.key],
                lim = g.limits[s.key],
                over = lim !== null && v > lim;
              return (
                <span key={s.key} className={over ? 'over' : ''}>
                  <i style={{ background: s.color }} aria-hidden="true" />
                  {s.label} <b>{num(v)}</b> ppm{over ? ', above the limit' : ''}
                  {lim !== null && !over && !drawn(lim) && <span className="ls-lim"> · limit {num(lim)}</span>}
                </span>
              );
            })}
          </span>
        ) : null}
      </figcaption>
      {!rs.length ? (
        <p className="ls-empty">{span === 'day' ? 'No readings today.' : 'No readings in the last 7 days.'}</p>
      ) : (
        <div className="ls-atmo-box" ref={ref}>
          {box.w > 0 && (
            <svg
              width={W}
              height={H}
              viewBox={`0 0 ${W} ${H}`}
              style={{ fontSize: fs }}
              role="img"
              aria-label={`${g.name}: O₂ and H₂O in ppm, ${span === 'day' ? 'today' : 'last 7 days'}`}
            >
              <defs>
                <clipPath id={`in${clip}`}>
                  <rect x={L} y={T} width={PW} height={PH} />
                </clipPath>
                {SERIES.map((s) => {
                  const lim = g.limits[s.key];
                  return !drawn(lim) ? null : (
                    <clipPath key={s.key} id={`over${s.key}${clip}`}>
                      <rect x={L} y={T - 2} width={PW} height={Math.max(0, Y(lim) - T + 2)} />
                    </clipPath>
                  );
                })}
              </defs>
              {yt.map((v) => (
                <g key={v}>
                  <line className="ls-ax-grid" x1={L} x2={L + PW} y1={Y(v)} y2={Y(v)} />
                  <text className="ls-ax-t" x={L - 8 * u} y={Y(v)} dy="0.35em" textAnchor="end">
                    {num(v)}
                  </text>
                </g>
              ))}
              {marks.map((t) => (
                <g key={t}>
                  <line className="ls-ax-grid" x1={X(t)} x2={X(t)} y1={T} y2={T + PH} />
                  <text className="ls-ax-t" x={X(t) + 6 * u} y={H - 8 * u}>
                    {label(t)}
                  </text>
                </g>
              ))}
              <g clipPath={`url(#in${clip})`}>
                {SERIES.map((s) => {
                  const lim = g.limits[s.key],
                    d = rs
                      .map(
                        (r, i) => `${i ? 'L' : 'M'}${X(new Date(r.at).getTime()).toFixed(1)},${Y(r[s.key]).toFixed(1)}`,
                      )
                      .join('');
                  return (
                    <g key={s.key}>
                      {drawn(lim) && (
                        <line
                          x1={L}
                          x2={L + PW}
                          y1={Y(lim)}
                          y2={Y(lim)}
                          stroke={s.color}
                          strokeWidth={2 * u}
                          strokeDasharray={`${8 * u} ${6 * u}`}
                        />
                      )}
                      <path d={d} fill="none" stroke={s.color} strokeWidth={4 * u} strokeLinejoin="round" />
                      {/* the same line, red where it is above the limit */}
                      {drawn(lim) && (
                        <path
                          d={d}
                          fill="none"
                          stroke="var(--err)"
                          strokeWidth={4 * u}
                          strokeLinejoin="round"
                          clipPath={`url(#over${s.key}${clip})`}
                        />
                      )}
                      {rs.length <= 14 &&
                        rs.map((r) => (
                          <circle
                            key={r.at}
                            cx={X(new Date(r.at).getTime())}
                            cy={Y(r[s.key])}
                            r={5 * u}
                            fill={lim !== null && r[s.key] > lim ? 'var(--err)' : s.color}
                          />
                        ))}
                    </g>
                  );
                })}
              </g>
              <rect className="ls-ax-frame" x={L} y={T} width={PW} height={PH} />
            </svg>
          )}
        </div>
      )}
    </figure>
  );
}
