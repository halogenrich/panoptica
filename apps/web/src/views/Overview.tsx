import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRefresh } from '../lib/trash';
import { api } from '../api';
import Avatar from '../lib/Avatar';
import { Seg, fmtDate } from '../lib/ui';
import {
  BLUE,
  INK,
  MUT,
  ORANGE,
  SW,
  SlideButtons,
  SlideFrame,
  SlideNumbers,
  SlideTrend,
  useSlide,
  PresentationExport,
} from './overview/slides';
import type { Tag } from '../ctx';

type Unit = 'week' | 'month';
type Person = {
  id: number;
  name: string;
  username: string;
  photoV?: number;
  last_seen: string | null;
  role: string;
  tags: Tag[];
  batchesStarted: number;
  batchesDone: number;
  running: number;
  measurements: number;
  devices: number;
  best: number | null;
  median: number | null;
  bestEver: number | null;
  hours: number;
};
type Eq = {
  id: number;
  name: string;
  color: string;
  hours: number;
  use: number;
  bookings: number;
  byUser: { name: string; hours: number }[];
  done: number;
  postponed: number;
  canceled: number;
};
type Dash = {
  from: string;
  to: string;
  unit: Unit;
  lab: {
    batchesStarted: number;
    batchesDone: number;
    running: number;
    measurements: number;
    devices: number;
    best: number | null;
    median: number | null;
    hours: number;
    workHours: number;
  };
  trend: { start: string; best: number | null; median: number | null; devices: number }[];
  people: Person[];
  equipment: Eq[];
  digest: {
    top: {
      pce: number;
      set: string;
      setId: number;
      sample: string;
      substrate: string;
      owner: string;
      system: string;
    }[];
    record: { pce: number; set: string; owner: string; before: number | null } | null;
    finished: { id: number; code: string; name: string; owner: string }[];
    started: { id: number; code: string; name: string; owner: string; status: string }[];
    measurements: { id: number; name: string; owner: string; devices: number; best: number }[];
    setbacks: {
      id: number;
      outcome: string;
      reason: string;
      equipment: string;
      batch: string;
      step: string;
      user: string;
      start: string;
    }[];
    waiting: number;
  };
};
type PersonPage = {
  id: number;
  name: string;
  username: string;
  photoV?: number;
  last_seen: string | null;
  created_at: string;
  tags: Tag[];
  progress: {
    id: number;
    name: string;
    day: string;
    system: string;
    devices: number;
    best: number | null;
    median: number | null;
  }[];
  batches: { id: number; code: string; name: string; status: string; created_at: string }[];
  hours: { name: string; color: string; hours: number; n: number }[];
  setbacks: { outcome: string; reason: string; start: string; step: string; equipment: string; batch: string }[];
};

// ------------------------------------------------------------------ periods
const sod = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const startOf = (d: Date, u: Unit) =>
  u === 'month'
    ? new Date(d.getFullYear(), d.getMonth(), 1)
    : (() => {
        const x = sod(d);
        x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
        return x;
      })();
const endOf = (s: Date, u: Unit) =>
  u === 'month'
    ? new Date(s.getFullYear(), s.getMonth() + 1, 1)
    : new Date(s.getFullYear(), s.getMonth(), s.getDate() + 7);
const periodName = (s: Date, u: Unit) => {
  if (u === 'month') return s.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const e = new Date(endOf(s, u).getTime() - 864e5);
  return `${s.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${e.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
};
const tick = (iso: string, u: Unit) =>
  new Date(iso).toLocaleDateString(undefined, u === 'month' ? { month: 'short' } : { day: 'numeric', month: 'short' });
const pct = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(d)} %`);
const hrs = (h: number) => (h >= 10 ? `${Math.round(h)} h` : `${(Math.round(h * 2) / 2).toString()} h`);
const seen = (iso: string | null) => {
  if (!iso) return 'never';
  const m = (Date.now() - new Date(iso).getTime()) / 6e4;
  return m < 2
    ? 'online now'
    : m < 60
      ? `${Math.round(m)} min ago`
      : m < 1440
        ? `${Math.round(m / 60)} h ago`
        : fmtDate(iso);
};
const STATUS: Record<string, string> = { planned: 'Planned', running: 'Running', done: 'Done' };

/**
 * Overview for the Professor and Managers: the lab in a week or a month, in plain words first and details on request.
 * Summary (a sentence, three numbers, the trend, who was active, details folded), People (cards, one page each) and
 * Equipment (how busy each instrument was). Each view exports a 16:9 slide.
 */
export default function Overview({
  onOpenBatch,
  onOpenIv,
}: {
  onOpenBatch?: (id: number) => void;
  onOpenIv?: (id: number) => void;
}) {
  const [unit, setUnit] = useState<Unit>(() => {
    try {
      return (localStorage.getItem('psc-ov-unit') as Unit) || 'week';
    } catch {
      return 'week';
    }
  });
  const [start, setStart] = useState(() => startOf(new Date(), 'week')),
    [tab, setTab] = useState<'lab' | 'people' | 'equipment'>('lab');
  const [d, setD] = useState<Dash | null>(null),
    [err, setErr] = useState(''),
    [person, setPerson] = useState<number | null>(null);
  const s = startOf(start, unit),
    e = endOf(s, unit);
  const loadDash = () =>
    api<Dash>(`/dashboard?from=${s.toISOString()}&to=${e.toISOString()}&unit=${unit}`)
      .then(setD)
      .catch((x) => setErr(x.message));
  useEffect(() => {
    setD(null);
    loadDash();
  }, [s.getTime(), unit]);
  useRefresh(loadDash, ['batches', 'iv', 'calendar', 'users']);
  const pickUnit = (u: Unit) => {
    setUnit(u);
    setStart(startOf(start, u));
    try {
      localStorage.setItem('psc-ov-unit', u);
    } catch {
      /* ignore */
    }
  };
  const step = (k: number) =>
    setStart(
      unit === 'month'
        ? new Date(s.getFullYear(), s.getMonth() + k, 1)
        : new Date(s.getFullYear(), s.getMonth(), s.getDate() + 7 * k),
    );
  const label = periodName(s, unit);
  return (
    <div className="ov">
      <div className="cal-bar">
        <div className="cal-nav">
          <button className="btn secondary" onClick={() => setStart(startOf(new Date(), unit))}>
            This {unit}
          </button>
          <button className="iconbtn" aria-label="Previous" onClick={() => step(-1)}>
            ‹
          </button>
          <button className="iconbtn" aria-label="Next" onClick={() => step(1)}>
            ›
          </button>
          <h2 className="cal-title">{label}</h2>
        </div>
        <div className="grow" />
        <Seg
          value={unit}
          on={pickUnit}
          small
          opts={[
            ['week', 'Week'],
            ['month', 'Month'],
          ]}
        />
      </div>
      {person === null && (
        <Seg
          value={tab}
          on={setTab}
          small
          opts={[
            ['lab', 'Summary'],
            ['people', 'People'],
            ['equipment', 'Equipment'],
          ]}
        />
      )}
      {err && <p className="err">{err}</p>}
      {person !== null ? (
        <Person id={person} onBack={() => setPerson(null)} onOpenBatch={onOpenBatch} onOpenIv={onOpenIv} />
      ) : !d ? (
        <p className="mut">Loading…</p>
      ) : tab === 'lab' ? (
        <Summary d={d} label={label} onPerson={setPerson} onOpenBatch={onOpenBatch} onOpenIv={onOpenIv} />
      ) : tab === 'people' ? (
        <People d={d} onPerson={setPerson} />
      ) : (
        <Equipment d={d} label={label} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ pieces
/** A few key numbers as cards: a plain label, one big value, one line of context. */
function Stats({
  items,
}: {
  items: { label: string; value: string; note?: React.ReactNode; tone?: 'best' | 'median' }[];
}) {
  return (
    <div className="ov-stats">
      {items.map((x) => (
        <div key={x.label} className={'ov-stat' + (x.tone ? ' t-' + x.tone : '')}>
          <span className="ov-stat-k">{x.label}</span>
          <b className="ov-stat-v">{x.value}</b>
          {x.note && <span className="ov-stat-n">{x.note}</span>}
        </div>
      ))}
    </div>
  );
}
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
/** One line about a person in this period, in words. */
function doing(p: Person) {
  const bits = [
    p.batchesStarted ? `started ${plural(p.batchesStarted, 'batch', 'batches')}` : '',
    p.running ? `${p.running} running` : '',
    p.devices ? `measured ${plural(p.devices, 'cell')} (best ${pct(p.best)})` : '',
    p.hours ? `${hrs(p.hours)} on equipment` : '',
  ].filter(Boolean);
  return bits.length ? bits.join(' · ') : 'Nothing this period';
}
const PersonCard = ({ p, onPerson }: { p: Person; onPerson: (id: number) => void }) => (
  <button className="ov-pcard" onClick={() => onPerson(p.id)}>
    <Avatar id={p.id} name={p.name} photoV={p.photoV} size={40} />
    <span className="ov-pcard-t">
      <b>{p.name}</b>
      <span className="mut small">{p.tags.map((t) => t.name).join(', ') || seen(p.last_seen)}</span>
      <span className="ov-pcard-d">{doing(p)}</span>
    </span>
    <span className="ov-chev" aria-hidden>
      ›
    </span>
  </button>
);
/** Collapsible block for the details people only sometimes want. */
const More = ({
  title,
  count,
  children,
  open,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
  open?: boolean;
}) => (
  <details className="ov-more" open={open}>
    <summary>
      <span>{title}</span>
      {count != null && <span className="ov-count">{count}</span>}
    </summary>
    <div className="ov-more-b">{children}</div>
  </details>
);

/**
 * Best and median device efficiency per period (or per measurement): one axis, two lines labelled at their ends, a crosshair
 * with the values on hover, and a table view for exact numbers.
 */
function LineChart({
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
          Best cell
        </span>
        <span className="ov-key">
          <i className="k-median" />
          Typical cell
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
              <th>Best cell</th>
              <th>Typical cell (median)</th>
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
                <text x={X(last(k)) + 10} y={Y(points[last(k)][k]!)} dominantBaseline="central" className="viz-label">
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

// ------------------------------------------------------------------ Summary (the lab and what happened, in one page)
function Summary({
  d,
  label,
  onPerson,
  onOpenBatch,
  onOpenIv,
}: {
  d: Dash;
  label: string;
  onPerson: (id: number) => void;
  onOpenBatch?: (id: number) => void;
  onOpenIv?: (id: number) => void;
}) {
  const [exporting, setExporting] = useState(false),
    g = d.digest,
    L = d.lab,
    active = d.people.filter((p) => p.batchesStarted || p.measurements || p.hours > 0 || p.running);
  // start the chart at the first period with cells (at least the last 4), so a new lab is not a mostly empty axis
  const first = d.trend.findIndex((t) => t.devices > 0),
    from = first < 0 ? d.trend.length - 4 : Math.min(first, d.trend.length - 4);
  const points = d.trend
    .slice(Math.max(0, from))
    .map((t) => ({ x: t.start, best: t.best, median: t.median, n: t.devices }));
  const top = g.top[0],
    period = d.unit === 'week' ? 'this week' : 'this month';
  // the period in one or two plain sentences
  const lede = [
    L.batchesStarted || L.devices
      ? `The lab started ${plural(L.batchesStarted, 'batch', 'batches')} and measured ${plural(L.devices, 'cell')}${g.measurements.length ? ` in ${plural(g.measurements.length, 'measurement')}` : ''}.`
      : `No batches started and no cells measured ${period}.`,
    L.running ? `${plural(L.running, 'batch is', 'batches are')} in progress.` : '',
    L.batchesDone ? `${plural(L.batchesDone, 'batch', 'batches')} finished.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const attention = g.setbacks.length + g.waiting;
  // slides
  const lines = [
    g.record
      ? `New lab record: ${g.record.pce.toFixed(2)} % by ${g.record.owner}${g.record.before ? ` (was ${g.record.before.toFixed(2)} %)` : ''}`
      : null,
    `${plural(g.started.length, 'batch', 'batches')} started, ${g.finished.length} finished`,
    `${plural(g.measurements.length, 'measurement')}, ${plural(L.devices, 'working cell')}`,
    g.setbacks.length ? `${plural(g.setbacks.length, 'step')} postponed or canceled` : 'No steps postponed or canceled',
  ].filter(Boolean) as string[];
  const highlights = (ref: React.Ref<SVGSVGElement>) => (
    <SlideFrame svgRef={ref} title={`${d.unit === 'week' ? 'Week' : 'Month'} in the lab`} sub={label}>
      <g transform="translate(110 330)">
        {lines.map((l, i) => (
          <g key={i} transform={`translate(0 ${i * 74})`}>
            <circle cx={12} cy={-12} r={8} fill={i === 0 && g.record ? ORANGE : BLUE} />
            <text x={40} fontSize={40} fill={INK}>
              {l}
            </text>
          </g>
        ))}
      </g>
      <g transform={`translate(110 ${330 + lines.length * 74 + 70})`}>
        <text fontSize={30} fill={MUT}>
          Best cells
        </text>
        {g.top.slice(0, 4).map((t, i) => (
          <text key={i} y={56 + i * 52} fontSize={34} fill={INK}>
            {t.pce.toFixed(2)} % {t.owner}, {t.sample.replace(/_/g, ' ')} substrate {t.substrate}
          </text>
        ))}
      </g>
    </SlideFrame>
  );
  const sub = `${label} · best cell ${pct(L.best, 2)} · typical ${pct(L.median)} · ${plural(L.devices, 'cell')} measured · ${plural(L.batchesStarted, 'batch', 'batches')} started`;
  return (
    <div className="ov-body">
      <div className="ov-intro">
        <p className="ov-lede">{lede}</p>
        <button className="btn secondary small-btn ov-exp-btn" onClick={() => setExporting(true)}>
          Export for a presentation
        </button>
      </div>
      {g.record && (
        <div className="ov-record">
          <span className="ov-record-k">New lab record</span>
          <b>{g.record.pce.toFixed(2)} %</b>
          <span>
            by {g.record.owner}
            {g.record.before ? `, up from ${g.record.before.toFixed(2)} %` : ''}
          </span>
          <button className="link small" onClick={() => onOpenIv?.(top?.setId ?? 0)}>
            {g.record.set}
          </button>
        </div>
      )}
      <Stats
        items={[
          {
            label: 'Best cell',
            value: pct(L.best, 2),
            tone: 'best',
            note: top ? (
              <>
                {top.owner}
                {top.sample ? `, ${top.sample.replace(/_/g, ' ')}` : ''}
              </>
            ) : (
              'No cells measured'
            ),
          },
          {
            label: 'Typical cell',
            value: pct(L.median, 1),
            tone: 'median',
            note: L.devices ? `median of ${plural(L.devices, 'cell')}` : '—',
          },
          {
            label: 'Batches',
            value: String(L.batchesStarted),
            note: `started · ${L.batchesDone} finished · ${L.running} in progress`,
          },
        ]}
      />
      {attention > 0 && (
        <More
          title={[
            g.setbacks.length ? `${plural(g.setbacks.length, 'step')} postponed or canceled` : '',
            g.waiting ? `${plural(g.waiting, 'step')} waiting for an answer` : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        >
          {g.setbacks.length ? (
            <ul className="ov-list">
              {g.setbacks.map((x) => (
                <li key={x.id}>
                  <span className={'oc oc-' + x.outcome}>{x.outcome === 'postponed' ? 'Postponed' : 'Canceled'}</span>
                  <span>
                    {x.user}: {x.equipment}, {x.batch}
                    {x.step ? ` (${x.step})` : ''}
                  </span>
                  <span className="mut small">{x.reason}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {g.waiting > 0 && (
            <p className="mut small">
              {g.waiting === 1 ? 'One booked step has ended and its' : `${g.waiting} booked steps have ended and their`}{' '}
              outcome is not filled in yet. The person who booked it is asked when they open the app.
            </p>
          )}
        </More>
      )}
      <section className="group">
        <h4 className="ov-h">Efficiency over time</h4>
        <LineChart
          h={220}
          points={points}
          xLabel={d.unit === 'week' ? 'Week' : 'Month'}
          unitTick={(x) => tick(x, d.unit)}
          empty={`No cells measured in the last 12 ${d.unit}s.`}
        />
        <p className="mut small ov-foot">
          A cell counts with its best working pixel. Stability follow-ups are not included.
        </p>
      </section>
      <section className="ov-sec">
        <h4 className="ov-h">Who was active</h4>
        {active.length ? (
          <div className="ov-people">
            {active.map((p) => (
              <PersonCard key={p.id} p={p} onPerson={onPerson} />
            ))}
          </div>
        ) : (
          <p className="mut">Nobody started a batch, measured or booked equipment {period}.</p>
        )}
      </section>
      <section className="ov-sec">
        <h4 className="ov-h">Details</h4>
        <More title="Best cells" count={g.top.length}>
          {g.top.length ? (
            <ol className="ov-list num">
              {g.top.map((t, i) => (
                <li key={i}>
                  <b>{t.pce.toFixed(2)} %</b>
                  <span>{t.owner}</span>
                  <span className="mut small">
                    {t.sample.replace(/_/g, ' ')}, substrate {t.substrate}
                  </span>
                  <span className="grow" />
                  <button className="link small" onClick={() => onOpenIv?.(t.setId)}>
                    {t.set}
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mut">No working cells measured.</p>
          )}
        </More>
        <More title="Batches started or finished" count={new Set([...g.finished, ...g.started].map((b) => b.id)).size}>
          {g.finished.length + g.started.length ? (
            <ul className="ov-list">
              {g.finished.map((b) => (
                <li key={'f' + b.id}>
                  <span className="status-pill st-done">Done</span>
                  <button className="link" onClick={() => onOpenBatch?.(b.id)}>
                    {b.code}
                  </button>
                  <span className="mut small">{b.owner}</span>
                </li>
              ))}
              {g.started
                .filter((b) => !g.finished.some((f) => f.id === b.id))
                .map((b) => (
                  <li key={'s' + b.id}>
                    <span className={'status-pill st-' + b.status}>{STATUS[b.status]}</span>
                    <button className="link" onClick={() => onOpenBatch?.(b.id)}>
                      {b.code}
                    </button>
                    <span className="mut small">{b.owner}</span>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="mut">No batches started or finished.</p>
          )}
        </More>
        <More title="Measurements" count={g.measurements.length}>
          {g.measurements.length ? (
            <ul className="ov-list">
              {g.measurements.map((m) => (
                <li key={m.id}>
                  <button className="link" onClick={() => onOpenIv?.(m.id)}>
                    {m.name}
                  </button>
                  <span className="mut small">
                    {m.owner}, {plural(m.devices, 'cell')}
                  </span>
                  <span className="grow" />
                  <span>{m.best ? pct(m.best, 2) : '—'}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mut">No measurements imported.</p>
          )}
        </More>
      </section>
      {exporting && (
        <PresentationExport
          label={label}
          sub={sub}
          points={points}
          tickOf={(x) => tick(x, d.unit)}
          top={top}
          file={d.from.slice(0, 10)}
          extra={{ name: 'Highlights', render: highlights }}
          onClose={() => setExporting(false)}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ People and one person's page
function People({ d, onPerson }: { d: Dash; onPerson: (id: number) => void }) {
  const on = d.people.filter((p) => doing(p) !== 'Nothing this period'),
    off = d.people.filter((p) => !on.includes(p));
  return (
    <div className="ov-body">
      {on.length > 0 && (
        <section className="ov-sec">
          <h4 className="ov-h">Active this {d.unit}</h4>
          <div className="ov-people">
            {on.map((p) => (
              <PersonCard key={p.id} p={p} onPerson={onPerson} />
            ))}
          </div>
        </section>
      )}
      {off.length > 0 && (
        <section className="ov-sec">
          <h4 className="ov-h">No activity this {d.unit}</h4>
          <div className="ov-people quiet">
            {off.map((p) => (
              <PersonCard key={p.id} p={p} onPerson={onPerson} />
            ))}
          </div>
        </section>
      )}
      <p className="mut small">Open a person to see their progress over all their measurements.</p>
    </div>
  );
}

function Person({
  id,
  onBack,
  onOpenBatch,
  onOpenIv,
}: {
  id: number;
  onBack: () => void;
  onOpenBatch?: (id: number) => void;
  onOpenIv?: (id: number) => void;
}) {
  const [p, setP] = useState<PersonPage | null>(null),
    [err, setErr] = useState(''),
    sl = useSlide();
  useEffect(() => {
    api<PersonPage>('/dashboard/person/' + id)
      .then(setP)
      .catch((e) => setErr(e.message));
  }, [id]);
  if (err) return <p className="err">{err}</p>;
  if (!p) return <p className="mut">Loading…</p>;
  const pts = p.progress.map((x) => ({
    x: x.day,
    best: x.best,
    median: x.median,
    n: x.devices,
    title: `${x.name} (${fmtDate(x.day)})`,
  }));
  const best = Math.max(0, ...p.progress.map((x) => x.best ?? 0)),
    devs = p.progress.reduce((a, x) => a + x.devices, 0),
    hours = p.hours.reduce((a, x) => a + x.hours, 0);
  const counts = { planned: 0, running: 0, done: 0 } as Record<string, number>;
  p.batches.forEach((b) => {
    counts[b.status] = (counts[b.status] ?? 0) + 1;
  });
  const bestRun = p.progress.reduce<(typeof p.progress)[number] | null>(
    (a, x) => (x.best != null && (!a || x.best > (a.best ?? 0)) ? x : a),
    null,
  );
  const tickDay = (x: string) =>
    new Date(x + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return (
    <div className="ov-body">
      <button className="link back" onClick={onBack}>
        ‹ Overview
      </button>
      <header className="ov-person">
        <Avatar id={p.id} name={p.name} photoV={p.photoV} size={64} />
        <div>
          <h2>{p.name}</h2>
          <span className="mut">
            {p.tags.map((t) => t.name).join(', ') || `@${p.username}`} · last seen {seen(p.last_seen)}
          </span>
        </div>
        <div className="grow" />
        <SlideButtons
          onMake={(as) =>
            sl.make(
              <SlideFrame
                svgRef={sl.ref}
                title={p.name}
                sub={`${p.tags.map((t) => t.name).join(', ')}${p.tags.length ? ', ' : ''}progress up to ${fmtDate(new Date().toISOString())}`}
              >
                <SlideNumbers
                  items={[
                    ['Batches', String(p.batches.length)],
                    ['Finished', String(counts.done)],
                    ['Cells measured', String(devs)],
                    ['Best cell', pct(best || null)],
                    ['Equipment', hrs(hours)],
                  ]}
                  y={320}
                />
                <SlideTrend points={pts} x={110} y={520} w={SW - 220} h={430} tickOf={tickDay} />
              </SlideFrame>,
              `progress-${p.username}`,
              as,
            )
          }
        />
      </header>
      <Stats
        items={[
          {
            label: 'Best cell so far',
            value: pct(best || null, 2),
            tone: 'best',
            note: bestRun ? `${bestRun.name}, ${fmtDate(bestRun.day)}` : 'No cells measured yet',
          },
          { label: 'Cells measured', value: String(devs), note: `in ${plural(p.progress.length, 'measurement')}` },
          {
            label: 'Batches',
            value: String(p.batches.length),
            note: `${counts.done} finished · ${counts.running} in progress`,
          },
        ]}
      />
      {p.progress.length > 0 && (
        <section className="group">
          <h4 className="ov-h">Progress, measurement by measurement</h4>
          <LineChart
            h={220}
            points={pts}
            xLabel="Measurement"
            unitTick={tickDay}
            empty="No working cells in these measurements."
          />
        </section>
      )}
      <div className="ov-two">
        <section className="group">
          <h4 className="ov-h">Recent batches</h4>
          {p.batches.length ? (
            <ul className="ov-list">
              {p.batches.slice(0, 6).map((b) => (
                <li key={b.id}>
                  <button className="link" onClick={() => onOpenBatch?.(b.id)}>
                    {b.code}
                  </button>
                  <span className="mut small ov-clip">{b.name}</span>
                  <span className="grow" />
                  <span className={'status-pill st-' + b.status}>{STATUS[b.status]}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mut">No batches yet.</p>
          )}
        </section>
        <section className="group">
          <h4 className="ov-h">Recent measurements</h4>
          {p.progress.length ? (
            <ul className="ov-list">
              {[...p.progress]
                .reverse()
                .slice(0, 6)
                .map((m) => (
                  <li key={m.id}>
                    <button className="link" onClick={() => onOpenIv?.(m.id)}>
                      {m.name}
                    </button>
                    <span className="mut small">{plural(m.devices, 'cell')}</span>
                    <span className="grow" />
                    <b>{pct(m.best, 2)}</b>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="mut">No measurements yet.</p>
          )}
        </section>
      </div>
      <More title="Equipment time" count={p.hours.length}>
        {p.hours.length ? (
          <div className="bars">
            {p.hours.map((h) => (
              <div key={h.name} className="bar-row" style={{ '--eq': h.color } as React.CSSProperties}>
                <span>{h.name}</span>
                <span className="bar">
                  <i style={{ width: `${(h.hours / Math.max(...p.hours.map((x) => x.hours))) * 100}%` }} />
                </span>
                <span className="mut small">
                  {hrs(h.hours)}, {plural(h.n, 'booking')}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mut">No bookings yet.</p>
        )}
      </More>
      {p.setbacks.length > 0 && (
        <More title="Postponed or canceled steps" count={p.setbacks.length}>
          <ul className="ov-list">
            {p.setbacks.map((s, i) => (
              <li key={i}>
                <span className={'oc oc-' + s.outcome}>{s.outcome === 'postponed' ? 'Postponed' : 'Canceled'}</span>
                <span>
                  {s.equipment}, {s.batch}
                  {s.step ? ` (${s.step})` : ''}
                </span>
                <span className="mut small">{s.reason}</span>
              </li>
            ))}
          </ul>
        </More>
      )}
      {sl.holder}
    </div>
  );
}

// ------------------------------------------------------------------ Equipment
function Equipment({ d, label }: { d: Dash; label: string }) {
  const sl = useSlide(),
    max = Math.max(1, ...d.equipment.map((e) => e.hours));
  return (
    <div className="ov-body">
      <div className="ov-intro">
        <p className="ov-lede">
          {d.lab.hours
            ? `${hrs(d.lab.hours)} of equipment time booked ${d.unit === 'week' ? 'this week' : 'this month'}.`
            : `No equipment booked ${d.unit === 'week' ? 'this week' : 'this month'}.`}
        </p>
        <SlideButtons
          onMake={(as) =>
            sl.make(
              <SlideFrame
                svgRef={sl.ref}
                title="Equipment use"
                sub={`${label}, booked hours (share of weekday working hours, 08:00–18:00)`}
              >
                <g transform="translate(110 320)">
                  {d.equipment.map((e, i) => (
                    <g key={e.id} transform={`translate(0 ${i * 86})`}>
                      <text y={34} fontSize={34} fill={INK}>
                        {e.name}
                      </text>
                      <rect
                        x={640}
                        y={6}
                        width={Math.max(4, (e.hours / max) * 900)}
                        height={40}
                        rx={6}
                        fill={e.color}
                      />
                      <text x={660 + Math.max(4, (e.hours / max) * 900)} y={36} fontSize={30} fill={INK}>
                        {hrs(e.hours)} ({Math.round(e.use * 100)} %)
                      </text>
                    </g>
                  ))}
                </g>
              </SlideFrame>,
              `equipment-${d.from.slice(0, 10)}`,
              as,
            )
          }
        />
      </div>
      <section className="group">
        <div className="eq-use">
          {d.equipment.map((e) => (
            <div key={e.id} className="eq-use-row" style={{ '--eq': e.color } as React.CSSProperties}>
              <div className="eq-use-name">
                <i />
                <b>{e.name}</b>
              </div>
              <div
                className="eq-use-bar"
                title={`${hrs(e.hours)} booked, ${Math.round(e.use * 100)} % of weekday working hours`}
              >
                <i style={{ width: `${(e.hours / max) * 100}%` }} />
              </div>
              <div className="eq-use-num">
                <b>{e.hours ? hrs(e.hours) : '—'}</b>{' '}
                <span className="mut small">
                  {e.hours ? `busy ${Math.round(e.use * 100)} % of the time` : 'not booked'}
                </span>
              </div>
              {e.byUser.length > 0 && (
                <div className="eq-use-who mut small">
                  {e.byUser.map((u) => `${u.name.split(' ')[0]} ${hrs(u.hours)}`).join(' · ')}
                  {e.postponed || e.canceled ? ` · ${e.postponed + e.canceled} postponed or canceled` : ''}
                </div>
              )}
            </div>
          ))}
        </div>
        <p className="mut small ov-foot">
          Busy = booked time out of weekday working hours (08:00–18:00, {d.lab.workHours} h this {d.unit}).
        </p>
      </section>
      {sl.holder}
    </div>
  );
}
