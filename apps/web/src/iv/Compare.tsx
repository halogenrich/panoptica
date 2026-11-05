import { createContext, useRef, useState } from 'react';
import { useFigureSettings, useLogoChoice } from '../lib/figure';
import { Check } from '../views/common';
import { Seg } from '../lib/ui';
import { JvFigure, exportSvg } from './JvFigure';
import { fmt, type Curve, type Link } from './model';

/** One pixel picked for comparison (Shift-click): its curves, and a label naming sample, substrate and pixel. */
export type CmpItem = { key: string; label: string; curves: Curve[]; link?: Link };
export const CompareCtx = createContext<{ items: CmpItem[]; toggle: (it: CmpItem) => void; colorOf: (key: string) => string | undefined } | null>(null);

/** Distinct colours for up to ten pixels (then they repeat), readable on white. */
export const CMP = ['#d7263d', '#1b4f9c', '#0f8b5f', '#e08e0b', '#7b3fa0', '#0e9aa7', '#a15c2a', '#c2185b', '#3d5a80', '#6b8e23'];

/** Best scan of a pixel: the scan holding its highest-PCE working curve; both directions of that scan. */
export function bestScan(cs: Curve[]) {
  const best = cs.filter((c) => c.m.status === 'ok').reduce<Curve | undefined>((b, c) => (!b || c.m.pce > b.m.pce ? c : b), undefined);
  const scan = best?.scan ?? cs[0]?.scan;
  return { best, curves: cs.filter((c) => c.scan === scan) };
}

export function useCompare() {
  const [items, setItems] = useState<CmpItem[]>([]);
  const toggle = (it: CmpItem) => setItems((l) => (l.some((x) => x.key === it.key) ? l.filter((x) => x.key !== it.key) : [...l, it]));
  const colorOf = (key: string) => { const i = items.findIndex((x) => x.key === key); return i < 0 ? undefined : CMP[i % CMP.length]; };
  return { items, setItems, value: { items, toggle, colorOf } };
}

const FW = 760, FH = 520, L = 82, R = 22, T = 30, B = 66, PW = FW - L - R, PH = FH - T - B, INK = '#111', GRID = '#b8b8b8', FONT = 'Inter, "Segoe UI", Helvetica, Arial, sans-serif';

/** J–V curves of several pixels on one set of axes (journal style): one colour per pixel, forward solid, backward dashed. */
function CompareFigure({ items, dir, svgRef, logo }: { items: CmpItem[]; dir: 'both' | 'rev' | 'fwd'; svgRef: React.Ref<SVGSVGElement>; logo: boolean }) {
  const fs = useFigureSettings(), wm = logo ? fs.watermark : '', grp = logo ? fs.group : '';
  const shown = items.map((it, i) => ({ it, color: CMP[i % CMP.length], ...bestScan(it.curves) })).map((x) => ({ ...x, curves: x.curves.filter((c) => dir === 'both' || c.dir === dir) }));
  const all = shown.flatMap((x) => x.curves);
  const jmax = Math.max(0, ...all.flatMap((c) => c.J.filter((j, i) => c.V[i] >= -0.05 && Number.isFinite(j))));
  const vmax = Math.max(0, ...all.map((c) => (Number.isFinite(c.m.voc) ? c.m.voc : 0)));
  const X1 = Math.max(1.2, Math.ceil((vmax + 0.05) / 0.2) * 0.2), Y1 = Math.max(30, Math.ceil((jmax + 2) / 5) * 5);
  const X = (v: number) => L + (v / X1) * PW, Y = (j: number) => T + PH - (j / Y1) * PH;
  const xt = Array.from({ length: Math.round(X1 / 0.2) + 1 }, (_, i) => +(i * 0.2).toFixed(1)), yt = Array.from({ length: Y1 / 5 + 1 }, (_, i) => i * 5);
  const path = (c: Curve) => c.V.map((v, i) => [v, c.J[i]] as const).filter(([v, j]) => Number.isFinite(v) && Number.isFinite(j)).map(([v, j], i) => `${i ? 'L' : 'M'}${X(v).toFixed(1)},${Y(Math.max(-Y1, Math.min(Y1 * 2, j))).toFixed(1)}`).join('');
  const clip = useRef(`c${Math.random().toString(36).slice(2)}`).current;
  const legendRows = shown.length, LH = 19;
  return (
    <svg ref={svgRef} viewBox={`0 0 ${FW} ${FH}`} width={FW} height={FH} className="jv-figure" xmlns="http://www.w3.org/2000/svg" fontFamily={FONT} role="img" aria-label={`J–V curves of ${items.length} pixels`}>
      <rect width={FW} height={FH} fill="#fff" />
      <defs><clipPath id={clip}><rect x={L} y={T} width={PW} height={PH} /></clipPath></defs>
      {xt.map((t) => <line key={'gx' + t} x1={X(t)} x2={X(t)} y1={T} y2={T + PH} stroke={GRID} strokeDasharray="4 4" strokeWidth={0.8} />)}
      {yt.map((t) => <line key={'gy' + t} x1={L} x2={L + PW} y1={Y(t)} y2={Y(t)} stroke={GRID} strokeDasharray="4 4" strokeWidth={0.8} />)}
      {wm && <image href={wm} x={L + PW * 0.5 - 80} y={T + PH - (grp ? 96 : 78)} width={160} height={62} opacity={0.3} preserveAspectRatio="xMidYMax meet" />}
      {grp && <text x={L + PW * 0.5} y={T + PH - 16} fontSize={12.5} textAnchor="middle" fill={INK} opacity={0.5}>{grp}</text>}
      <g clipPath={`url(#${clip})`}>
        {shown.flatMap((x) => x.curves.map((c) => <path key={c.id} d={path(c)} fill="none" stroke={x.color} strokeWidth={2.2} strokeDasharray={c.dir === 'rev' ? '8 5' : undefined} strokeLinejoin="round" />))}
      </g>
      <rect x={L} y={T} width={PW} height={PH} fill="none" stroke={INK} strokeWidth={1.6} />
      {xt.map((t) => <g key={'tx' + t}><line x1={X(t)} x2={X(t)} y1={T + PH} y2={T + PH - 7} stroke={INK} strokeWidth={1.4} /><line x1={X(t)} x2={X(t)} y1={T} y2={T + 7} stroke={INK} strokeWidth={1.4} />
        <text x={X(t)} y={T + PH + 22} fontSize={16} textAnchor="middle" fill={INK}>{t.toFixed(1)}</text></g>)}
      {yt.map((t) => <g key={'ty' + t}><line x1={L} x2={L + 7} y1={Y(t)} y2={Y(t)} stroke={INK} strokeWidth={1.4} /><line x1={L + PW} x2={L + PW - 7} y1={Y(t)} y2={Y(t)} stroke={INK} strokeWidth={1.4} />
        <text x={L - 10} y={Y(t)} fontSize={16} textAnchor="end" dominantBaseline="central" fill={INK}>{t}</text></g>)}
      <text x={L + PW / 2} y={FH - 16} fontSize={19} textAnchor="middle" fill={INK}>Voltage (V)</text>
      <text transform={`translate(26 ${T + PH / 2}) rotate(-90)`} fontSize={19} textAnchor="middle" fill={INK}>J (mA/cm²)</text>
      {/* legend in the empty lower-left area under the curves */}
      <g transform={`translate(${L + 16} ${T + PH - 16 - (legendRows - 1) * LH - (dir === 'both' ? 2 * LH + 6 : 0)})`} fontSize={13} fill={INK}>
        {shown.map((x, i) => <g key={x.it.key} transform={`translate(0 ${i * LH})`}><line x1={0} x2={26} y1={0} y2={0} stroke={x.color} strokeWidth={3} /><text x={34} y={0} dominantBaseline="central">{x.it.label}{x.best ? ` (${fmt(x.best.m.pce)} %)` : ''}</text></g>)}
        {dir === 'both' && <g transform={`translate(0 ${legendRows * LH + 6})`} opacity={0.8}>
          <line x1={0} x2={26} y1={0} y2={0} stroke={INK} strokeWidth={2} /><text x={34} y={0} dominantBaseline="central">Forward</text>
          <line x1={0} x2={26} y1={LH} y2={LH} stroke={INK} strokeWidth={2} strokeDasharray="8 5" /><text x={34} y={LH} dominantBaseline="central">Backward</text>
        </g>}
      </g>
    </svg>
  );
}

/** Several standalone figures as one image, side by side (2 or 3 per row). */
function combine(svgs: SVGSVGElement[]) {
  const NS = 'http://www.w3.org/2000/svg', n = svgs.length, cols = n <= 3 ? n : n === 4 ? 2 : 3, rows = Math.ceil(n / cols);
  const w = svgs[0].viewBox.baseVal.width, h = svgs[0].viewBox.baseVal.height, out = document.createElementNS(NS, 'svg');
  out.setAttribute('viewBox', `0 0 ${cols * w} ${rows * h}`); out.setAttribute('width', String(cols * w)); out.setAttribute('height', String(rows * h)); out.setAttribute('xmlns', NS);
  const bg = document.createElementNS(NS, 'rect'); bg.setAttribute('width', String(cols * w)); bg.setAttribute('height', String(rows * h)); bg.setAttribute('fill', '#fff'); out.appendChild(bg);
  svgs.forEach((sv, i) => { const g = document.createElementNS(NS, 'g'); g.setAttribute('transform', `translate(${(i % cols) * w} ${Math.floor(i / cols) * h})`); for (const c of Array.from(sv.childNodes)) g.appendChild(c.cloneNode(true)); out.appendChild(g); });
  return out;
}

/**
 * The comparison above the cells: by default one J–V figure per pixel side by side (each in the usual journal style), or all
 * curves on one plot; their numbers, export, and a way to drop pixels or clear.
 */
export function ComparePanel({ items, onRemove, onClear }: { items: CmpItem[]; onRemove: (key: string) => void; onClear: () => void }) {
  const [dir, setDir] = useState<'both' | 'rev' | 'fwd'>('both'), fig = useRef<SVGSVGElement>(null), [err, setErr] = useState('');
  const [one, setOne] = useState(false), figs = useRef<(SVGSVGElement | null)[]>([]);
  const target = () => (one ? fig.current : figs.current.filter((x): x is SVGSVGElement => !!x).length ? combine(figs.current.filter((x): x is SVGSVGElement => !!x)) : null);
  const fs = useFigureSettings(), hasLogo = !!(fs.watermark || fs.group), [logo, setLogo] = useLogoChoice();
  const name = `JV-compare-${items.length}px`;
  return (
    <section className="group compare" aria-label="Compared pixels">
      <div className="inline compare-head">
        <h3>Comparing {items.length} pixel{items.length === 1 ? '' : 's'}</h3>
        <span className="mut small">Shift-click pixels on any substrate to add or drop them. Best scan of each pixel.</span>
        <div className="grow" />
        <label className="inline small"><Check v={one} on={setOne} /> All on one plot</label>
        <Seg small value={dir} on={setDir} opts={[['both', 'Both'], ['rev', 'Backward'], ['fwd', 'Forward']]} />
        <button className="link" onClick={onClear}>Clear</button>
      </div>
      {one ? <div className="fig-wrap"><CompareFigure items={items} dir={dir} svgRef={fig} logo={logo && hasLogo} /></div>
        : <div className="cmp-grid">{items.map((it, i) => { const b = bestScan(it.curves), cs = b.curves.filter((c) => dir === 'both' || c.dir === dir); return (
            <figure key={it.key} className="cmp-cell" style={{ '--cmp': CMP[i % CMP.length] } as React.CSSProperties}>
              <div className="fig-wrap"><JvFigure curves={cs} best={b.best && cs.includes(b.best) ? b.best : cs.filter((c) => c.m.status === 'ok').sort((x, y) => y.m.pce - x.m.pce)[0]} title={it.label} link={it.link ?? null} svgRef={(el) => { figs.current[i] = el; }} logo={logo && hasLogo} /></div>
            </figure>); })}</div>}
      <div className="inline">
        {hasLogo && <label className="inline small"><Check v={logo} on={setLogo} /> Group logo</label>}
        <button className="link" onClick={() => { const t = target(); if (t) exportSvg(t, name, 'png').catch((e) => setErr(e.message)); }}>Export PNG</button>
        <button className="link" onClick={() => { const t = target(); if (t) exportSvg(t, name, 'svg'); }}>Export SVG</button>
        {!one && items.length > 1 && <span className="mut small">exports all figures as one image</span>}
        {err && <span className="err small">{err}</span>}
      </div>
      <div className="scroll">
        <table className="pp-table">
          <thead><tr><th>Pixel</th><th>Scan</th><th>PCE (%)</th><th>Voc (V)</th><th>Jsc (mA/cm²)</th><th>FF (%)</th><th>Rs (Ω·cm²)</th><th>Rsh (Ω·cm²)</th><th /></tr></thead>
          <tbody>{items.map((it, i) => {
            const { curves } = bestScan(it.curves);
            return curves.filter((c) => dir === 'both' || c.dir === dir).map((c, k) => (
              <tr key={c.id}>
                {k === 0 && <td rowSpan={curves.filter((x) => dir === 'both' || x.dir === dir).length}><i className="swatch" style={{ background: CMP[i % CMP.length] }} />{it.label}</td>}
                <td>{c.dir === 'rev' ? 'Backward' : 'Forward'}{c.scan ? ` · ${c.scan}` : ''}</td>
                <td><b>{fmt(c.m.pce)}</b></td><td>{fmt(c.m.voc, 3)}</td><td>{fmt(c.m.jsc)}</td><td>{fmt(c.m.ff, 1)}</td><td>{fmt(c.m.rs, 1)}</td><td>{Number.isFinite(c.m.rsh) ? fmt(c.m.rsh, 0) : '—'}</td>
                {k === 0 && <td rowSpan={curves.filter((x) => dir === 'both' || x.dir === dir).length}><button className="link small" onClick={() => onRemove(it.key)}>Remove</button></td>}
              </tr>
            ));
          })}</tbody>
        </table>
      </div>
    </section>
  );
}
