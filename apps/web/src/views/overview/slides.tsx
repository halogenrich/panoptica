import { useEffect, useRef, useState } from 'react';
import { useFigureSettings, useLogoChoice } from '../../lib/figure';
import { exportSvg, JvFigure } from '../../iv/JvFigure';
import { api } from '../../api';
import { Modal } from '../../lib/ui';
import ExportMenu, { pngSvg, type ExportRow } from '../../lib/ExportMenu';
import { BFH, BFW, BoxFigure, OutlierToggle, TITLES, useOutliers } from '../../iv/BoxFigure';
import { boxes, dirsOf } from '../../iv/boxes';
import { METRICS, fmt, inStats, statRows, type Curve, type IvSetFull, type MetricKey } from '../../iv/model';

// ------------------------------------------------------------------ slides (16:9, for presenting)
export const SW = 1920,
  SH = 1080,
  SF = 'Inter, "Segoe UI", Helvetica, Arial, sans-serif',
  INK = '#15171a',
  MUT = '#5f6570',
  BLUE = '#2a78d6',
  ORANGE = '#eb6834',
  RULE = '#e3e5e8';
export function SlideFrame({
  title,
  sub,
  children,
  svgRef,
  compact,
}: {
  title: string;
  sub: string;
  children: React.ReactNode;
  svgRef: React.Ref<SVGSVGElement>;
  /** smaller title, for slides with several figures */
  compact?: boolean;
}) {
  const fs = useFigureSettings();
  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${SW} ${SH}`}
      width={SW}
      height={SH}
      xmlns="http://www.w3.org/2000/svg"
      fontFamily={SF}
    >
      <rect width={SW} height={SH} fill="#fff" />
      <text x={110} y={compact ? 112 : 150} fontSize={compact ? 52 : 64} fontWeight={700} fill={INK}>
        {title}
      </text>
      <text x={110} y={compact ? 162 : 210} fontSize={compact ? 28 : 32} fill={MUT}>
        {sub}
      </text>
      {children}
      {fs.watermark && (
        <image
          href={fs.watermark}
          x={SW - 330}
          y={SH - 130}
          width={220}
          height={80}
          preserveAspectRatio="xMaxYMax meet"
          opacity={0.85}
        />
      )}
      {fs.group && (
        <text x={fs.watermark ? SW - 350 : SW - 110} y={SH - 70} fontSize={24} fill={MUT} textAnchor="end">
          {fs.group}
        </text>
      )}
    </svg>
  );
}
export function SlideNumbers({ items, y }: { items: [string, string][]; y: number }) {
  const w = (SW - 220) / items.length;
  return (
    <g>
      {items.map(([k, v], i) => (
        <g key={k} transform={`translate(${110 + i * w} ${y})`}>
          <text fontSize={28} fill={MUT}>
            {k}
          </text>
          <text y={74} fontSize={64} fontWeight={600} fill={INK}>
            {v}
          </text>
        </g>
      ))}
    </g>
  );
}
export function SlideTrend({
  points,
  x,
  y,
  w,
  h,
  tickOf,
}: {
  points: { x: string; best: number | null; median: number | null }[];
  x: number;
  y: number;
  w: number;
  h: number;
  tickOf: (s: string) => string;
}) {
  const vals = points.flatMap((p) => [p.best, p.median]).filter((v): v is number => v != null);
  if (!vals.length)
    return (
      <text x={x} y={y + 60} fontSize={30} fill={MUT}>
        No working devices measured in this time.
      </text>
    );
  const lo = Math.max(0, Math.floor((Math.min(...vals) - 2) / 5) * 5),
    hi = Math.ceil((Math.max(...vals) + 1) / 5) * 5,
    L = 70,
    B = 50,
    PW = w - L - 250, // room on the right for the "Typical 21.2 %" labels
    PH = h - B;
  const X = (i: number) => x + L + (points.length === 1 ? PW / 2 : (i / (points.length - 1)) * PW),
    Y = (v: number) => y + PH - ((v - lo) / (hi - lo || 1)) * PH;
  const path = (k: 'best' | 'median') =>
    points
      .map((p, i) => (p[k] == null ? '' : `${i && points[i - 1][k] != null ? 'L' : 'M'}${X(i)},${Y(p[k]!)}`))
      .join('');
  const lastI = (k: 'best' | 'median') => {
    for (let i = points.length - 1; i >= 0; i--) if (points[i][k] != null) return i;
    return -1;
  };
  return (
    <g fontFamily={SF}>
      {Array.from({ length: Math.round((hi - lo) / 5) + 1 }, (_, i) => lo + i * 5).map((v) => (
        <g key={v}>
          <line x1={x + L} x2={x + L + PW} y1={Y(v)} y2={Y(v)} stroke={RULE} strokeWidth={2} />
          <text x={x + L - 16} y={Y(v)} fontSize={24} fill={MUT} textAnchor="end" dominantBaseline="central">
            {v} %
          </text>
        </g>
      ))}
      {points.map(
        (p, i) =>
          (i % Math.ceil(points.length / 8) === 0 || i === points.length - 1) && (
            <text key={i} x={X(i)} y={y + PH + 40} fontSize={24} fill={MUT} textAnchor="middle">
              {tickOf(p.x)}
            </text>
          ),
      )}
      {(
        [
          ['median', ORANGE],
          ['best', BLUE],
        ] as const
      ).map(([k, c]) => (
        <g key={k}>
          <path d={path(k)} fill="none" stroke={c} strokeWidth={5} strokeLinejoin="round" />
          {points.map(
            (p, i) =>
              p[k] != null && <circle key={i} cx={X(i)} cy={Y(p[k]!)} r={9} fill={c} stroke="#fff" strokeWidth={3} />,
          )}
          {lastI(k) >= 0 && (
            <text x={X(lastI(k)) + 20} y={Y(points[lastI(k)][k]!)} fontSize={28} fill={INK} dominantBaseline="central">
              {k === 'best' ? 'Best' : 'Typical'} {points[lastI(k)][k]!.toFixed(1)} %
            </text>
          )}
        </g>
      ))}
    </g>
  );
}
/** Renders a slide off screen, exports it, then removes it. */
export function useSlide() {
  const [node, setNode] = useState<{ el: React.ReactNode; name: string; as: 'png' | 'svg' } | null>(null),
    ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (node && ref.current) {
      const r = ref.current;
      setTimeout(() => exportSvg(r, node.name, node.as).finally(() => setNode(null)), 60);
    }
  }, [node]);
  const holder = node ? (
    <div className="slide-holder" aria-hidden>
      {node.el}
    </div>
  ) : null;
  return {
    ref,
    holder,
    make: (el: React.ReactNode, name: string, as: 'png' | 'svg' = 'png') => setNode({ el, name, as }),
  };
}
/** "Export" with the slide formats inside (the shared export menu), so it does not compete with the content. */
export function SlideButtons({
  onMake,
  extra,
}: {
  onMake: (as: 'png' | 'svg') => void;
  extra?: [string, (as: 'png' | 'svg') => void];
}) {
  return (
    <ExportMenu
      sections={[
        [
          'Slide (16:9)',
          [
            [extra ? 'Summary' : 'This page', pngSvg(onMake)],
            ...(extra ? [[extra[0], pngSvg(extra[1])] as ExportRow] : []),
          ],
        ],
      ]}
    />
  );
}

// ------------------------------------------------------------------ export for a presentation
export type TopCell = { pce: number; set: string; setId: number; sample: string; substrate: string; owner: string };
type Pt = { x: string; best: number | null; median: number | null };

/** The best cell of the period: its J–V curves (best pixel, both directions) and the statistics rows of its batch. */
function useBestCell(top: TopCell | undefined) {
  const [st, setSt] = useState<
    | { set: IvSetFull; curves: Curve[]; best: Curve; batch: ReturnType<typeof statRows>; group: string }
    | null
    | 'none'
    | string
  >(null);
  useEffect(() => {
    if (!top) return setSt('none');
    let on = true;
    api<IvSetFull>('/iv/' + top.setId)
      .then((set) => {
        const mine = set.curves.filter(
          (c) =>
            c.sample === top.sample && c.substrate === top.substrate && c.m.status === 'ok' && inStats(c, set.curves),
        );
        const best = mine.reduce<Curve | null>((b, c) => (!b || c.m.pce > b.m.pce ? c : b), null);
        if (!best) return on && setSt('none');
        const rows = statRows([set], 'both'),
          gkey = rows.find((r) => r.sample === top.sample && r.substrate === top.substrate)?.gkey,
          batch = rows.filter((r) => r.gkey === gkey);
        if (on)
          setSt({
            set,
            best,
            curves: mine.filter((c) => c.pixel === best.pixel),
            batch,
            group: batch[0]?.group ?? top.sample,
          });
      })
      .catch((e) => on && setSt(`The measurement of the best cell cannot be opened (${e.message}).`));
    return () => {
      on = false;
    };
  }, [top?.setId, top?.sample, top?.substrate]);
  return st;
}

/** Efficiency over time on its own, for a custom slide. */
function TrendFigure({
  points,
  tickOf,
  svgRef,
  title,
}: {
  points: Pt[];
  tickOf: (s: string) => string;
  svgRef?: React.Ref<SVGSVGElement>;
  title: string;
}) {
  return (
    <svg
      ref={svgRef}
      viewBox="0 0 1200 640"
      width={1200}
      height={640}
      xmlns="http://www.w3.org/2000/svg"
      fontFamily={SF}
    >
      <rect width={1200} height={640} fill="#fff" />
      <text x={40} y={56} fontSize={30} fontWeight={600} fill={INK}>
        {title}
      </text>
      <text x={40} y={92} fontSize={20} fill={MUT}>
        Best and typical (median) cell per period; each cell counts with its best working pixel
      </text>
      <SlideTrend points={points} x={40} y={140} w={1140} h={440} tickOf={tickOf} />
    </svg>
  );
}

/**
 * Export for a presentation: the full 16:9 slide (efficiency over time, the best cell's J–V curve, the box plots of its batch)
 * and each of those figures on its own, as PNG or SVG, to build a custom slide. Optionally a second slide (highlights).
 */
export function PresentationExport({
  label,
  points,
  tickOf,
  top,
  sub,
  file,
  extra,
  onClose,
}: {
  label: string;
  points: Pt[];
  tickOf: (s: string) => string;
  top: TopCell | undefined;
  sub: string;
  file: string;
  extra?: { name: string; render: (ref: React.Ref<SVGSVGElement>) => React.ReactNode };
  onClose: () => void;
}) {
  const cell = useBestCell(top),
    ok = cell && typeof cell === 'object' ? cell : null,
    fs = useFigureSettings(),
    [logo] = useLogoChoice(),
    [outl, setOutl] = useOutliers();
  const refs = {
    slide: useRef<SVGSVGElement>(null),
    trend: useRef<SVGSVGElement>(null),
    jv: useRef<SVGSVGElement>(null),
    box: useRef<SVGSVGElement>(null),
    extra: useRef<SVGSVGElement>(null),
  };
  const [busy, setBusy] = useState('');
  const run = (key: keyof typeof refs, name: string, as: 'png' | 'svg', scale = 3) => {
    const el = refs[key].current;
    if (!el) return;
    setBusy(key + as);
    exportSvg(el, name, as, scale).finally(() => setBusy(''));
  };
  const panels = ok
    ? (['jsc', 'ff', 'voc', 'pce'] as MetricKey[]).map((k) => {
        const m = METRICS.find((x) => x.key === k)!;
        return {
          key: k,
          title: TITLES[k],
          groups: boxes(ok.batch, dirsOf(ok.batch), k),
          unit: m.unit,
          digits: m.digits,
        };
      })
    : [];
  const jvTitle =
    ok && top
      ? `${top.owner} · ${top.sample.replace(/_/g, ' ')}, substrate ${top.substrate}, pixel ${ok.best.pixel}`
      : '';
  const figLogo = logo && (fs.watermark || fs.group) ? fs : undefined;
  // slide layout: efficiency over time and the J–V curve on the left, the batch's box plots and the cell's details on the right
  const JH = 375,
    JW = (700 * JH) / 500,
    BW = 800,
    BH = (BW * BFH) / BFW;
  const slide = (
    <SlideFrame svgRef={refs.slide} title="Lab overview" sub={sub} compact>
      <text x={110} y={240} fontSize={28} fontWeight={600} fill={INK}>
        Efficiency over time
      </text>
      <SlideTrend points={points} x={80} y={270} w={900} h={300} tickOf={tickOf} />
      {ok ? (
        <>
          <text x={110} y={660} fontSize={28} fontWeight={600} fill={INK}>
            Best cell: J–V
          </text>
          <svg x={110} y={675} width={JW} height={JH} viewBox="0 0 700 500">
            <JvFigure
              curves={ok.curves}
              best={ok.best}
              title={jvTitle}
              link={ok.set.links[ok.best.sample] ?? null}
              logo={false}
            />
          </svg>
          <text x={1050} y={240} fontSize={28} fontWeight={600} fill={INK}>
            {`Its batch: ${ok.group}`}
          </text>
          <svg x={1040} y={260} width={BW} height={BH} viewBox={`0 0 ${BFW} ${BFH}`}>
            <BoxFigure panels={panels} outliers={outl} />
          </svg>
          <g fontSize={26} fill={INK}>
            <text x={1050} y={BH + 320}>
              <tspan fontWeight={700}>{`Best cell ${fmt(ok.best.m.pce)} %`}</tspan>
              <tspan fill={MUT}>{`  ${top!.owner}`}</tspan>
            </text>
            <text x={1050} y={BH + 360} fill={MUT}>
              {`${top!.sample.replace(/_/g, ' ')}, substrate ${top!.substrate}, pixel ${ok.best.pixel}, ${ok.best.dir === 'rev' ? 'backward' : 'forward'} scan`}
            </text>
            <text x={1050} y={BH + 400} fill={MUT}>
              {`Batch: ${ok.batch.filter((r) => r.dir === ok.best.dir).length} working pixels · measurement ${ok.set.name}`}
            </text>
          </g>
        </>
      ) : (
        <text x={1050} y={300} fontSize={28} fill={MUT}>
          {cell === null
            ? 'Loading the best cell…'
            : cell === 'none'
              ? 'No working cell measured in this period.'
              : String(cell)}
        </text>
      )}
    </SlideFrame>
  );
  const row = (key: keyof typeof refs, title: string, note: string, name: string, enabled = true, scale = 3) => (
    <li className="pe-row">
      <div>
        <b>{title}</b>
        <span className="mut small">{note}</span>
      </div>
      <button
        className="btn secondary small-btn"
        disabled={!enabled || !!busy}
        onClick={() => run(key, name, 'png', scale)}
      >
        {busy === key + 'png' ? 'Saving…' : 'PNG'}
      </button>
      <button className="link" disabled={!enabled || !!busy} onClick={() => run(key, name, 'svg', scale)}>
        SVG
      </button>
    </li>
  );
  return (
    <Modal onClose={onClose}>
      <header className="modal-head">
        <h2>Export for a presentation</h2>
        <div className="grow" />
        <button className="link" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="modal-body pe">
        <div className="pe-preview" aria-label="Preview of the slide">
          {slide}
        </div>
        <ul className="pe-list">
          {row(
            'slide',
            'Full slide (16:9)',
            'All three figures with the title and the group logo, ready to drop into a deck',
            `overview-${file}`,
            true,
            2,
          )}
          {row('trend', 'Efficiency over time', 'Best and typical cell per period', `efficiency-${file}`)}
          {row(
            'jv',
            'Best cell: J–V curve',
            ok ? jvTitle : 'No best cell in this period',
            `best-cell-jv-${file}`,
            !!ok,
          )}
          {row(
            'box',
            'Box plots of its batch',
            ok ? `${ok.group}: Jsc, FF, Voc and PCE` : 'No best cell in this period',
            `best-cell-batch-${file}`,
            !!ok,
          )}
          {extra &&
            row(
              'extra',
              `${extra.name} slide (16:9)`,
              'Record, batches, measurements and best cells in words',
              `${extra.name.toLowerCase()}-${file}`,
              true,
              2,
            )}
        </ul>
        {ok && <OutlierToggle v={outl} on={setOutl} />}
        <p className="mut small">
          PNG for PowerPoint or Google Slides; SVG stays sharp at any size and can be edited (Inkscape, Illustrator).{' '}
          {label}.
        </p>
      </div>
      {/* the single figures, drawn off screen at full size for export */}
      <div className="slide-holder" aria-hidden>
        <TrendFigure svgRef={refs.trend} points={points} tickOf={tickOf} title="Efficiency over time" />
        {ok && (
          <JvFigure
            svgRef={refs.jv}
            curves={ok.curves}
            best={ok.best}
            title={jvTitle}
            link={ok.set.links[ok.best.sample] ?? null}
            logo={logo}
          />
        )}
        {ok && (
          <div style={{ width: BFW }}>
            <BoxFigure svgRef={refs.box} panels={panels} logo={figLogo} outliers={outl} />
          </div>
        )}
        {extra?.render(refs.extra)}
      </div>
    </Modal>
  );
}
