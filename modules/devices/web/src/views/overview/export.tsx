import { useEffect, useRef, useState } from 'react';
import { useFigureSettings, useLogoChoice } from '@web/lib/figure';
import { exportSvg, JvFigure } from '../../iv/JvFigure';
import { api } from '@web/api';
import { Modal, Seg } from '@web/lib/ui';
import { BFH, BFW, BoxFigure, OutlierToggle, TITLES, useOutliers } from '../../iv/BoxFigure';
import { boxes, dirsOf } from '../../iv/boxes';
import { METRICS, fmt, inStats, statRows, type Curve, type IvSetFull, type MetricKey } from '../../iv/model';
import { BLUE, INK, MUT, ORANGE, RULE, SF, SlideFrame } from '@web/views/overview/slides';

/** Electronic Devices' slides: devices over time, and "Export for a presentation" on My progress (devices over time, the best
 * device's J–V curve, the box plot of its batch). */
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
  // end labels apart when the lines end together (one device: best = median)
  const endY = (k: 'best' | 'median') => {
    const b = lastI('best'),
      m = lastI('median'),
      y = Y(points[lastI(k)][k]!);
    if (b < 0 || m < 0 || b !== m) return y;
    const gap = Y(points[m].median!) - Y(points[b].best!);
    return gap >= 34 ? y : k === 'best' ? y - (34 - gap) / 2 : y + (34 - gap) / 2;
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
            <text x={X(lastI(k)) + 20} y={endY(k)} fontSize={28} fill={INK} dominantBaseline="central">
              {k === 'best' ? 'Best' : 'Typical'} {points[lastI(k)][k]!.toFixed(1)} %
            </text>
          )}
        </g>
      ))}
    </g>
  );
}
// ------------------------------------------------------------------ export for a presentation
/** A device: the measurement and the sample and substrate in it; with the batch its sample is linked to, when there is one. */
export type TopCell = {
  pce: number;
  set: string;
  setId: number;
  sample: string;
  substrate: string;
  owner: string;
  batchId?: number | null;
  batch?: string;
};
type Pt = { x: string; best: number | null; median: number | null };
type Rows = ReturnType<typeof statRows>;
export type BestCell = { set: IvSetFull; curves: Curve[]; best: Curve; batch: Rows; group: string };

/**
 * A device's J–V curves (its best pixel, both directions) and the statistics rows of its batch: with `batchId` (My progress,
 * 0.60), every measurement linked to the batch, grouped by variant; otherwise the device's group in its own measurement.
 */
export function useBestCell(top: TopCell | undefined | null) {
  const [st, setSt] = useState<BestCell | null | 'none' | string>(null);
  useEffect(() => {
    if (!top) return setSt('none');
    let on = true;
    setSt(null);
    (async () => {
      const set = await api<IvSetFull>('/iv/' + top.setId);
      const mine = set.curves.filter(
        (c) =>
          c.sample === top.sample && c.substrate === top.substrate && c.m.status === 'ok' && inStats(c, set.curves),
      );
      const best = mine.reduce<Curve | null>((b, c) => (!b || c.m.pce > b.m.pce ? c : b), null);
      if (!best) return on && setSt('none');
      let batch: Rows = [],
        group = '';
      if (top.batchId) {
        // the whole batch: its measurements and, in each, the samples linked to it
        const list = await api<{ id: number; linkedSamples: string[] }[]>(`/batches/${top.batchId}/iv`).catch(() => []);
        const fulls = await Promise.all(
          list.map((x) => (x.id === set.id ? set : api<IvSetFull>('/iv/' + x.id).catch(() => null))),
        );
        batch = fulls.flatMap((f, i) =>
          f ? statRows([f], 'both').filter((r) => list[i].linkedSamples.includes(r.sample)) : [],
        );
        group = top.batch ?? batch[0]?.group ?? '';
      }
      if (!batch.length) {
        const rows = statRows([set], 'both'),
          gkey = rows.find((r) => r.sample === top.sample && r.substrate === top.substrate)?.gkey;
        batch = rows.filter((r) => r.gkey === gkey);
        group = batch[0]?.group ?? top.sample;
      }
      if (on) setSt({ set, best, curves: mine.filter((c) => c.pixel === best.pixel), batch, group });
    })().catch((e) => on && setSt(`The measurement of the best device cannot be opened (${e.message}).`));
    return () => {
      on = false;
    };
  }, [top?.setId, top?.sample, top?.substrate, top?.batchId]);
  return st;
}

/** Efficiency over time on its own, for a custom slide. */
function TrendFigure({
  points,
  tickOf,
  svgRef,
  title,
  note,
}: {
  points: Pt[];
  tickOf: (s: string) => string;
  svgRef?: React.Ref<SVGSVGElement>;
  title: string;
  note: string;
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
        {note}
      </text>
      <SlideTrend points={points} x={40} y={140} w={1140} h={440} tickOf={tickOf} />
    </svg>
  );
}

type BoxPick = MetricKey | 'all';
const BOX_PICKS: [BoxPick, string][] = [
  ['pce', 'PCE'],
  ['voc', 'Voc'],
  ['jsc', 'Jsc'],
  ['ff', 'FF'],
  ['all', 'All four'],
];
const PICKED = 'psc-slide-box';

/**
 * Export for a presentation (My progress, 0.60): a 16:9 slide with the devices over time, the best device's J–V curve and the
 * box plot of its batch, and each figure on its own, as PNG or SVG. The box plot is chosen over the preview: PCE, Voc, Jsc or FF,
 * or all four (Richard); the choice is remembered in this browser.
 */
export function PresentationExport({
  title,
  sub,
  points,
  tickOf,
  trendTitle,
  trendNote,
  top,
  file,
  onClose,
}: {
  title: string;
  sub: string;
  points: Pt[];
  tickOf: (s: string) => string;
  trendTitle: string;
  trendNote: string;
  top: TopCell | null | undefined;
  file: string;
  onClose: () => void;
}) {
  const cell = useBestCell(top),
    ok = cell && typeof cell === 'object' ? cell : null,
    fs = useFigureSettings(),
    [logo] = useLogoChoice(),
    [outl, setOutl] = useOutliers(),
    [pick, setPickState] = useState<BoxPick>(() => {
      try {
        const v = localStorage.getItem(PICKED) as BoxPick | null;
        return v && BOX_PICKS.some(([k]) => k === v) ? v : 'pce';
      } catch {
        return 'pce';
      }
    });
  const setPick = (v: BoxPick) => {
    setPickState(v);
    try {
      localStorage.setItem(PICKED, v);
    } catch {
      /* private window */
    }
  };
  const refs = {
    slide: useRef<SVGSVGElement>(null),
    trend: useRef<SVGSVGElement>(null),
    jv: useRef<SVGSVGElement>(null),
    box: useRef<SVGSVGElement>(null),
  };
  const [busy, setBusy] = useState('');
  const run = (key: keyof typeof refs, name: string, as: 'png' | 'svg', scale = 3) => {
    const el = refs[key].current;
    if (!el) return;
    setBusy(key + as);
    exportSvg(el, name, as, scale).finally(() => setBusy(''));
  };
  const keys: MetricKey[] = pick === 'all' ? ['jsc', 'ff', 'voc', 'pce'] : [pick];
  const panels = ok
    ? keys.map((k) => {
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
  const boxName = pick === 'all' ? 'Jsc, FF, Voc and PCE' : BOX_PICKS.find(([k]) => k === pick)![1];
  const jvTitle =
    ok && top
      ? `${top.owner} · ${top.sample.replace(/_/g, ' ')}, substrate ${top.substrate}, pixel ${ok.best.pixel}`
      : '';
  const figLogo = logo && fs.watermark ? fs : undefined;
  // slide: the devices over time and the J–V curve on the left, the batch's box plot and the device's details on the right
  const JH = 375,
    JW = (700 * JH) / 500,
    BW = 800,
    BH = (BW * BFH) / BFW;
  const slide = (
    <SlideFrame svgRef={refs.slide} title={title} sub={sub} compact>
      <text x={110} y={240} fontSize={28} fontWeight={600} fill={INK}>
        {trendTitle}
      </text>
      <SlideTrend points={points} x={80} y={270} w={900} h={300} tickOf={tickOf} />
      {ok ? (
        <>
          <text x={110} y={660} fontSize={28} fontWeight={600} fill={INK}>
            Best device: J–V
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
              <tspan fontWeight={700}>{`Best device ${fmt(ok.best.m.pce)} %`}</tspan>
              <tspan
                fill={MUT}
              >{`  Voc ${fmt(ok.best.m.voc, 3)} V · Jsc ${fmt(ok.best.m.jsc)} mA/cm² · FF ${fmt(ok.best.m.ff, 1)} %`}</tspan>
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
            ? 'Loading the best device…'
            : cell === 'none'
              ? 'No working device measured yet.'
              : String(cell)}
        </text>
      )}
    </SlideFrame>
  );
  const row = (key: keyof typeof refs, name: string, note: string, fileName: string, enabled = true, scale = 3) => (
    <li className="pe-row">
      <div>
        <b>{name}</b>
        <span className="mut small">{note}</span>
      </div>
      <button
        className="btn secondary small-btn"
        disabled={!enabled || !!busy}
        onClick={() => run(key, fileName, 'png', scale)}
      >
        {busy === key + 'png' ? 'Saving…' : 'PNG'}
      </button>
      <button className="link" disabled={!enabled || !!busy} onClick={() => run(key, fileName, 'svg', scale)}>
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
        <div className="pe-pick">
          <span className="mut small">Box plot on the slide</span>
          <Seg value={pick} on={setPick} small opts={BOX_PICKS} />
          {ok && <OutlierToggle v={outl} on={setOutl} />}
        </div>
        <div className="pe-preview" aria-label="Preview of the slide">
          {slide}
        </div>
        <ul className="pe-list">
          {row(
            'slide',
            'Full slide (16:9)',
            'The three figures with the title and the lab logo',
            `progress-${file}`,
            true,
            2,
          )}
          {row('trend', trendTitle, 'Best and typical device of each', `devices-over-time-${file}`)}
          {row('jv', 'Best device: J–V curve', ok ? jvTitle : 'No working device yet', `best-device-jv-${file}`, !!ok)}
          {row(
            'box',
            'Box plot of its batch',
            ok ? `${ok.group}: ${boxName}` : 'No working device yet',
            `best-device-batch-${file}`,
            !!ok,
          )}
        </ul>
        <p className="mut small">
          PNG for PowerPoint or Google Slides; SVG stays sharp at any size and can be edited (Inkscape, Illustrator).
        </p>
      </div>
      {/* the single figures, drawn off screen at full size for export */}
      <div className="slide-holder" aria-hidden>
        <TrendFigure svgRef={refs.trend} points={points} tickOf={tickOf} title={trendTitle} note={trendNote} />
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
      </div>
    </Modal>
  );
}
