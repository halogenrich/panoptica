import { useMemo, useRef, useState } from 'react';
import { curveDistorted, tFraction } from '@psc/devices';
import { Seg } from '@web/lib/ui';
import { useFigureSettings, useLogoChoice } from '@web/lib/figure';
import { Check } from '@web/views/common';
import { CMP } from './Compare';
import { exportSvg } from './JvFigure';
import { download, fmt, type Curve, type Dir, type IvSetFull } from './model';

type Metric = 'pce' | 'voc' | 'jsc' | 'ff' | 'rs' | 'rsh';
const NAME: Record<Metric, string> = { pce: 'PCE', voc: 'Voc', jsc: 'Jsc', ff: 'FF', rs: 'Rs', rsh: 'Rsh' },
  UNIT: Record<Metric, string> = { pce: '%', voc: 'V', jsc: 'mA/cm²', ff: '%', rs: 'Ω·cm²', rsh: 'Ω·cm²' },
  DIG: Record<Metric, number> = { pce: 2, voc: 3, jsc: 2, ff: 1, rs: 1, rsh: 0 };
// the J–V figure's size, margins, ink and grid (0.55.2: both lifetime figures in the same journal style, 7 × 5)
const FW = 700,
  FH = 500,
  L = 82,
  R = 22,
  T = 48,
  B = 66,
  PW = FW - L - R,
  PH = FH - T - B,
  INK = '#111',
  GRID = '#b8b8b8',
  FONT = 'Inter, "Segoe UI", Helvetica, Arial, sans-serif';
const pid = (p: string) => (/^\d/.test(p) ? 'P' + p : p);
const niceStep = (span: number, n = 6) => {
  const raw = span / n,
    p = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 5, 10].map((k) => k * p).find((s) => s >= raw) ?? raw;
};
/** Time unit for the run's length: minutes up to 3 h, hours up to 3 days, then days. */
const unitOf = (sec: number) =>
  sec <= 3 * 3600
    ? { k: 60, u: 'min', long: 'minutes' }
    : sec <= 72 * 3600
      ? { k: 3600, u: 'h', long: 'hours' }
      : { k: 86400, u: 'd', long: 'days' };
/** Light (first reading) to dark (last) in one hue: the J–V curves of one pixel over the run. */
const shade = (f: number) => {
  const a = [196, 220, 250],
    b = [11, 55, 140];
  return `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * f)).join(',')})`;
};

/** The pixels picked for the time plot, kept per run in this browser (0.55.2). */
const pickKey = (id: number) => `psc-life-px-${id}`;
function readPick(id: number): string[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(pickKey(id)) ?? 'null');
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * A lifetime run (Ossila lifetime test): the same pixels scanned again and again, held at maximum power in between. Every pixel's
 * parameter against time, normalised to its first reading, with T90 and T80; and one pixel's J–V curves from first to last.
 */
export default function Lifetime({ s }: { s: IvSetFull }) {
  const life = s.lifeRun;
  const [metric, setMetric] = useState<Metric>('pce'),
    [dir, setDir] = useState<Dir | 'both'>('rev'),
    [norm, setNorm] = useState(true),
    [err, setErr] = useState('');
  const fig = useRef<SVGSVGElement>(null),
    jvFig = useRef<SVGSVGElement>(null),
    fs = useFigureSettings(),
    hasLogo = !!fs.watermark,
    [logo, setLogo] = useLogoChoice();
  const devs = useMemo(() => [...new Set(s.curves.map((c) => `${c.sample}|${c.substrate}|${c.pixel}`))].sort(), [s]);
  // the pixels on the time plot (0.55.2): remembered per run; at first the one with the best first reading
  const best = useMemo(() => {
    let k = devs[0] ?? '',
      top = -Infinity;
    for (const c of s.curves) {
      if (c.kind === 'life' || c.m.status !== 'ok' || !(c.m.pce > top)) continue;
      top = c.m.pce;
      k = `${c.sample}|${c.substrate}|${c.pixel}`;
    }
    return k;
  }, [s]);
  const [pick, setPick0] = useState<string[]>(() => {
    const v = readPick(s.id)?.filter((k) => devs.includes(k));
    return v ?? (best ? [best] : []);
  });
  const setPick = (v: string[]) => {
    setPick0(v);
    try {
      localStorage.setItem(pickKey(s.id), JSON.stringify(v));
    } catch {
      /* private window: for this visit only */
    }
  };
  const several = new Set(devs.map((d) => d.split('|').slice(0, 2).join('|'))).size > 1;
  const label = (k: string) => {
    const [smp, sub, px] = k.split('|');
    return several ? `${s.links[smp]?.label ?? smp.replace(/_/g, ' ')}, substrate ${sub}, ${pid(px)}` : pid(px);
  };
  const span = Math.max(0, ...s.curves.map((c) => c.t ?? 0)),
    tu = unitOf(span);
  const model = useMemo(() => {
    const dirs: Dir[] = dir === 'both' ? ['rev', 'fwd'] : [dir];
    return devs.flatMap((k, i) =>
      dirs.map((d) => {
        // a pixel keeps its colour whichever others are picked
        const cs = s.curves
          .filter((c) => `${c.sample}|${c.substrate}|${c.pixel}` === k && c.dir === d)
          .sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
        const bad = (c: Curve) => curveDistorted(c.V, c.J);
        const v0 = cs[0] && cs[0].m.status === 'ok' && !bad(cs[0]) ? (cs[0].m[metric] as number) : NaN;
        const pts = cs
          .map((c) => ({ t: (c.t ?? 0) / tu.k, raw: c.m[metric] as number, c, bad: bad(c) }))
          .filter((p) => Number.isFinite(p.raw))
          .map((p) => ({ ...p, v: norm ? p.raw / v0 : p.raw }));
        // T90 and T80 from the readings that can be trusted
        const n = pts.filter((p) => !p.bad).map((p) => ({ t: p.t, v: p.raw / v0 }));
        const ok = Number.isFinite(v0) && v0 !== 0;
        return {
          key: `${k}|${d}`,
          dev: k,
          dir: d,
          color: CMP[i % CMP.length],
          label: label(k) + (dir === 'both' ? (d === 'rev' ? ' backward' : ' forward') : ''),
          v0,
          ok,
          pts: ok ? pts : [],
          // resistances do not fall with ageing the way the other parameters do: no T90/T80 for them
          t90: ok && metric !== 'rs' && metric !== 'rsh' ? tFraction(n, 0.9) : null,
          t80: ok && metric !== 'rs' && metric !== 'rsh' ? tFraction(n, 0.8) : null,
        };
      }),
    );
  }, [s, metric, dir, norm, devs.join()]);
  const picked = model.filter((l) => pick.includes(l.dev));
  const [px, setPx] = useState(best || devs[0] || ''),
    [pxDir, setPxDir] = useState<Dir>('rev');

  if (!life) return <p className="mut">This measurement has no lifetime data.</p>;
  const lines = picked.filter((l) => l.ok);
  const nBad = lines.reduce((n, l) => n + l.pts.filter((p) => p.bad).length, 0),
    nBulge = lines.reduce((n, l) => n + l.pts.filter((p) => !p.bad && p.c.m.ff > 100).length, 0);
  const log = !norm && metric === 'rsh';
  const vals = lines.flatMap((l) => l.pts.map((p) => p.v)).filter((v) => !log || v > 0);
  // y axis: from 0 (normalised: at least to 1.1), or decades for Rsh
  let Y: (v: number) => number, yt: number[], yd: number;
  if (log) {
    const lo = Math.floor(Math.log10(Math.min(...vals, 1e6))),
      hi = Math.ceil(Math.log10(Math.max(...vals, 10)));
    yt = Array.from({ length: hi - lo + 1 }, (_, i) => 10 ** (lo + i));
    Y = (v: number) => T + PH - ((Math.log10(Math.max(v, 10 ** lo)) - lo) / Math.max(1, hi - lo)) * PH;
    yd = 0;
  } else {
    const ymax0 = Math.max(norm ? 1.1 : 0, ...vals) * (norm ? 1.04 : 1.1),
      yStep = niceStep(ymax0 || 1, 7),
      Y1 = Math.ceil((ymax0 || 1) / yStep - 1e-9) * yStep;
    yt = Array.from({ length: Math.round(Y1 / yStep) + 1 }, (_, i) => +(i * yStep).toFixed(6));
    Y = (v: number) => T + PH - (Math.max(0, v) / Y1) * PH;
    yd = yStep >= 1 ? 0 : Math.max(0, -Math.floor(Math.log10(yStep) + 1e-9));
  }
  const sp = span / tu.k || 1,
    xStep = niceStep(sp, 6),
    X1 = Math.max(xStep, Math.ceil(sp / xStep - 1e-9) * xStep),
    X = (t: number) => L + (t / X1) * PW,
    xt = Array.from({ length: Math.round(X1 / xStep) + 1 }, (_, i) => +(i * xStep).toFixed(6));
  const ylab = norm ? `Normalised ${NAME[metric]}` : `${NAME[metric]} (${UNIT[metric]})`;
  const wm = logo && hasLogo ? fs.watermark : '';
  const fT = (t: number | null, l: (typeof lines)[number]) =>
    metric === 'rs' || metric === 'rsh'
      ? '—'
      : t === null
        ? `> ${fmt(l.pts.filter((p) => !p.bad).at(-1)?.t ?? 0, 1)} ${tu.u}`
        : `${fmt(t, 1)} ${tu.u}`;
  const st = life.settings,
    planned = +(st['Duration (Hours)'] ?? NaN),
    every = +(st['Interval (mins)'] ?? NaN),
    hold = st['Hold Voltage (V)'],
    gap = life.times.length > 1 ? (life.times.at(-1)! - life.times[0]) / (life.times.length - 1) : NaN;
  const csv = () =>
    download(
      `lifetime-${s.id}.csv`,
      [
        'pixel,direction,reading,time_s,voc_V,jsc_mA_cm2,ff_pct,pce_pct,rs_ohm_cm2,rsh_ohm_cm2,status,distorted,instrument_pce_pct',
        ...s.curves
          .slice()
          .sort((a, b) => (a.t ?? 0) - (b.t ?? 0))
          .map((c) =>
            [
              `"${label(`${c.sample}|${c.substrate}|${c.pixel}`)}"`,
              c.dir === 'rev' ? 'backward' : 'forward',
              +c.scan,
              (c.t ?? 0).toFixed(1),
              c.m.voc,
              c.m.jsc,
              c.m.ff,
              c.m.pce,
              c.m.rs,
              c.m.rsh,
              c.m.status,
              curveDistorted(c.V, c.J) ? 'yes' : '',
              c.inst?.pce ?? '',
            ].join(','),
          ),
      ].join('\n'),
    );

  // one pixel's J–V curves over the run, light (first) to dark (last)
  const jv = s.curves
    .filter((c) => `${c.sample}|${c.substrate}|${c.pixel}` === px && c.dir === pxDir)
    .sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  // the J–V figure's axes (0.55.2): V 0–1.2 V by 0.2 and J 0–30 mA/cm² by 5, longer only when the data go beyond
  const jmax = Math.max(0, ...jv.flatMap((c) => c.J.filter((j, i) => c.V[i] >= -0.05 && Number.isFinite(j)))),
    vmax = Math.max(0, ...jv.map((c) => (Number.isFinite(c.m.voc) ? c.m.voc : 0)));
  const V1 = Math.max(1.2, Math.ceil((vmax + 0.05) / 0.2) * 0.2),
    J1 = Math.max(30, Math.ceil((jmax + 2) / 5) * 5);
  const JX = (v: number) => L + (v / V1) * PW,
    JY = (j: number) => T + PH - (j / J1) * PH;
  const path = (c: Curve) =>
    c.V.map((v, i) => [v, c.J[i]] as const)
      .filter(([v, j]) => Number.isFinite(v) && Number.isFinite(j))
      .map(([v, j], i) => `${i ? 'L' : 'M'}${JX(v).toFixed(1)},${JY(Math.max(-J1, Math.min(J1 * 2, j))).toFixed(1)}`)
      .join('');
  /** Axes of a figure: ticks with their labels, the titles, and minor ticks halfway between (linear axes). */
  type Ax = {
    xs: number[];
    X: (x: number) => number;
    ys: number[];
    Y: (y: number) => number;
    xf: (x: number) => string;
    yf: (y: number) => string;
    xTitle: string;
    yTitle: string;
    minorY: boolean;
  };
  const half = (ts: number[]) => ts.slice(0, -1).map((t, i) => (t + ts[i + 1]) / 2);
  /**
   * A figure in the J–V figure's journal style (0.55.2): white, title above, dashed grid, the logo low in the plot, the curves
   * clipped to the frame, a closed frame with inward ticks on all four sides, then the legend on top.
   */
  const frame = (
    svgRef: React.RefObject<SVGSVGElement | null>,
    id: string,
    aria: string,
    title: string,
    ax: Ax,
    plot: React.ReactNode,
    over: React.ReactNode,
    logoX = L + PW * 0.5 - 80,
  ) => (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${FW} ${FH}`}
      width={FW}
      height={FH}
      className="jv-figure"
      xmlns="http://www.w3.org/2000/svg"
      fontFamily={FONT}
      role="img"
      aria-label={aria}
    >
      <rect width={FW} height={FH} fill="#fff" />
      <defs>
        <clipPath id={id}>
          <rect x={L} y={T} width={PW} height={PH} />
        </clipPath>
      </defs>
      <text x={L + PW / 2} y={30} fontSize={21} textAnchor="middle" fill={INK}>
        {title}
      </text>
      {ax.xs.map((t) => (
        <line
          key={'gx' + t}
          x1={ax.X(t)}
          x2={ax.X(t)}
          y1={T}
          y2={T + PH}
          stroke={GRID}
          strokeDasharray="4 4"
          strokeWidth={0.8}
        />
      ))}
      {ax.ys.map((t) => (
        <line
          key={'gy' + t}
          x1={L}
          x2={L + PW}
          y1={ax.Y(t)}
          y2={ax.Y(t)}
          stroke={GRID}
          strokeDasharray="4 4"
          strokeWidth={0.8}
        />
      ))}
      {wm && (
        <image
          href={wm}
          x={logoX}
          y={T + PH - 78}
          width={160}
          height={62}
          opacity={0.3}
          preserveAspectRatio="xMidYMax meet"
        />
      )}
      <g clipPath={`url(#${id})`}>{plot}</g>
      <rect x={L} y={T} width={PW} height={PH} fill="none" stroke={INK} strokeWidth={1.6} />
      {ax.xs.map((t) => (
        <g key={'tx' + t}>
          <line x1={ax.X(t)} x2={ax.X(t)} y1={T + PH} y2={T + PH - 7} stroke={INK} strokeWidth={1.4} />
          <line x1={ax.X(t)} x2={ax.X(t)} y1={T} y2={T + 7} stroke={INK} strokeWidth={1.4} />
          <text x={ax.X(t)} y={T + PH + 22} fontSize={16} textAnchor="middle" fill={INK}>
            {ax.xf(t)}
          </text>
        </g>
      ))}
      {half(ax.xs).map((t) => (
        <g key={'mx' + t}>
          <line x1={ax.X(t)} x2={ax.X(t)} y1={T + PH} y2={T + PH - 4} stroke={INK} />
          <line x1={ax.X(t)} x2={ax.X(t)} y1={T} y2={T + 4} stroke={INK} />
        </g>
      ))}
      {ax.ys.map((t) => (
        <g key={'ty' + t}>
          <line x1={L} x2={L + 7} y1={ax.Y(t)} y2={ax.Y(t)} stroke={INK} strokeWidth={1.4} />
          <line x1={L + PW} x2={L + PW - 7} y1={ax.Y(t)} y2={ax.Y(t)} stroke={INK} strokeWidth={1.4} />
          <text x={L - 10} y={ax.Y(t)} fontSize={16} textAnchor="end" dominantBaseline="central" fill={INK}>
            {ax.yf(t)}
          </text>
        </g>
      ))}
      {ax.minorY &&
        half(ax.ys).map((t) => (
          <g key={'my' + t}>
            <line x1={L} x2={L + 4} y1={ax.Y(t)} y2={ax.Y(t)} stroke={INK} />
            <line x1={L + PW} x2={L + PW - 4} y1={ax.Y(t)} y2={ax.Y(t)} stroke={INK} />
          </g>
        ))}
      <text x={L + PW / 2} y={FH - 16} fontSize={19} textAnchor="middle" fill={INK}>
        {ax.xTitle}
      </text>
      <text transform={`translate(26 ${T + PH / 2}) rotate(-90)`} fontSize={19} textAnchor="middle" fill={INK}>
        {ax.yTitle}
      </text>
      {over}
    </svg>
  );
  const hasRev = s.curves.some((c) => c.dir === 'rev'),
    hasFwd = s.curves.some((c) => c.dir === 'fwd');

  return (
    <div className="stab life">
      <p className="life-run">
        <b>{life.run.replace(/_/g, ' ')}</b>: {life.times.length} readings of {devs.length} pixel
        {devs.length === 1 ? '' : 's'} over {fmt((life.times.at(-1) ?? 0) / tu.k, 1)} {tu.long}, one every{' '}
        {fmt(gap / 60, 1)} min
        {Number.isFinite(every) || Number.isFinite(planned)
          ? ` (set: every ${fmt(every, 1)} min for ${fmt(planned, 1)} h)`
          : ''}
        {/* a run that ended well before its planned length was stopped (or the instrument stopped): say so */}
        {Number.isFinite(planned) && (life.times.at(-1) ?? 0) < planned * 3600 * 0.9
          ? `; it stopped after ${Math.round(((life.times.at(-1) ?? 0) / (planned * 3600)) * 100)} % of the planned time`
          : ''}
        {hold ? `, held at ${/max/i.test(hold) ? 'maximum power' : hold + ' V'} between scans` : ''}. Started{' '}
        {new Date(life.start).toLocaleString('en-GB', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}
        .{' '}
        {life.sensors ? (
          `Light and temperature were recorded (${life.light.length} readings).`
        ) : (
          <span className="mut">
            The light and temperature sensors were not connected, so the light intensity is taken as constant.
          </span>
        )}
      </p>
      {err && <p className="err small">{err}</p>}
      <div className="inline stab-bar">
        <Seg small value={metric} on={setMetric} opts={(Object.keys(NAME) as Metric[]).map((k) => [k, NAME[k]])} />
        {hasRev && hasFwd && (
          <Seg
            small
            value={dir}
            on={setDir}
            opts={[
              ['rev', 'Backward'],
              ['fwd', 'Forward'],
              ['both', 'Both'],
            ]}
          />
        )}
        <label className="inline small">
          <Check v={norm} on={setNorm} /> Normalised to the first reading
        </label>
      </div>
      <div className="inline stab-bar">
        <div className="chips" role="group" aria-label="Pixels to plot">
          {devs.map((k, i) => (
            <button
              key={k}
              className={'chip' + (pick.includes(k) ? ' on' : '')}
              aria-pressed={pick.includes(k)}
              onClick={() =>
                setPick(
                  pick.includes(k) ? pick.filter((x) => x !== k) : devs.filter((x) => x === k || pick.includes(x)),
                )
              }
            >
              {/* the pixel's colour on the plot, as a bar under its name */}
              <span className="life-chip" style={{ '--c': CMP[i % CMP.length] } as React.CSSProperties}>
                {label(k)}
              </span>
            </button>
          ))}
        </div>
        {devs.length > 1 && (
          <>
            <button className="link" disabled={pick.length === devs.length} onClick={() => setPick(devs)}>
              All
            </button>
            <button className="link" disabled={!pick.length} onClick={() => setPick([])}>
              None
            </button>
          </>
        )}
      </div>
      <div className="fig-wrap">
        {!pick.length ? (
          <p className="mut life-none">Pick a pixel above to plot it.</p>
        ) : (
          frame(
            fig,
            `life-t-${s.id}`,
            `${ylab} against time for ${lines.length === 1 ? lines[0].label : `${new Set(lines.map((l) => l.dev)).size} pixels`}`,
            life.run.replace(/_/g, ' '),
            {
              xs: xt,
              X,
              ys: yt,
              Y,
              xf: (t) => String(+t.toFixed(2)),
              yf: (t) => (log ? `1e${Math.round(Math.log10(t))}` : t.toFixed(yd)),
              xTitle: `Time (${tu.long})`,
              yTitle: ylab,
              minorY: !log,
            },
            <>
              {norm &&
                [0.9, 0.8].map((f) => (
                  <g key={f}>
                    <line
                      x1={L}
                      x2={L + PW}
                      y1={Y(f)}
                      y2={Y(f)}
                      stroke="#777"
                      strokeWidth={1.2}
                      strokeDasharray="10 5"
                    />
                    <text x={L + PW - 12} y={Y(f) - 6} fontSize={13} textAnchor="end" fill="#555">
                      T{Math.round(f * 100)}
                    </text>
                  </g>
                ))}
              {lines.map((l) => (
                <g key={l.key}>
                  <path
                    d={l.pts
                      .filter((p) => !p.bad) // the line joins the readings that can be trusted; distorted ones stand apart
                      .map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`)
                      .join('')}
                    fill="none"
                    stroke={l.color}
                    strokeWidth={2.2}
                    // forward solid, backward dashed in the same colour, as in the J–V figure
                    strokeDasharray={l.dir === 'rev' && dir === 'both' ? '8 5' : undefined}
                    strokeLinejoin="round"
                  />
                </g>
              ))}
            </>,
            // the readings over the frame (a reading at time 0 sits on the axis), then the legend inside the frame, low on
            // the left (the curves start at the top and fall to the right)
            (() => {
              const shown = [...new Map(lines.map((l) => [l.dev, l])).values()].slice(0, 8),
                rows = [
                  ...shown.map((l) => ({
                    k: l.dev,
                    c: l.color,
                    dash: undefined as string | undefined,
                    t: label(l.dev),
                  })),
                  ...(dir === 'both'
                    ? [
                        { k: 'fwd', c: INK, dash: undefined, t: 'Forward' },
                        { k: 'rev', c: INK, dash: '8 5', t: 'Backward' },
                      ]
                    : []),
                ];
              return (
                <>
                  {lines.map((l) => (
                    <g key={l.key}>
                      {l.pts.map((p, i) => (
                        <circle
                          key={i}
                          cx={X(p.t)}
                          cy={Y(p.v)}
                          r={p.bad ? 3.2 : 3.6}
                          fill={p.bad ? '#fff' : l.color}
                          stroke={p.bad ? l.color : '#fff'}
                          strokeWidth={p.bad ? 1.5 : 1}
                        >
                          <title>{`${l.label}: ${fmt(p.t, 1)} ${tu.u}, ${fmt(p.raw, DIG[metric])} ${UNIT[metric]}${l.ok ? ` (${fmt((p.raw / l.v0) * 100, 1)} %)` : ''}${p.bad ? ', distorted curve' : ''}`}</title>
                        </circle>
                      ))}
                    </g>
                  ))}
                  <g
                    transform={`translate(${L + 18} ${T + PH - 18 - (rows.length - 1) * 20})`}
                    fontSize={13}
                    fill={INK}
                  >
                    {rows.map((r, i) => (
                      <g key={r.k} transform={`translate(0 ${i * 20})`}>
                        <line x1={0} x2={30} y1={0} y2={0} stroke={r.c} strokeWidth={2.2} strokeDasharray={r.dash} />
                        <text x={38} y={0} dominantBaseline="central">
                          {r.t}
                        </text>
                      </g>
                    ))}
                    {lines.length && new Set(lines.map((l) => l.dev)).size > 8 ? (
                      <text x={0} y={-20} fill="#555">
                        {new Set(lines.map((l) => l.dev)).size - 8} more not in the legend
                      </text>
                    ) : null}
                  </g>
                </>
              );
            })(),
            L + PW - 176,
          )
        )}
      </div>
      <div className="inline">
        {hasLogo && (
          <label className="inline small">
            <Check v={logo} on={setLogo} /> Lab logo
          </label>
        )}
        <button
          className="link"
          onClick={() =>
            fig.current && exportSvg(fig.current, `lifetime-${metric}`, 'png').catch((e) => setErr(e.message))
          }
        >
          Export PNG
        </button>
        <button className="link" onClick={() => fig.current && exportSvg(fig.current, `lifetime-${metric}`, 'svg')}>
          Export SVG
        </button>
        <button className="link" onClick={csv}>
          Export CSV (every reading)
        </button>
      </div>
      <div className="scroll">
        <table className="pp-table">
          <thead>
            <tr>
              <th>Pixel</th>
              <th>First reading</th>
              <th>Latest</th>
              <th>Latest / first</th>
              <th>T90</th>
              <th>T80</th>
            </tr>
          </thead>
          <tbody>
            {model.map((l) => {
              const last = l.pts.filter((p) => !p.bad).at(-1);
              return (
                <tr key={l.key}>
                  <td>
                    <i className="swatch" style={{ background: l.color }} />
                    {l.label}
                  </td>
                  {l.ok && last ? (
                    <>
                      <td>
                        {fmt(l.v0, DIG[metric])} {UNIT[metric]}
                      </td>
                      <td>
                        {fmt(last.raw, DIG[metric])} {UNIT[metric]}{' '}
                        <span className="mut small">
                          at {fmt(last.t, 1)} {tu.u}
                        </span>
                      </td>
                      <td>{fmt((last.raw / l.v0) * 100, 1)} %</td>
                      <td>{fT(l.t90, l)}</td>
                      <td>{fT(l.t80, l)}</td>
                    </>
                  ) : (
                    <td colSpan={5} className="mut">
                      No usable first reading
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mut small">
        Computed by the app from each J–V curve, as in every measurement (the instrument software's own values are kept
        for comparison in the CSV). T90 and T80 are interpolated between the readings around the fall; “&gt;” means it
        had not fallen that far by the latest reading. The first reading counts in the statistics like any measurement;
        the later ones stay out of them.
      </p>
      {nBulge > 0 && metric === 'ff' && (
        <p className="mut small">
          {nBulge} reading{nBulge === 1 ? ' has' : 's have'} an FF above 100 %: during the scan the current near Voc
          rose above Jsc, a transient of a device that was held at maximum power just before. Their PCE is still the
          highest power the scan reached; their FF is not a real fill factor.
        </p>
      )}
      {nBad > 0 && (
        <p className="mut small">
          Hollow points: {nBad} reading{nBad === 1 ? '' : 's'} where the current reverses and recovers before Voc, so
          the curve crosses zero twice. The app reads such a curve up to its first crossing; the instrument software
          takes the last one, which is why their values can differ a lot. T90, T80 and the latest value leave these
          readings out; the J–V curves below show what happened.
        </p>
      )}

      <h3 className="sub">J–V curves over the run</h3>
      <div className="inline stab-bar">
        <select value={px} onChange={(e) => setPx(e.target.value)} aria-label="Pixel">
          {devs.map((k) => (
            <option key={k} value={k}>
              {label(k)}
            </option>
          ))}
        </select>
        {hasRev && hasFwd && (
          <Seg
            small
            value={pxDir}
            on={setPxDir}
            opts={[
              ['rev', 'Backward'],
              ['fwd', 'Forward'],
            ]}
          />
        )}
        <span className="mut small">Light to dark: first to last reading</span>
      </div>
      <div className="fig-wrap">
        {frame(
          jvFig,
          `life-jv-${s.id}`,
          `J–V curves of ${label(px)} over the run`,
          label(px),
          {
            xs: Array.from({ length: Math.round(V1 / 0.2) + 1 }, (_, i) => +(i * 0.2).toFixed(1)),
            X: JX,
            ys: Array.from({ length: Math.round(J1 / 5) + 1 }, (_, i) => i * 5),
            Y: JY,
            xf: (t) => t.toFixed(1),
            yf: (t) => String(t),
            xTitle: 'Voltage (V)',
            yTitle: 'J (mA/cm²)',
            minorY: false,
          },
          <>
            {jv.map((c, i) => (
              <path
                key={c.id}
                d={path(c)}
                fill="none"
                stroke={shade(jv.length > 1 ? i / (jv.length - 1) : 1)}
                strokeWidth={2.2}
                // backward dashed, as in the J–V figure
                strokeDasharray={c.dir === 'rev' ? '8 5' : undefined}
                strokeLinejoin="round"
              >
                <title>{`${fmt((c.t ?? 0) / tu.k, 1)} ${tu.u}: PCE ${fmt(c.m.pce, 2)} %`}</title>
              </path>
            ))}
          </>,
          // top right, as the J–V figure's legend (above the curves, where they fall at Voc)
          jv.length > 0 && (
            <g transform={`translate(${L + PW - 214} ${T + 22})`} fontSize={13} fill={INK}>
              {(jv.length > 1 ? [0, 1] : [1]).map((f, n) => (
                <g key={f} transform={`translate(0 ${n * 20})`}>
                  <line
                    x1={0}
                    x2={30}
                    y1={0}
                    y2={0}
                    stroke={shade(f)}
                    strokeWidth={2.2}
                    strokeDasharray={pxDir === 'rev' ? '8 5' : undefined}
                  />
                  <text x={38} y={0} dominantBaseline="central">
                    {jv.length === 1 ? 'reading' : f ? 'last reading' : 'first reading'},{' '}
                    {+((jv[f ? jv.length - 1 : 0].t ?? 0) / tu.k).toFixed(1)} {tu.u}
                  </text>
                </g>
              ))}
              <text x={0} y={(jv.length > 1 ? 2 : 1) * 20} dominantBaseline="central">
                {pxDir === 'rev' ? 'Backward' : 'Forward'} scan
              </text>
            </g>
          ),
        )}
      </div>
      <div className="inline">
        <button
          className="link"
          onClick={() =>
            jvFig.current &&
            exportSvg(jvFig.current, `lifetime-jv-${pid(px.split('|')[2] ?? '')}`, 'png').catch((e) =>
              setErr(e.message),
            )
          }
        >
          Export PNG
        </button>
        <button
          className="link"
          onClick={() => jvFig.current && exportSvg(jvFig.current, `lifetime-jv-${pid(px.split('|')[2] ?? '')}`, 'svg')}
        >
          Export SVG
        </button>
      </div>
    </div>
  );
}
