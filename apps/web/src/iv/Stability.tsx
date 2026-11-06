import { useEffect, useMemo, useRef, useState } from 'react';
import { tFraction } from '@psc/core';
import { api } from '../api';
import { Seg } from '../lib/ui';
import { useFigureSettings, useLogoChoice } from '../lib/figure';
import { Check } from '../views/common';
import { CMP } from './Compare';
import { exportSvg } from './JvFigure';
import { counts, download, fmt, type Dir } from './model';

type Pt = {
  set: number;
  sample: string;
  substrate: string;
  pixel: string;
  scan: string;
  dir: Dir;
  m: Record<string, any>;
  use: boolean | null;
  kind?: 'check' | null;
};
type Series = {
  base: number;
  sets: { id: number; name: string; measuredAt: string }[];
  links: Record<string, { label: string } | null>;
  points: Pt[];
};
type Metric = 'pce' | 'voc' | 'jsc' | 'ff';
const NAME: Record<Metric, string> = { pce: 'PCE', voc: 'Voc', jsc: 'Jsc', ff: 'FF' },
  UNIT: Record<Metric, string> = { pce: '%', voc: 'V', jsc: 'mA/cm²', ff: '%' };
const FW = 760,
  FH = 470,
  L = 82,
  R = 24,
  T = 26,
  B = 64,
  PW = FW - L - R,
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

/**
 * A stability test: the devices of the first measurement followed through the later readings, against time since the first.
 * Each device is its best pixel at the start (or every pixel), matched by sample, substrate and pixel; its value is the best
 * working scan in the chosen direction. Normalised to the first reading, with T90 and T80 where the curve falls that far.
 */
export default function Stability({ setId }: { setId: number }) {
  const [d, setD] = useState<Series | null>(null),
    [err, setErr] = useState('');
  const [metric, setMetric] = useState<Metric>('pce'),
    [dir, setDir] = useState<Dir>('rev'),
    [norm, setNorm] = useState(true),
    [all, setAll] = useState(false);
  const fig = useRef<SVGSVGElement>(null),
    fs = useFigureSettings(),
    hasLogo = !!(fs.watermark || fs.group),
    [logo, setLogo] = useLogoChoice();
  useEffect(() => {
    api<Series>(`/iv/${setId}/stability`)
      .then((x) => {
        setD(x);
        if (!x.points.some((p) => p.dir === 'rev')) setDir('fwd');
      })
      .catch((e) => setErr(e.message));
  }, [setId]);
  const model = useMemo(() => {
    if (!d) return null;
    const t0 = new Date(d.sets[0].measuredAt).getTime(),
      hours = (id: number) => (new Date(d.sets.find((s) => s.id === id)!.measuredAt).getTime() - t0) / 3.6e6;
    const span = Math.max(0, ...d.sets.map((s) => hours(s.id))),
      days = span > 72,
      k = days ? 24 : 1,
      unit = days ? 'd' : 'h';
    // value of one pixel in one measurement: its best working scan in this direction
    const val = (set: number, smp: string, sub: string, px: string) => {
      const c = d.points.filter(
        (p) => p.set === set && p.sample === smp && p.substrate === sub && p.pixel === px && p.dir === dir && counts(p),
      );
      const b = c.reduce<Pt | undefined>((x, p) => (!x || p.m.pce > x.m.pce ? p : x), undefined);
      return b ? (b.m[metric] as number) : null;
    };
    const basePx = [
      ...new Set(d.points.filter((p) => p.set === d.base).map((p) => `${p.sample}|${p.substrate}|${p.pixel}`)),
    ].filter((k2) => {
      const [a, b, c] = k2.split('|');
      return val(d.base, a, b, c) !== null;
    });
    // one line per device (its best pixel at the start), or per pixel
    const picks = all
      ? basePx
      : Object.values(
          basePx.reduce<Record<string, string>>((acc, k2) => {
            const [a, b, c] = k2.split('|'),
              dev = `${a}|${b}`,
              cur = acc[dev];
            if (
              !cur ||
              (val(d.base, a, b, c) ?? 0) > (val(d.base, ...(cur.split('|') as [string, string, string])) ?? 0)
            )
              acc[dev] = k2;
            return acc;
          }, {}),
        );
    const lines = picks.map((k2, i) => {
      const [smp, sub, px] = k2.split('|'),
        v0 = val(d.base, smp, sub, px)!;
      const pts = d.sets
        .map((s) => ({ t: hours(s.id) / k, raw: val(s.id, smp, sub, px) }))
        .filter((p) => p.raw !== null)
        .map((p) => ({ t: p.t, raw: p.raw!, v: norm ? p.raw! / v0 : p.raw! }));
      const n = pts.map((p) => ({ t: p.t, v: p.raw / v0 }));
      return {
        key: k2,
        color: CMP[i % CMP.length],
        label: `${d.links[smp]?.label ?? smp.replace(/_/g, ' ')}, substrate ${sub}${all ? `, ${pid(px)}` : ''}`,
        v0,
        pts,
        t90: tFraction(n, 0.9),
        t80: tFraction(n, 0.8),
      };
    });
    return { lines, unit, span: span / k };
  }, [d, metric, dir, norm, all]);
  if (err) return <p className="err">{err}</p>;
  if (!d || !model) return <p className="mut">Loading the series…</p>;
  if (d.sets.length < 2)
    return (
      <div className="stab-empty">
        <p>No follow-up readings yet.</p>
        <p className="mut small">
          Import a later reading of these devices and tick “Stability test” in the import, pointing to this measurement
          (or set it on that measurement under “Stability test”).
        </p>
      </div>
    );
  const { lines, unit, span } = model;
  const vals = lines.flatMap((l) => l.pts.map((p) => p.v)),
    ymax0 = Math.max(norm ? 1.1 : 0, ...vals) * (norm ? 1.04 : 1.1);
  const yStep = niceStep(ymax0, 7),
    Y1 = Math.ceil(ymax0 / yStep - 1e-9) * yStep,
    xStep = niceStep(span || 1, 6),
    X1 = Math.max(xStep, Math.ceil((span || 1) / xStep - 1e-9) * xStep);
  const X = (t: number) => L + (t / X1) * PW,
    Y = (v: number) => T + PH - (v / Y1) * PH;
  const xt = Array.from({ length: Math.round(X1 / xStep) + 1 }, (_, i) => +(i * xStep).toFixed(6)),
    yt = Array.from({ length: Math.round(Y1 / yStep) + 1 }, (_, i) => +(i * yStep).toFixed(6));
  const yd = yStep >= 1 ? 0 : Math.max(0, -Math.floor(Math.log10(yStep) + 1e-9)),
    ylab = norm ? `Normalised ${NAME[metric]}` : `${NAME[metric]} (${UNIT[metric]})`;
  const wm = logo && hasLogo ? fs.watermark : '',
    grp = logo && hasLogo ? fs.group : '';
  const fT = (t: number | null, l: (typeof lines)[number]) =>
    t === null ? `> ${fmt(l.pts.at(-1)!.t, 1)} ${unit}` : `${fmt(t, 1)} ${unit}`;
  const csv = () =>
    download(
      `stability-${d.base}.csv`,
      [
        'device,time_' + unit + ',' + metric + ',normalised',
        ...lines.flatMap((l) =>
          l.pts.map((p) => `"${l.label}",${p.t.toFixed(3)},${p.raw},${(p.raw / l.v0).toFixed(4)}`),
        ),
      ].join('\n'),
    );
  return (
    <div className="stab">
      <div className="inline stab-bar">
        <Seg
          small
          value={metric}
          on={setMetric}
          opts={[
            ['pce', 'PCE'],
            ['voc', 'Voc'],
            ['jsc', 'Jsc'],
            ['ff', 'FF'],
          ]}
        />
        <Seg
          small
          value={dir}
          on={setDir}
          opts={[
            ['rev', 'Backward'],
            ['fwd', 'Forward'],
          ]}
        />
        <label className="inline small">
          <Check v={norm} on={setNorm} /> Normalised to the first reading
        </label>
        <label className="inline small">
          <Check v={all} on={setAll} /> Every pixel (otherwise the best pixel of each device)
        </label>
        <div className="grow" />
        <span className="mut small">
          {d.sets.length} readings over {fmt(span, 1)} {unit === 'd' ? 'days' : 'hours'}
        </span>
      </div>
      <div className="fig-wrap">
        <svg
          ref={fig}
          viewBox={`0 0 ${FW} ${FH}`}
          width={FW}
          height={FH}
          className="jv-figure"
          xmlns="http://www.w3.org/2000/svg"
          fontFamily={FONT}
          role="img"
          aria-label={`${ylab} against time for ${lines.length} devices`}
        >
          <rect width={FW} height={FH} fill="#fff" />
          {xt.map((t) => (
            <line
              key={'gx' + t}
              x1={X(t)}
              x2={X(t)}
              y1={T}
              y2={T + PH}
              stroke={GRID}
              strokeDasharray="4 4"
              strokeWidth={0.8}
            />
          ))}
          {yt.map((t) => (
            <line
              key={'gy' + t}
              x1={L}
              x2={L + PW}
              y1={Y(t)}
              y2={Y(t)}
              stroke={GRID}
              strokeDasharray="4 4"
              strokeWidth={0.8}
            />
          ))}
          {norm &&
            [0.9, 0.8]
              .filter((f) => f < Y1)
              .map((f) => (
                <g key={f}>
                  <line x1={L} x2={L + PW} y1={Y(f)} y2={Y(f)} stroke="#777" strokeWidth={1.2} strokeDasharray="10 5" />
                  <text x={L + PW - 6} y={Y(f) - 6} fontSize={13} textAnchor="end" fill="#555">
                    T{Math.round(f * 100)}
                  </text>
                </g>
              ))}
          {wm && (
            <image
              href={wm}
              x={L + PW * 0.5 - 80}
              y={T + PH - (grp ? 96 : 78)}
              width={160}
              height={62}
              opacity={0.3}
              preserveAspectRatio="xMidYMax meet"
            />
          )}
          {grp && (
            <text x={L + PW * 0.5} y={T + PH - 16} fontSize={12.5} textAnchor="middle" fill={INK} opacity={0.5}>
              {grp}
            </text>
          )}
          {lines.map((l) => (
            <g key={l.key}>
              <path
                d={l.pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join('')}
                fill="none"
                stroke={l.color}
                strokeWidth={2}
                strokeLinejoin="round"
              />
              {l.pts.map((p, i) => (
                <circle key={i} cx={X(p.t)} cy={Y(p.v)} r={4} fill={l.color} stroke="#fff" strokeWidth={1.2}>
                  <title>{`${l.label}: ${fmt(p.t, 1)} ${unit}, ${fmt(p.raw, metric === 'voc' ? 3 : 2)} ${UNIT[metric]} (${fmt((p.raw / l.v0) * 100, 1)} %)`}</title>
                </circle>
              ))}
            </g>
          ))}
          <rect x={L} y={T} width={PW} height={PH} fill="none" stroke={INK} strokeWidth={1.6} />
          {xt.map((t) => (
            <g key={'tx' + t}>
              <line x1={X(t)} x2={X(t)} y1={T + PH} y2={T + PH - 7} stroke={INK} strokeWidth={1.4} />
              <text x={X(t)} y={T + PH + 22} fontSize={16} textAnchor="middle" fill={INK}>
                {+t.toFixed(2)}
              </text>
            </g>
          ))}
          {yt.map((t) => (
            <g key={'ty' + t}>
              <line x1={L} x2={L + 7} y1={Y(t)} y2={Y(t)} stroke={INK} strokeWidth={1.4} />
              <text x={L - 10} y={Y(t)} fontSize={16} textAnchor="end" dominantBaseline="central" fill={INK}>
                {t.toFixed(yd)}
              </text>
            </g>
          ))}
          <text x={L + PW / 2} y={FH - 14} fontSize={19} textAnchor="middle" fill={INK}>
            Time ({unit === 'd' ? 'days' : 'hours'})
          </text>
          <text transform={`translate(26 ${T + PH / 2}) rotate(-90)`} fontSize={19} textAnchor="middle" fill={INK}>
            {ylab}
          </text>
          {lines.length <= 10 && (
            <g transform={`translate(${L + 16} ${T + PH - 16 - (lines.length - 1) * 19})`} fontSize={13} fill={INK}>
              {lines.map((l, i) => (
                <g key={l.key} transform={`translate(0 ${i * 19})`}>
                  <line x1={0} x2={24} y1={0} y2={0} stroke={l.color} strokeWidth={3} />
                  <text x={32} y={0} dominantBaseline="central">
                    {l.label}
                  </text>
                </g>
              ))}
            </g>
          )}
        </svg>
      </div>
      <div className="inline">
        {hasLogo && (
          <label className="inline small">
            <Check v={logo} on={setLogo} /> Group logo
          </label>
        )}
        <button
          className="link"
          onClick={() =>
            fig.current && exportSvg(fig.current, `stability-${metric}`, 'png').catch((e) => setErr(e.message))
          }
        >
          Export PNG
        </button>
        <button className="link" onClick={() => fig.current && exportSvg(fig.current, `stability-${metric}`, 'svg')}>
          Export SVG
        </button>
        <button className="link" onClick={csv}>
          Export CSV
        </button>
      </div>
      <div className="scroll">
        <table className="pp-table">
          <thead>
            <tr>
              <th>Device</th>
              <th>First reading</th>
              <th>Latest</th>
              <th>Latest / first</th>
              <th>T90</th>
              <th>T80</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const last = l.pts.at(-1)!;
              return (
                <tr key={l.key}>
                  <td>
                    <i className="swatch" style={{ background: l.color }} />
                    {l.label}
                  </td>
                  <td>
                    {fmt(l.v0, metric === 'voc' ? 3 : 2)} {UNIT[metric]}
                  </td>
                  <td>
                    {fmt(last.raw, metric === 'voc' ? 3 : 2)} {UNIT[metric]}{' '}
                    <span className="mut small">
                      at {fmt(last.t, 1)} {unit}
                    </span>
                  </td>
                  <td>{fmt((last.raw / l.v0) * 100, 1)} %</td>
                  <td>{fT(l.t90, l)}</td>
                  <td>{fT(l.t80, l)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mut small">
        Readings:{' '}
        {d.sets
          .map(
            (s) =>
              `${s.name} (${new Date(s.measuredAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })})`,
          )
          .join(' · ')}
        . T90 and T80 are interpolated between the readings around the fall; {'“>”'} means it had not fallen that far by
        the latest reading.
      </p>
    </div>
  );
}
