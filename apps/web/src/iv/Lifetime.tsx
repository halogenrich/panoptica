import { useMemo, useRef, useState } from 'react';
import { curveDistorted, tFraction } from '@psc/core';
import { Seg } from '../lib/ui';
import { useFigureSettings, useLogoChoice } from '../lib/figure';
import { Check } from '../views/common';
import { CMP } from './Compare';
import { exportSvg } from './JvFigure';
import { download, fmt, type Curve, type Dir, type IvSetFull } from './model';

type Metric = 'pce' | 'voc' | 'jsc' | 'ff' | 'rs' | 'rsh';
const NAME: Record<Metric, string> = { pce: 'PCE', voc: 'Voc', jsc: 'Jsc', ff: 'FF', rs: 'Rs', rsh: 'Rsh' },
  UNIT: Record<Metric, string> = { pce: '%', voc: 'V', jsc: 'mA/cm²', ff: '%', rs: 'Ω·cm²', rsh: 'Ω·cm²' },
  DIG: Record<Metric, number> = { pce: 2, voc: 3, jsc: 2, ff: 1, rs: 1, rsh: 0 };
const FW = 760,
  FH = 470,
  L = 86,
  R = 24,
  T = 26,
  B = 64,
  PW = FW - L - R,
  STRIP = 132, // the time plot's legend (and logo) sit right of the plot
  PWT = PW - STRIP,
  PH = FH - T - B,
  INK = '#111',
  GRID = '#c8c8c8',
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
  const [px, setPx] = useState(devs[0] ?? ''),
    [pxDir, setPxDir] = useState<Dir>('rev');

  if (!life) return <p className="mut">This measurement has no lifetime data.</p>;
  const lines = model.filter((l) => l.ok);
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
    X = (t: number) => L + (t / X1) * PWT,
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
  const jmax = Math.max(5, ...jv.map((c) => c.m.jsc).filter(Number.isFinite)) * 1.15,
    vmax = Math.max(0.4, ...jv.map((c) => c.m.voc).filter(Number.isFinite)) * 1.12;
  const jStep = niceStep(jmax, 6),
    J1 = Math.ceil(jmax / jStep) * jStep,
    vStep = niceStep(vmax, 6),
    V1 = Math.ceil(vmax / vStep) * vStep;
  const JX = (v: number) => L + (v / V1) * PW,
    JY = (j: number) => T + PH - (j / J1) * PH;
  const path = (c: Curve) => {
    const p = c.V.map((v, i) => [v, c.J[i]] as const)
      .filter(([v, j]) => v >= 0 && v <= V1 && j >= -J1 * 0.02)
      .sort((a, b) => a[0] - b[0]);
    return p.map(([v, j], i) => `${i ? 'L' : 'M'}${JX(v).toFixed(1)},${JY(Math.min(j, J1)).toFixed(1)}`).join('');
  };
  const frame = (svgRef: React.RefObject<SVGSVGElement | null>, aria: string, body: React.ReactNode, pw = PW) => (
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
      {body}
      {/* the logo: in the legend strip when there is one, else bottom centre of the plot */}
      {wm && (
        <image
          href={wm}
          x={pw < PW ? L + pw + STRIP / 2 - 56 : L + pw * 0.5 - 80}
          y={T + PH - 78}
          width={pw < PW ? 112 : 160}
          height={62}
          opacity={0.3}
          preserveAspectRatio="xMidYMax meet"
        />
      )}
      <rect x={L} y={T} width={pw} height={PH} fill="none" stroke={INK} strokeWidth={1.6} />
    </svg>
  );
  const axes = (
    xs: number[],
    xl: (x: number) => number,
    ys: number[],
    yl: (y: number) => number,
    yfmt: (y: number) => string,
    xTitle: string,
    yTitle: string,
    pw = PW,
  ) => (
    <>
      {xs.map((t) => (
        <g key={'x' + t}>
          <line x1={xl(t)} x2={xl(t)} y1={T} y2={T + PH} stroke={GRID} strokeDasharray="4 4" strokeWidth={0.8} />
          <line x1={xl(t)} x2={xl(t)} y1={T + PH} y2={T + PH - 7} stroke={INK} strokeWidth={1.4} />
          <text x={xl(t)} y={T + PH + 22} fontSize={16} textAnchor="middle" fill={INK}>
            {+t.toFixed(2)}
          </text>
        </g>
      ))}
      {ys.map((t) => (
        <g key={'y' + t}>
          <line x1={L} x2={L + pw} y1={yl(t)} y2={yl(t)} stroke={GRID} strokeDasharray="4 4" strokeWidth={0.8} />
          <line x1={L} x2={L + 7} y1={yl(t)} y2={yl(t)} stroke={INK} strokeWidth={1.4} />
          <text x={L - 10} y={yl(t)} fontSize={16} textAnchor="end" dominantBaseline="central" fill={INK}>
            {yfmt(t)}
          </text>
        </g>
      ))}
      <text x={L + pw / 2} y={FH - 14} fontSize={19} textAnchor="middle" fill={INK}>
        {xTitle}
      </text>
      <text transform={`translate(26 ${T + PH / 2}) rotate(-90)`} fontSize={19} textAnchor="middle" fill={INK}>
        {yTitle}
      </text>
    </>
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
      <div className="fig-wrap">
        {frame(
          fig,
          `${ylab} against time for ${lines.length} pixels`,
          <>
            {axes(
              xt,
              X,
              yt,
              Y,
              (t) => (log ? `1e${Math.round(Math.log10(t))}` : t.toFixed(yd)),
              `Time (${tu.long})`,
              ylab,
              PWT,
            )}
            {norm &&
              [0.9, 0.8].map((f) => (
                <g key={f}>
                  <line
                    x1={L}
                    x2={L + PWT}
                    y1={Y(f)}
                    y2={Y(f)}
                    stroke="#777"
                    strokeWidth={1.2}
                    strokeDasharray="10 5"
                  />
                  <text x={L + PWT - 6} y={Y(f) - 6} fontSize={13} textAnchor="end" fill="#555">
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
                  strokeWidth={2}
                  strokeDasharray={l.dir === 'fwd' && dir === 'both' ? '6 4' : undefined}
                  strokeLinejoin="round"
                />
                {l.pts.map((p, i) => (
                  <circle
                    key={i}
                    cx={X(p.t)}
                    cy={Y(p.v)}
                    r={p.bad ? 3 : 3.2}
                    fill={p.bad ? '#fff' : l.color}
                    stroke={p.bad ? l.color : '#fff'}
                    strokeWidth={p.bad ? 1.5 : 1}
                  >
                    <title>{`${l.label}: ${fmt(p.t, 1)} ${tu.u}, ${fmt(p.raw, DIG[metric])} ${UNIT[metric]}${l.ok ? ` (${fmt((p.raw / l.v0) * 100, 1)} %)` : ''}${p.bad ? ', distorted curve' : ''}`}</title>
                  </circle>
                ))}
              </g>
            ))}
            {/* legend right of the plot: one colour per pixel, and with Both the line style of each direction */}
            <g transform={`translate(${L + PWT + 16} ${T + 10})`} fontSize={13} fill={INK}>
              {[...new Map(lines.map((l) => [l.dev, l])).values()].slice(0, 14).map((l, i) => (
                <g key={l.dev} transform={`translate(0 ${i * 19})`}>
                  <line x1={0} x2={22} y1={0} y2={0} stroke={l.color} strokeWidth={3} />
                  <text x={30} y={0} dominantBaseline="central">
                    {label(l.dev)}
                  </text>
                </g>
              ))}
              {dir === 'both' &&
                (['rev', 'fwd'] as Dir[]).map((d, i) => (
                  <g
                    key={d}
                    transform={`translate(0 ${(Math.min(14, new Set(lines.map((l) => l.dev)).size) + 0.6 + i) * 19})`}
                  >
                    <line
                      x1={0}
                      x2={22}
                      y1={0}
                      y2={0}
                      stroke={INK}
                      strokeWidth={2}
                      strokeDasharray={d === 'fwd' ? '6 4' : undefined}
                    />
                    <text x={30} y={0} dominantBaseline="central">
                      {d === 'rev' ? 'backward' : 'forward'}
                    </text>
                  </g>
                ))}
            </g>
          </>,
          PWT,
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
          `J–V curves of ${label(px)} over the run`,
          <>
            {axes(
              Array.from({ length: Math.round(V1 / vStep) + 1 }, (_, i) => +(i * vStep).toFixed(6)),
              JX,
              Array.from({ length: Math.round(J1 / jStep) + 1 }, (_, i) => +(i * jStep).toFixed(6)),
              JY,
              (t) => String(+t.toFixed(2)),
              'Voltage (V)',
              'J (mA cm⁻²)',
            )}
            {jv.map((c, i) => (
              <path
                key={c.id}
                d={path(c)}
                fill="none"
                stroke={shade(jv.length > 1 ? i / (jv.length - 1) : 1)}
                strokeWidth={1.8}
              >
                <title>{`${fmt((c.t ?? 0) / tu.k, 1)} ${tu.u}: PCE ${fmt(c.m.pce, 2)} %`}</title>
              </path>
            ))}
            {jv.length > 1 && (
              <g transform={`translate(${L + 18} ${T + PH - 54})`} fontSize={13} fill={INK}>
                {[0, 1].map((f) => (
                  <g key={f} transform={`translate(0 ${f * 20})`}>
                    <line x1={0} x2={24} y1={0} y2={0} stroke={shade(f)} strokeWidth={3} />
                    <text x={32} y={0} dominantBaseline="central">
                      {f ? 'last' : 'first'} reading, {fmt((jv[f ? jv.length - 1 : 0].t ?? 0) / tu.k, 1)} {tu.u}
                    </text>
                  </g>
                ))}
              </g>
            )}
          </>,
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
