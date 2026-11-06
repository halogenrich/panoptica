import { useContext, useEffect, useRef, useState } from 'react';
import { COLORS, metalColor } from '../designs/DesignSvg';
import { hysteresisIndex, union } from '@psc/core';
import { api } from '../api';
import { Seg } from '../lib/ui';
import { JvFigure, exportSvg } from './JvFigure';
import { CompareCtx } from './Compare';
import { Check } from '../views/common';
import { useFigureSettings, useLogoChoice } from '../lib/figure';
import {
  cellGeom,
  fmt,
  inStats,
  isCheck,
  pceFill,
  pixelOrder,
  scanOrder,
  shownCurve,
  type CellGeom,
  type Curve,
  type Dir,
  type IvSetFull,
  type Link,
} from './model';

const STATUS_FILL = {
  dead: { fill: '#1d1d1f', ink: '#fff', text: 'dead' },
  short: { fill: '#d03b3b', ink: '#fff', text: 'short' },
};

type Poly = [number, number][];
const pid = (p: string) => (/^\d/.test(p) ? 'P' + p : p);
const rect = (x: number, y: number, w: number, h: number): Poly => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];
const d = (p: Poly) => 'M' + p.map(([x, y]) => `${+x.toFixed(3)},${+y.toFixed(3)}`).join('L') + 'Z';
interface Device {
  W: number;
  H: number;
  ito: Poly[];
  scrape: Poly[];
  metal: Poly[];
  met: string;
  px: Map<string, { shape: Poly; at: [number, number] }>;
  generic: boolean;
}

/**
 * No device design (sample not linked to a batch or stack, or its mask has a different number of pixels): the pixels as plain
 * boxes, numbered ones in rows of up to four, lettered ones a row per letter.
 */
function plainBoxes(pixels: string[]): Device {
  const lettered = pixels.every((p) => /^[A-Za-z]/.test(p));
  const rows: string[][] = lettered
    ? [...new Set(pixels.map((p) => p[0]))].map((l) => pixels.filter((p) => p[0] === l))
    : Array.from({ length: Math.ceil(pixels.length / 4) }, (_, i) => pixels.slice(i * 4, i * 4 + 4));
  const cols = Math.max(1, ...rows.map((r) => r.length)),
    bw = 5,
    bh = 3.6,
    gap = 0.8;
  const px = new Map<string, { shape: Poly; at: [number, number] }>();
  rows.forEach((r, ri) =>
    r.forEach((p, ci) => {
      const x = gap + ci * (bw + gap),
        y = gap + ri * (bh + gap);
      px.set(p, { shape: rect(x, y, bw, bh), at: [x + bw / 2, y + bh / 2] });
    }),
  );
  return {
    W: gap + cols * (bw + gap),
    H: gap + rows.length * (bh + gap),
    ito: [],
    scrape: [],
    metal: [],
    met: '',
    px,
    generic: true,
  };
}

/** One substrate drawn as the device seen from above; each pixel shows its PCE (black = dead, red = short) and opens its curves. */
export function SubstrateMap({
  set,
  sample,
  substrate,
  dir,
  geom,
  max,
  sel,
  onSelect,
  bestDevice,
  mark,
}: {
  set: IvSetFull;
  sample: string;
  substrate: string;
  dir: Dir;
  geom: CellGeom | null;
  max: number;
  sel: string | null;
  onSelect: (pixel: string, shift: boolean) => void;
  bestDevice?: boolean;
  /** Colour of a pixel picked for comparison (Shift-click), drawn as a thick outline. */
  mark?: (pixel: string) => string | undefined;
}) {
  const curves = set.curves.filter((c) => c.sample === sample && c.substrate === substrate),
    devInfo = set.devices?.[`${sample}|${substrate}`];
  const pixels = [...new Set(curves.map((c) => c.pixel))].sort(pixelOrder);
  const dev: Device =
    geom && geom.pixels.length === pixels.length
      ? {
          W: geom.w,
          H: geom.h,
          ito: geom.ito,
          scrape: geom.scrape,
          metal: geom.metal,
          met: geom.met,
          generic: false,
          px: new Map(pixels.map((p, i) => [p, { shape: geom.pixels[i].shape, at: geom.pixels[i].at }])),
        }
      : plainBoxes(pixels);
  const [mFill, mEdge] = dev.generic ? ['none', 'var(--mut)'] : metalColor(dev.met),
    k = dev.generic ? 20 : Math.min(dev.W, dev.H);
  const metal = dev.generic
    ? []
    : (union([...dev.metal, ...[...dev.px.values()].map((x) => x.shape)]).flat() as Poly[]);
  // the best pixel of this substrate (shown direction) gets a golden border
  const bestPx = (() => {
    let b: string | null = null,
      v = -1;
    for (const p of pixels) {
      const pc = curves.filter((c) => c.pixel === p),
        c = shownCurve(pc, set.curves, dir);
      if (c && inStats(c, set.curves) && c.m.pce > v) {
        v = c.m.pce;
        b = p;
      }
    }
    return b;
  })();
  // one text size for the whole substrate, from the smallest pixel: "P1 · 18.9" when it fits, else the value with the id above it
  const box = (p: string) => {
    const sh = dev.px.get(p)!.shape,
      xs = sh.map((q) => q[0]),
      ys = sh.map((q) => q[1]);
    return { bw: Math.max(...xs) - Math.min(...xs), bh: Math.max(...ys) - Math.min(...ys), top: Math.min(...ys) };
  };
  const minW = Math.min(...pixels.map((p) => box(p).bw)),
    minH = Math.min(...pixels.map((p) => box(p).bh));
  const fit = (chars: number, rows: number) => Math.min((minW * 0.9) / (chars * 0.6), minH / (rows * 1.5), k * 0.08);
  const longest = Math.max(...pixels.map((p) => pid(p).length)) + 8;
  const inline = fit(longest, 1) >= fit(4.6, 2.2),
    fs = Math.max(fit(longest, 1), fit(4.6, 2.2)); // whichever gives the larger text
  const tile = (p: string) => {
    const pc = curves.filter((c) => c.pixel === p),
      c = shownCurve(pc, set.curves, dir) ?? shownCurve(pc, set.curves, dir === 'rev' ? 'fwd' : 'rev');
    const st = c?.m.status ?? 'dead',
      col = st === 'ok' ? pceFill(c!.m.pce, max) : STATUS_FILL[st],
      counted = c ? inStats(c, set.curves) : false;
    const val = st === 'ok' ? fmt(c!.m.pce, 1) : STATUS_FILL[st].text; // the % sign is in the legend: more room for the number
    const aria = `Pixel ${p}: ${st === 'ok' ? `PCE ${fmt(c!.m.pce, 2)} %` : st === 'dead' ? 'dead' : 'short circuit'}${counted ? '' : st === 'ok' ? ', not in statistics' : ''}`;
    const gp = dev.px.get(p)!,
      [cx, cy] = gp.at;
    return (
      <g
        key={p}
        role="button"
        tabIndex={0}
        aria-label={aria + (bestPx === p ? ', best pixel' : '')}
        aria-pressed={sel === p}
        className={
          'px' + (sel === p ? ' sel' : '') + (!counted && st === 'ok' ? ' off' : '') + (bestPx === p ? ' best' : '')
        }
        onMouseDown={(e) => {
          if (e.shiftKey) e.preventDefault(); /* Shift-click picks, it does not select text */
        }}
        onClick={(e) => onSelect(p, e.shiftKey)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(p, e.shiftKey);
          }
        }}
      >
        {dev.generic ? (
          (() => {
            const xs = gp.shape.map((q) => q[0]),
              ys = gp.shape.map((q) => q[1]),
              x0 = Math.min(...xs),
              y0 = Math.min(...ys); // plain box: rounded corners
            return (
              <rect
                x={x0}
                y={y0}
                width={Math.max(...xs) - x0}
                height={Math.max(...ys) - y0}
                rx={0.55}
                className="px-area"
                fill={col.fill}
                stroke={mEdge}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            );
          })()
        ) : (
          <path
            d={d(gp.shape)}
            className="px-area"
            fill={col.fill}
            stroke={mEdge}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {inline ? (
          <text
            x={cx}
            y={cy}
            fill={col.ink}
            fontSize={fs}
            textAnchor="middle"
            dominantBaseline="central"
            className="px-val"
          >{`${pid(p)} · ${val}`}</text>
        ) : (
          <>
            <text
              x={cx}
              y={cy - fs * 0.62}
              fill={col.ink}
              fontSize={fs * 0.72}
              textAnchor="middle"
              dominantBaseline="central"
              className="px-id"
            >
              {pid(p)}
            </text>
            <text
              x={cx}
              y={cy + fs * 0.45}
              fill={col.ink}
              fontSize={fs}
              textAnchor="middle"
              dominantBaseline="central"
              className="px-val"
            >
              {val}
            </text>
          </>
        )}
        {mark?.(p) &&
          (() => {
            const xs = gp.shape.map((q) => q[0]),
              ys = gp.shape.map((q) => q[1]),
              x0 = Math.min(...xs),
              y0 = Math.min(...ys);
            return [7, 4].map((w) =>
              dev.generic ? ( // a white halo under the colour, so the mark shows on any pixel colour
                <rect
                  key={w}
                  x={x0}
                  y={y0}
                  width={Math.max(...xs) - x0}
                  height={Math.max(...ys) - y0}
                  rx={0.55}
                  fill="none"
                  stroke={w === 7 ? '#fff' : mark(p)}
                  strokeWidth={w}
                  vectorEffect="non-scaling-stroke"
                  className="px-cmp"
                />
              ) : (
                <path
                  key={w}
                  d={d(gp.shape)}
                  fill="none"
                  stroke={w === 7 ? '#fff' : mark(p)}
                  strokeWidth={w}
                  vectorEffect="non-scaling-stroke"
                  className="px-cmp"
                />
              ),
            );
          })()}
        <title>
          {aria}
          {mark?.(p) ? ' (in the comparison)' : ''}
        </title>
      </g>
    );
  };
  const best = curves.filter((c) => c.dir === dir && inStats(c, set.curves)).reduce((b, c) => Math.max(b, c.m.pce), 0);
  return (
    <figure
      className={
        'cell' + (bestDevice ? ' best' : '') + (dev.generic ? ' plain' : '') + (devInfo?.off ? ' left-out' : '')
      }
    >
      <svg viewBox={`-0.3 -0.3 ${dev.W + 0.6} ${dev.H + 0.6}`} role="group" aria-label={`Substrate ${substrate}`}>
        {!dev.generic && (
          <rect
            x={0}
            y={0}
            width={dev.W}
            height={dev.H}
            fill={COLORS.glass}
            stroke="var(--mut)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {dev.ito.map((p, i) => (
          <path key={i} d={d(p)} fill={COLORS.ito} fillOpacity={0.5} />
        ))}
        {dev.scrape.map((p, i) => (
          <path key={i} d={d(p)} fill={COLORS.scrape} fillOpacity={0.35} />
        ))}
        {metal.length > 0 && (
          <path
            d={metal.map(d).join('')}
            fill={mFill}
            fillRule="evenodd"
            stroke={mEdge}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {pixels.map(tile)}
      </svg>
      <figcaption>
        <b>
          Substrate {substrate}
          {bestDevice && <span className="best-tag"> · best device</span>}
        </b>
        <span className="mut">
          {devInfo?.off ? 'not in plots · ' : devInfo?.g ? `${devInfo.g} · ` : ''}
          {best ? `best ${best.toFixed(2)} %` : 'no working pixel'}
        </span>
      </figcaption>
    </figure>
  );
}

/** Curves and numbers of one pixel: every scan and direction, which ones count in the statistics. */
export function PixelPanel({
  set,
  sample,
  substrate,
  pixel,
  link,
  onChange,
  onClose,
}: {
  set: IvSetFull;
  sample: string;
  substrate: string;
  pixel: string;
  link: Link;
  onChange: (c: Curve) => void;
  onClose: () => void;
}) {
  const fs = useFigureSettings(),
    hasLogo = !!(fs.watermark || fs.group),
    [logo, setLogo] = useLogoChoice();
  const cs = set.curves
    .filter((c) => c.sample === sample && c.substrate === substrate && c.pixel === pixel)
    .sort((a, b) => scanOrder(a.scan, b.scan) || (a.dir === 'rev' ? -1 : 1));
  // the counted scan with the best PCE of this pixel (any direction; never a check sweep) is shown first and reported on the figure
  const best = cs
    .filter((c) => inStats(c, set.curves))
    .reduce<Curve | undefined>((b, c) => (!b || c.m.pce > b.m.pce ? c : b), undefined);
  const scans = [...new Set(cs.map((c) => c.scan))],
    first = best?.scan ?? scans[scans.length - 1] ?? '',
    [scan, setScan] = useState(first),
    [err, setErr] = useState('');
  useEffect(() => setScan(first), [pixel, substrate, sample]);
  const shown = cs.filter((c) => c.scan === scan),
    fig = useRef<SVGSVGElement>(null);
  const title = `${set.links[sample]?.label ?? sample.replace(/_/g, ' ')} · substrate ${substrate} · pixel ${pixel}`;
  const fname = `JV_${sample}_${substrate}_px${pixel}${scan ? '_scan' + scan : ''}`.replace(/[^\w.-]+/g, '_');
  const rev = shown.find((c) => c.dir === 'rev'),
    fwd = shown.find((c) => c.dir === 'fwd');
  const setUse = (c: Curve, use: boolean | null) =>
    api(`/iv/curves/${c.id}`, 'PATCH', { use })
      .then(() => onChange({ ...c, use }))
      .catch((e) => setErr(e.message));
  return (
    <section className="group pixel-panel" aria-label={`Pixel ${pixel}`}>
      <div className="inline" style={{ justifyContent: 'space-between' }}>
        <h3 className="pp-title">
          {sample.replace(/_/g, ' ')} · substrate {substrate} · pixel {pixel}
        </h3>
        <button className="iconbtn" aria-label="Close the pixel" onClick={onClose}>
          ✕
        </button>
      </div>
      {scans.length > 1 && (
        <Seg
          small
          value={scan}
          on={setScan}
          opts={scans.map(
            (s) =>
              [
                s,
                `Scan ${s || '1'}${best?.scan === s ? ' ★' : ''}${cs.some((c) => c.scan === s && isCheck(c)) ? ' · check sweep' : ''}`,
              ] as [string, string],
          )}
        />
      )}
      <div className="fig-wrap">
        <JvFigure
          curves={shown}
          best={
            best && best.scan === scan
              ? best
              : shown.filter((c) => c.m.status === 'ok').sort((a, b) => b.m.pce - a.m.pce)[0]
          }
          title={title}
          link={link}
          svgRef={fig}
          logo={logo && hasLogo}
        />
      </div>
      <div className="inline">
        {hasLogo && (
          <label className="inline small">
            <Check v={logo} on={setLogo} /> Group logo
          </label>
        )}
        <button
          className="link"
          onClick={() => fig.current && exportSvg(fig.current, fname, 'png').catch((e) => setErr(e.message))}
        >
          Export PNG
        </button>
        <button className="link" onClick={() => fig.current && exportSvg(fig.current, fname, 'svg')}>
          Export SVG
        </button>
        <span className="mut small">
          {best
            ? `Best PCE of this pixel: ${best.dir === 'rev' ? 'backward' : 'forward'}${best.scan ? `, scan ${best.scan}` : ''}${best.scan !== scan ? ' (choose that scan above)' : ''}`
            : 'No working scan'}{' '}
          · watermark and group name: profile menu
        </span>
      </div>
      <div className="scroll">
        <table className="pp-table">
          <thead>
            <tr>
              <th>Scan</th>
              <th>PCE (%)</th>
              <th>Voc (V)</th>
              <th>Jsc (mA/cm²)</th>
              <th>FF (%)</th>
              <th>Rs (Ω·cm²)</th>
              <th>Rsh (Ω·cm²)</th>
              <th>Pixel</th>
              <th>Statistics</th>
            </tr>
          </thead>
          <tbody>
            {cs.map((c) => (
              <tr key={c.id} className={(c.scan === scan ? '' : 'mut') + (isCheck(c) ? ' sweep-row' : '')}>
                <td>
                  {c.dir === 'rev' ? 'Backward' : 'Forward'}
                  {scans.length > 1 ? ` · ${c.scan || '1'}` : ''}
                  {c === best ? ' ★' : ''}
                  {isCheck(c) && (
                    <span
                      className="sweep-tag"
                      title="A quick exploratory scan (coarser steps or one direction) before the real measurement of this pixel. Not counted unless you include it."
                    >
                      check sweep
                    </span>
                  )}
                </td>
                <td>
                  <b>{fmt(c.m.pce)}</b>
                </td>
                <td>{fmt(c.m.voc, 3)}</td>
                <td>{fmt(c.m.jsc)}</td>
                <td>{fmt(c.m.ff, 1)}</td>
                <td>{fmt(c.m.rs, 1)}</td>
                <td>{Number.isFinite(c.m.rsh) ? fmt(c.m.rsh, 0) : c.m.rsh === null ? '∞' : '—'}</td>
                <td>
                  <span className={'pstat ' + c.m.status}>{c.m.status === 'ok' ? 'working' : c.m.status}</span>
                  {c.m.spikes ? (
                    <span className="mut small">
                      {' '}
                      · {c.m.spikes} glitch point{c.m.spikes > 1 ? 's' : ''} ignored
                    </span>
                  ) : null}
                </td>
                <td>
                  {set.editable ? (
                    <select
                      aria-label="Use in statistics"
                      value={c.use === null ? 'auto' : c.use ? 'yes' : 'no'}
                      onChange={(e) => setUse(c, e.target.value === 'auto' ? null : e.target.value === 'yes')}
                    >
                      <option value="auto">
                        Auto (
                        {inStats(
                          { ...c, use: null },
                          set.curves.map((x) => (x.id === c.id ? { ...x, use: null } : x)),
                        )
                          ? 'in'
                          : 'out'}
                        )
                      </option>
                      <option value="yes">Include</option>
                      <option value="no">Exclude</option>
                    </select>
                  ) : inStats(c, set.curves) ? (
                    'in'
                  ) : (
                    'out'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rev && fwd && rev.m.status === 'ok' && (
        <p className="small">
          Hysteresis index (scan {scan || '1'}): <b>{fmt(hysteresisIndex(rev.m.pce, fwd.m.pce), 3)}</b>{' '}
          <span className="mut">= (PCE backward − PCE forward) / PCE backward</span>
        </p>
      )}
      {shown.some((c) => c.inst?.pce != null) && (
        <p className="mut small">
          Instrument software reported:{' '}
          {shown
            .map(
              (c) =>
                `${c.dir === 'rev' ? 'backward' : 'forward'} PCE ${fmt(c.inst?.pce)} %, Voc ${fmt(c.inst?.voc, 3)} V, Jsc ${fmt(c.inst?.jsc)} mA/cm², FF ${fmt(c.inst?.ff, 1)} %`,
            )
            .join(' · ')}
        </p>
      )}
      <p className="mut small">
        Area {cs[0]?.area ? `${cs[0].area} cm²` : 'not in the file'} · light {cs[0]?.pin} mW/cm² ·{' '}
        {cs[0]?.file.split(/[\\/]/).pop()}
      </p>
      {err && <p className="err">{err}</p>}
    </section>
  );
}

/** All substrates of one sample, with the cell drawn from the linked batch/stack mask when its pixel count matches. */
export function SampleMaps({
  set,
  sample,
  link,
  dir,
  onCurve,
}: {
  set: IvSetFull;
  sample: string;
  link: Link;
  dir: Dir;
  onCurve: (c: Curve) => void;
}) {
  const [geom, setGeom] = useState<CellGeom | null>(null),
    [sel, setSel] = useState<{ sub: string; px: string } | null>(null),
    cmp = useContext(CompareCtx);
  const keyOf = (sub: string, px: string) => `${set.id}|${sample}|${sub}|${px}`;
  const pick = (sub: string, px: string, shift: boolean) => {
    if (shift && cmp) {
      const label = `${set.links[sample]?.label ?? sample.replace(/_/g, ' ')}, substrate ${sub}, ${pid(px)}`;
      cmp.toggle({
        key: keyOf(sub, px),
        label,
        link,
        curves: set.curves.filter((c) => c.sample === sample && c.substrate === sub && c.pixel === px),
      });
      return;
    }
    setSel(sel?.sub === sub && sel.px === px ? null : { sub, px });
  };
  useEffect(() => {
    let on = true;
    cellGeom(link).then((g) => on && setGeom(g));
    return () => {
      on = false;
    };
  }, [link?.kind, link?.id]);
  const subs = [...new Set(set.curves.filter((c) => c.sample === sample).map((c) => c.substrate))].sort(pixelOrder);
  const max = Math.max(1, ...set.curves.filter((c) => c.m.status === 'ok').map((c) => c.m.pce));
  // best device of this sample: the substrate with the highest-PCE working pixel in the shown direction
  const bestOf = (sub: string) =>
    Math.max(
      0,
      ...set.curves
        .filter((c) => c.sample === sample && c.substrate === sub && c.dir === dir && inStats(c, set.curves))
        .map((c) => c.m.pce),
    );
  const bestSub =
    subs.length > 1 ? subs.reduce<string | null>((b, x) => (bestOf(x) > (b ? bestOf(b) : 0) ? x : b), null) : null;
  return (
    <>
      <div className="cells">
        {subs.map((s) => (
          <SubstrateMap
            key={s}
            set={set}
            sample={sample}
            substrate={s}
            dir={dir}
            geom={geom}
            max={max}
            bestDevice={s === bestSub}
            sel={sel?.sub === s ? sel.px : null}
            onSelect={(px, shift) => pick(s, px, shift)}
            mark={cmp ? (px) => cmp.colorOf(keyOf(s, px)) : undefined}
          />
        ))}
      </div>
      {sel && (
        <PixelPanel
          set={set}
          sample={sample}
          substrate={sel.sub}
          pixel={sel.px}
          link={link}
          onChange={onCurve}
          onClose={() => setSel(null)}
        />
      )}
    </>
  );
}
