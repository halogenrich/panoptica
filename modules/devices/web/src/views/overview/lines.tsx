import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LOOSE_COLOR } from '@psc/devices';
import { api } from '@web/api';
import { MeCtx } from '@web/ctx';
import { fmtDate } from '@web/lib/ui';
import { Dialog } from '@web/views/common';
import { pct, plural } from '@web/views/overview/parts';
import { batchFacts, diffFacts } from '../../compare/model';
import type { Batch } from '../Batches';
import { INK, MUT, RULE, SF } from '@web/views/overview/slides';

/**
 * Lines of research (0.61): each line in its colour, a dot per batch at its best device, joined in date order. Hovering a dot tells
 * the batch, its best and median device and what it changed against the line's starting stack; a click opens the batch. Batches in
 * no line, and measurements linked to no batch, are grey dots, not joined (Richard: "Grey not in line"). The owner of a line's
 * starting stack names it and picks its colour from its name in the key.
 */

export type LineMeta = {
  id: number;
  name: string;
  color: string;
  stack: string;
  ownerId: number;
  owner: string;
  hidden: boolean;
  custom: { name: boolean; color: boolean };
};
/** A dot: a batch (`kind` batch) or a measurement linked to no batch (`kind` set, only on My progress). */
export type LinePt = {
  kind: 'batch' | 'set';
  id: number;
  name: string;
  day: string;
  best: number;
  median: number | null;
  devices: number;
  line: number | null;
  owner?: string;
};

const ms = (day: string) => new Date(day + 'T12:00:00').getTime();
const DAY = 864e5;

/** The time and PCE scales both drawings share. */
function scales(points: LinePt[], w: number, h: number, pad: { L: number; R: number; T: number; B: number }) {
  const t = points.map((p) => ms(p.day)),
    v = points.map((p) => p.best);
  let t0 = Math.min(...t),
    t1 = Math.max(...t);
  // a few days either side, so a single batch or one day's batches sit inside the frame
  const extra = Math.max(3 * DAY, (t1 - t0) * 0.04);
  t0 -= extra;
  t1 += extra;
  const lo = Math.max(0, Math.floor((Math.min(...v) - 2) / 5) * 5),
    hi = Math.ceil((Math.max(...v) + 1) / 5) * 5,
    PW = Math.max(60, w - pad.L - pad.R),
    PH = Math.max(40, h - pad.T - pad.B);
  const X = (day: string) => pad.L + ((ms(day) - t0) / (t1 - t0)) * PW,
    Y = (x: number) => pad.T + PH - ((x - lo) / (hi - lo || 1)) * PH;
  const yt = Array.from({ length: Math.round((hi - lo) / 5) + 1 }, (_, i) => lo + i * 5).filter(
    (_, i, a) => a.length <= 7 || i % 2 === 0,
  );
  // months on long spans (mm/yyyy), days on short ones (dd/mm): plots may abbreviate
  const months = t1 - t0 > 75 * DAY,
    xt: { at: number; label: string }[] = [];
  if (months) {
    const d = new Date(t0);
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    const n = Math.round((t1 - t0) / (30 * DAY)),
      step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(PW / 90))));
    for (let i = 0; d.getTime() <= t1; i++, d.setMonth(d.getMonth() + 1))
      if (i % step === 0)
        xt.push({
          at: pad.L + ((d.getTime() - t0) / (t1 - t0)) * PW,
          label: `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`,
        });
  } else {
    const n = Math.max(2, Math.floor(PW / 80)),
      step = Math.max(DAY, Math.ceil((t1 - t0) / n / DAY) * DAY),
      d = new Date(t0);
    d.setHours(12, 0, 0, 0);
    for (let at = d.getTime() + DAY; at <= t1; at += step) {
      const x = new Date(at);
      xt.push({
        at: pad.L + ((at - t0) / (t1 - t0)) * PW,
        label: `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}`,
      });
    }
  }
  return { X, Y, yt, xt, PW, PH };
}

/** Each line's dots in date order, then the dots in no line. */
function series(lines: LineMeta[], points: LinePt[]) {
  const by = lines
    .map((l) => ({ l, pts: points.filter((p) => p.line === l.id).sort((a, b) => a.day.localeCompare(b.day)) }))
    .filter((s) => s.pts.length);
  const loose = points.filter((p) => p.line == null || !lines.some((l) => l.id === p.line));
  return { by, loose };
}

/** The line's name with its colour as a bar under it (the house rule for an item's colour). */
export const LineKey = ({ l }: { l: { name: string; color: string } }) => (
  <span className="line-key" style={{ '--c': l.color } as React.CSSProperties}>
    {l.name}
  </span>
);

// ---------------------------------------------------------------- what a batch changed against the line's starting stack
const facts = new Map<string, Promise<Record<string, string> | null>>();
const factsOf = (path: string) => {
  if (!facts.has(path))
    facts.set(
      path,
      api<Batch>(path)
        .then(batchFacts)
        .catch(() => null),
    );
  return facts.get(path)!;
};
function useChanges(p: LinePt | null) {
  const [st, setSt] = useState<{ key: string; rows: [string, string, string][] | 'private' | 'none' } | null>(null);
  const key = p ? `${p.kind}${p.id}:${p.line}` : '';
  useEffect(() => {
    if (!p || p.kind !== 'batch' || p.line == null) return;
    let on = true;
    Promise.all([factsOf(`/stacks/${p.line}/snapshot`), factsOf(`/batches/${p.id}`)]).then(([a, b]) => {
      if (!on) return;
      setSt({ key, rows: !a ? 'private' : !b ? 'none' : diffFacts(a, b) });
    });
    return () => {
      on = false;
    };
  }, [key]);
  return st?.key === key ? st.rows : null;
}

function Changes({ p, start }: { p: LinePt; start: string }) {
  const rows = useChanges(p);
  if (p.kind !== 'batch') return <span className="mut">A measurement linked to no batch</span>;
  if (p.line == null) return <span className="mut">Started from no stack, or its stack is in no line</span>;
  if (rows === null) return <span className="mut">Reading what changed…</span>;
  if (rows === 'private') return <span className="mut">The starting stack is private: changes not shown</span>;
  if (rows === 'none') return null;
  if (!rows.length) return <span className="mut">Same recipes as {start}</span>;
  return (
    <>
      <span className="mut">Against {start}:</span>
      {rows.slice(0, 4).map(([k, a, b]) => (
        <span key={k} className="line-change">
          {k}: {a} → {b}
        </span>
      ))}
      {rows.length > 4 && <span className="mut">{rows.length - 4} more</span>}
    </>
  );
}

// ---------------------------------------------------------------- the chart on screen
/**
 * The chart on My progress and the Lab page. `lines` may change here: the owner of a line's starting stack edits its name and
 * colour from the key, and the chart shows the change at once.
 */
export function LinesChart({
  lines: given,
  points,
  open,
  h = 260,
  empty,
  looseLabel = 'Not in a line',
  keys = true,
}: {
  lines: LineMeta[];
  points: LinePt[];
  open: (view: string, id: number) => void;
  h?: number;
  empty: string;
  looseLabel?: string;
  /** the key above the chart (the Lab page's toggles are its key, so it has none) */
  keys?: boolean;
}) {
  const { me } = useContext(MeCtx),
    box = useRef<HTMLDivElement>(null),
    [w, setW] = useState(640),
    [hover, setHover] = useState<LinePt | null>(null),
    [table, setTable] = useState(false),
    [lines, setLines] = useState(given),
    [edit, setEdit] = useState<LineMeta | null>(null);
  useEffect(() => setLines(given), [given]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, [table]);
  const { by, loose } = useMemo(() => series(lines, points), [lines, points]);
  if (!points.length) return <p className="mut chart-empty">{empty}</p>;
  const pad = { L: 44, R: 16, T: 26, B: 34 },
    { X, Y, yt, xt, PH } = scales(points, w, h, pad),
    color = (p: LinePt) => lines.find((l) => l.id === p.line)?.color ?? LOOSE_COLOR,
    lineOf = (p: LinePt) => lines.find((l) => l.id === p.line),
    mine = (l: LineMeta) => !l.hidden && me?.id === l.ownerId,
    shown = [...loose, ...by.flatMap((s) => s.pts)];
  const pick = (ev: React.PointerEvent<SVGSVGElement>) => {
    const r = ev.currentTarget.getBoundingClientRect(),
      x = ev.clientX - r.left,
      y = ev.clientY - r.top;
    let best: LinePt | null = null,
      bd = 24 * 24;
    for (const p of shown) {
      const d = (X(p.day) - x) ** 2 + (Y(p.best) - y) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    setHover(best);
  };
  const openPt = (p: LinePt) => open(p.kind === 'batch' ? 'batches' : 'iv', p.id);
  return (
    <div className="chart" ref={box}>
      <div className="inline chart-tools lines-keys">
        {keys &&
          by.map(({ l }) =>
            mine(l) ? (
              <button
                key={l.id}
                type="button"
                className="link line-edit"
                title="Name and colour"
                onClick={() => setEdit(l)}
              >
                <LineKey l={l} />
              </button>
            ) : (
              <LineKey key={l.id} l={l} />
            ),
          )}
        {keys && loose.length > 0 && <LineKey l={{ name: looseLabel, color: LOOSE_COLOR }} />}
        <div className="grow" />
        <button className="link small" onClick={() => setTable(!table)}>
          {table ? 'Show chart' : 'Show numbers'}
        </button>
      </div>
      {table ? (
        <table className="pp-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Line</th>
              <th>Batch</th>
              <th>Best device</th>
              <th>Median</th>
              <th>Devices</th>
            </tr>
          </thead>
          <tbody>
            {[...shown]
              .sort((a, b) => a.day.localeCompare(b.day))
              .map((p) => (
                <tr key={p.kind + p.id}>
                  <td>{fmtDate(p.day)}</td>
                  <td>{lineOf(p)?.name ?? looseLabel}</td>
                  <td>
                    <button className="link" onClick={() => openPt(p)}>
                      {p.name}
                    </button>
                  </td>
                  <td>{pct(p.best, 2)}</td>
                  <td>{pct(p.median, 2)}</td>
                  <td>{p.devices}</td>
                </tr>
              ))}
          </tbody>
        </table>
      ) : (
        <svg
          width={w}
          height={h}
          className="viz lines-viz"
          role="img"
          aria-label="Best device of each batch over time, by line of research"
          onPointerMove={pick}
          onPointerLeave={() => setHover(null)}
          onClick={() => hover && openPt(hover)}
          style={{ cursor: hover ? 'pointer' : undefined }}
        >
          {yt.map((v) => (
            <g key={v}>
              <line x1={pad.L} x2={w - pad.R} y1={Y(v)} y2={Y(v)} className="viz-grid" />
              <text x={pad.L - 8} y={Y(v)} className="viz-tick" textAnchor="end" dominantBaseline="central">
                {v}
              </text>
            </g>
          ))}
          <text x={pad.L - 8} y={4} className="viz-tick" textAnchor="end" dominantBaseline="hanging">
            PCE (%)
          </text>
          {xt.map((t) => (
            <text key={t.at} x={t.at} y={pad.T + PH + 20} className="viz-tick" textAnchor="middle">
              {t.label}
            </text>
          ))}
          {loose.map((p) => (
            <circle
              key={p.kind + p.id}
              cx={X(p.day)}
              cy={Y(p.best)}
              r={hover === p ? 5 : 3.5}
              fill={LOOSE_COLOR}
              className="line-dot"
            />
          ))}
          {by.map(({ l, pts }) => (
            <g key={l.id} className={hover && hover.line !== l.id ? 'line-dim' : undefined}>
              <path
                d={pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.day).toFixed(1)},${Y(p.best).toFixed(1)}`).join('')}
                fill="none"
                stroke={l.color}
                strokeWidth={2}
                strokeLinejoin="round"
              />
              {pts.map((p) => (
                <circle
                  key={p.id}
                  cx={X(p.day)}
                  cy={Y(p.best)}
                  r={hover === p ? 5.5 : 4}
                  fill={l.color}
                  className="line-dot"
                />
              ))}
            </g>
          ))}
        </svg>
      )}
      {!table &&
        hover &&
        (() => {
          const l = lineOf(hover),
            left = Math.min(Math.max(X(hover.day) + 14, 0), Math.max(0, w - 300)),
            top = Y(hover.best) > h / 2 ? 4 : Math.min(Y(hover.best) + 12, h - 40);
          return (
            <div className="viz-tip line-tip" style={{ left, top }}>
              <b>{hover.name}</b>
              <span>
                <LineKey l={l ?? { name: looseLabel, color: color(hover) }} />
              </span>
              <span>
                {fmtDate(hover.day)}
                {hover.owner ? ` · ${hover.owner}` : ''}
              </span>
              <span>
                Best {pct(hover.best, 2)} · median {pct(hover.median, 2)} · {plural(hover.devices, 'device')}
              </span>
              <Changes p={hover} start={l?.name ?? ''} />
            </div>
          );
        })()}
      {/* the key's names are buttons only for the lines the viewer started: say so (design critique, 0.61) */}
      {keys && !table && by.some(({ l }) => mine(l)) && (
        <p className="mut small ov-foot">Click the name of a line you started to rename it or change its colour.</p>
      )}
      {edit && (
        <LineEdit
          l={edit}
          onClose={() => setEdit(null)}
          onSaved={(n) => {
            setLines((ls) => ls.map((x) => (x.id === n.id ? n : x)));
            setEdit(null);
          }}
        />
      )}
    </div>
  );
}

/** A line's name and colour, for the owner of its starting stack (Richard, 25 Nov). Empty name: the starting stack's. */
export function LineEdit({
  l,
  onClose,
  onSaved,
}: {
  l: LineMeta;
  onClose: () => void;
  onSaved: (l: LineMeta) => void;
}) {
  const [name, setName] = useState(l.custom.name ? l.name : ''),
    [color, setColor] = useState(l.color),
    [err, setErr] = useState(''),
    [busy, setBusy] = useState(false);
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    api<LineMeta>('/lines/' + l.id, 'PUT', { name: name.trim() || null, color })
      .then(onSaved)
      .catch((x) => setErr(x.message))
      .finally(() => setBusy(false));
  };
  return (
    <Dialog title="Line of research" onClose={onClose}>
      <form className="box-form" onSubmit={save}>
        <div className="inline line-edit-row">
          <input type="color" aria-label="Colour" value={color} onChange={(e) => setColor(e.target.value)} />
          <label className="fld grow">
            <span>Name</span>
            <input
              autoFocus
              value={name}
              placeholder={l.stack}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        </div>
        <p className="mut small">
          Everyone sees this name and colour. Leave the name empty to use the starting stack’s.
        </p>
        {err && <p className="err small">{err}</p>}
        <div className="dialog-actions">
          <button type="button" className="link" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------- the Lab page's section
type LabLinesData = {
  lines: (LineMeta & { last: string })[];
  points: (LinePt & { batch: number })[];
  shown: number[] | null;
};
type ServerPt = {
  batch: number;
  name: string;
  owner: string;
  day: string;
  best: number;
  median: number | null;
  devices: number;
  line: number | null;
};

/** The Lab page's lines: each person picks which it shows; until they do, the three measured most recently (my default). */
export function LabLines({ open }: { open: (view: string, id: number) => void }) {
  const [d, setD] = useState<{ lines: LabLinesData['lines']; points: LinePt[]; shown: number[] | null } | null>(null),
    [err, setErr] = useState('');
  useEffect(() => {
    api<{ lines: LabLinesData['lines']; points: ServerPt[]; shown: number[] | null }>('/lines')
      .then((r) =>
        setD({
          ...r,
          points: r.points.map((p) => ({ ...p, kind: 'batch' as const, id: p.batch })),
        }),
      )
      .catch((e) => setErr(e.message));
  }, []);
  if (err) return <p className="err small">{err}</p>;
  if (!d) return <p className="mut">Loading…</p>;
  const latest = [...d.lines]
    .sort((a, b) => b.last.localeCompare(a.last))
    .slice(0, 3)
    .map((l) => l.id);
  const shown = (d.shown ?? latest).filter((id) => d.lines.some((l) => l.id === id));
  const setShown = (ids: number[]) => {
    setD({ ...d, shown: ids });
    api('/lines/shown', 'PUT', { ids }).catch((e) => setErr(e.message));
  };
  const byName = [...d.lines].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <section className="group">
      <h4 className="ov-h">Lines of research</h4>
      {d.lines.length ? (
        <>
          <div className="lines-pick">
            <span className="mut small">Shown</span>
            <div className="chips">
              {byName.map((l) => {
                const on = shown.includes(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    className={'chip' + (on ? ' on' : '')}
                    aria-pressed={on}
                    onClick={() => setShown(on ? shown.filter((x) => x !== l.id) : [...shown, l.id])}
                  >
                    <LineKey l={l} />
                  </button>
                );
              })}
            </div>
          </div>
          <LinesChart
            lines={d.lines.filter((l) => shown.includes(l.id))}
            points={d.points.filter((p) => p.line != null && shown.includes(p.line))}
            open={open}
            empty="Pick a line above to show it."
            keys={false}
          />
          <p className="mut small ov-foot">
            Each dot is a batch at its best device, on the day it was first measured. A line is a stack and the stacks
            made from it.
          </p>
        </>
      ) : (
        <p className="mut">
          No lines yet. A line starts when a batch made from a stack has a device measured and linked to it.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- the slide and the figure on its own
/** The lines on a slide or an exported figure: fixed colours on white, sizes for a 1920 × 1080 slide. */
export function SlideLines({
  lines,
  points,
  x,
  y,
  w,
  h,
  looseLabel = 'Not in a line',
}: {
  lines: LineMeta[];
  points: LinePt[];
  x: number;
  y: number;
  w: number;
  h: number;
  looseLabel?: string;
}) {
  if (!points.length)
    return (
      <text x={x} y={y + 60} fontSize={30} fill={MUT} fontFamily={SF}>
        No working devices measured yet.
      </text>
    );
  const { by, loose } = series(lines, points);
  // the key on one row above the plot, each name with its colour as a bar under it
  const keys = [
    ...by.map((s) => ({ name: s.l.name, color: s.l.color })),
    ...(loose.length ? [{ name: looseLabel, color: LOOSE_COLOR }] : []),
  ];
  // wraps onto more rows when the names do not fit one
  const placed: { k: (typeof keys)[number]; at: number; row: number; tw: number }[] = [];
  let kx = x + 70,
    row = 0;
  for (const k of keys) {
    const name = k.name.length > 28 ? k.name.slice(0, 27) + '…' : k.name,
      tw = Math.min(380, name.length * 11 + 4);
    if (kx + tw > x + w && kx > x + 70) {
      row++;
      kx = x + 70;
    }
    placed.push({ k: { ...k, name }, at: kx, row, tw });
    kx += tw + 30;
  }
  const keyEls = placed.map(({ k, at, row, tw }, i) => (
    <g key={i}>
      <text x={at} y={y + 22 + row * 44} fontSize={22} fill={INK}>
        {k.name}
      </text>
      <rect x={at} y={y + 31 + row * 44} width={tw} height={5} rx={2} fill={k.color} />
    </g>
  ));
  const pad = { L: 70, R: 20, T: 60 + row * 44, B: 50 },
    s = scales(points, w, h, pad);
  const X = (d: string) => x + s.X(d),
    Y = (v: number) => y + s.Y(v);
  return (
    <g fontFamily={SF}>
      {keyEls}
      {s.yt.map((v) => (
        <g key={v}>
          <line x1={x + pad.L} x2={x + w - pad.R} y1={Y(v)} y2={Y(v)} stroke={RULE} strokeWidth={2} />
          <text x={x + pad.L - 16} y={Y(v)} fontSize={24} fill={MUT} textAnchor="end" dominantBaseline="central">
            {v} %
          </text>
        </g>
      ))}
      {s.xt.map((t) => (
        <text key={t.at} x={x + t.at} y={y + pad.T + s.PH + 40} fontSize={24} fill={MUT} textAnchor="middle">
          {t.label}
        </text>
      ))}
      {loose.map((p) => (
        <circle
          key={p.kind + p.id}
          cx={X(p.day)}
          cy={Y(p.best)}
          r={8}
          fill={LOOSE_COLOR}
          stroke="#fff"
          strokeWidth={3}
        />
      ))}
      {by.map(({ l, pts }) => (
        <g key={l.id}>
          <path
            d={pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.day)},${Y(p.best)}`).join('')}
            fill="none"
            stroke={l.color}
            strokeWidth={5}
            strokeLinejoin="round"
          />
          {pts.map((p) => (
            <circle key={p.id} cx={X(p.day)} cy={Y(p.best)} r={9} fill={l.color} stroke="#fff" strokeWidth={3} />
          ))}
        </g>
      ))}
    </g>
  );
}
