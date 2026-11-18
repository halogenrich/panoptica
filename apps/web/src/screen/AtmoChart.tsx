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

// O₂ solid with round marks, H₂O dashed with square marks, as forward and backward on a J–V figure (0.60.2): the two stay
// apart when they read the same
const SERIES = [
  { key: 'o2', label: 'O₂', color: 'var(--series-1)', dash: false },
  { key: 'h2o', label: 'H₂O', color: 'var(--series-7)', dash: true },
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
    inWin = g.readings.filter((r) => new Date(r.at).getTime() >= t0),
    before = g.readings.filter((r) => new Date(r.at).getTime() < t0).at(-1),
    // one continuous line through every reading by its time (0.60.2, Richard): the window only cuts it, so the line comes in
    // from the last reading before it; dots only for the readings inside
    rs = before ? [before, ...inWin] : inWin;
  // the top: the next of 0.1, 0.2, 0.5, 1, 2, 5… above the highest reading shown
  // with room above the readings for the legend (0.60.2): 0.1 ppm still gives 0–0.2, 0.5 gives 0–1
  const top = niceTop(Math.max(...rs.flatMap((r) => [r.o2, r.h2o]), 0.05) * 1.5);
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
        {/* the latest values on one line under the name, the same place on every chart (0.60.2) */}
        <span className="ls-atmo-now">
          {last ? (
            <>
              <span>Latest</span>
              {SERIES.map((s) => {
                const v = last[s.key],
                  lim = g.limits[s.key],
                  over = lim !== null && v > lim;
                return (
                  <span key={s.key} className={over ? 'over' : ''}>
                    {s.label} <b>{num(v)}</b> ppm
                    {over ? (
                      ', above the limit'
                    ) : lim !== null ? (
                      <span className="ls-lim">, limit {num(lim)}</span>
                    ) : null}
                  </span>
                );
              })}
            </>
          ) : null}
        </span>
      </figcaption>
      {!inWin.length ? (
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
                          strokeDasharray={`${2 * u} ${5 * u}`}
                          strokeLinecap="round"
                        />
                      )}
                      <path
                        d={d}
                        fill="none"
                        stroke={s.color}
                        strokeWidth={4 * u}
                        strokeLinejoin="round"
                        strokeDasharray={s.dash ? `${12 * u} ${7 * u}` : undefined}
                      />
                      {/* the same line, red where it is above the limit */}
                      {drawn(lim) && (
                        <path
                          d={d}
                          fill="none"
                          stroke="var(--err)"
                          strokeWidth={4 * u}
                          strokeLinejoin="round"
                          strokeDasharray={s.dash ? `${12 * u} ${7 * u}` : undefined}
                          clipPath={`url(#over${s.key}${clip})`}
                        />
                      )}
                      {inWin.length <= 14 &&
                        inWin.map((r) => {
                          const fill = lim !== null && r[s.key] > lim ? 'var(--err)' : s.color,
                            cx = X(new Date(r.at).getTime()),
                            cy = Y(r[s.key]);
                          return s.dash ? (
                            <rect key={r.at} x={cx - 5 * u} y={cy - 5 * u} width={10 * u} height={10 * u} fill={fill} />
                          ) : (
                            <circle key={r.at} cx={cx} cy={cy} r={6 * u} fill={fill} />
                          );
                        })}
                    </g>
                  );
                })}
              </g>
              <rect className="ls-ax-frame" x={L} y={T} width={PW} height={PH} />
              {/* the legend inside the frame, top right, as on the J–V figures (0.60.2, Richard) */}
              {(() => {
                const rows = [
                    ...SERIES.map((x) => ({
                      label: x.label,
                      color: x.color,
                      dash: x.dash ? `${12 * u} ${7 * u}` : '',
                    })),
                    ...(SERIES.some((x) => drawn(g.limits[x.key]))
                      ? [{ label: 'Limit', color: 'var(--mut)', dash: `${2 * u} ${5 * u}` }]
                      : []),
                  ],
                  lh = fs * 1.35,
                  lw = 34 * u,
                  bw = lw + 12 * u + fs * 3.4,
                  bx = L + PW - bw - 10 * u,
                  by = T + 8 * u;
                return (
                  <g className="ls-legend">
                    <rect
                      x={bx - 8 * u}
                      y={by - 4 * u}
                      width={bw + 16 * u}
                      height={rows.length * lh + 8 * u}
                      rx={4 * u}
                    />
                    {rows.map((r, i) => (
                      <g key={r.label} transform={`translate(${bx} ${by + i * lh + lh / 2})`}>
                        <line
                          x1={0}
                          x2={lw}
                          stroke={r.color}
                          strokeWidth={r.label === 'Limit' ? 2 * u : 4 * u}
                          strokeDasharray={r.dash || undefined}
                          strokeLinecap={r.label === 'Limit' ? 'round' : undefined}
                        />
                        <text x={lw + 10 * u} dy="0.35em" className="ls-ax-t ls-legend-t">
                          {r.label}
                        </text>
                      </g>
                    ))}
                  </g>
                );
              })()}
            </svg>
          )}
        </div>
      )}
    </figure>
  );
}
