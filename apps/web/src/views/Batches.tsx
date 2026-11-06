import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { MeCtx } from '../ctx';
import { api } from '../api';
import { trashed, useRefresh } from '../lib/trash';
import Comments from '../lib/Comments';
import { BatchReport, batchMeasurements, batchSpreadsheet } from './BatchReport';
import { RunEntry, RunForm, type Run } from '../lib/Library';
import { Badge, Empty, LayoutToggle, Seg, fmtDate, fmtDateTime, useLayout, usePrint } from '../lib/ui';
import { KINDS } from '../recipes';
import { norm, type Ctx, type Rec } from '../recipes/types';
import { SEG, type Slot, type StackD } from '../stacks/model';
import RunSheet from '../stacks/RunSheet';
import { bundlesOf, placedOf } from '../lib/bundles';
import { layerState, stepPresets } from '../lib/stepRuns';
import type { Booking } from './Calendar';
import { StackIcon, View3D } from '../stacks/stack';
import { BatchMeasurements } from '../iv/IvPage';
import type { Variants as VariantsD } from '@psc/core';
import Variants from './Variants';

type Status = 'planned' | 'running' | 'done';
type Row = {
  id: number;
  code: string;
  name: string;
  status: Status;
  visibility: string;
  mine: number;
  owner: string;
  created_at: string;
  arch: string;
  total: number;
  /** booked steps (canceled left out) and how many are concluded */
  steps: number;
  concluded: number;
  runs: number;
  thumb?: string;
  variants?: { id: string; name: string }[];
  locked?: boolean;
};
const LockGlyph = () => (
  <svg
    className="lock-glyph"
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    aria-label="Locked"
  >
    <title>Locked: finished more than 14 days ago</title>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);
export type Rec2 = { slots?: Record<number, { done?: boolean; at?: string }>; notes?: string };
export type Batch = {
  id: number;
  code: string;
  name: string;
  status: Status;
  visibility: 'private' | 'shared';
  owner: string;
  created_at: string;
  editable: boolean;
  record: Rec2;
  snapshot: {
    stack: StackD;
    resolved: Record<number, { a?: { name: string; data: any } | null; b?: { name: string; data: any } | null }>;
    chems: any[];
    coreVersion: string;
    /** the stack the batch was started from (0.33 on) */
    source?: number;
  };
  variants?: VariantsD;
  lock?: { locked: boolean; locksAt: string | null; unlockedUntil: string | null };
};
export type BRun = Run & { preset_id: number; segment: string };

export const STATUS: Record<Status, string> = { planned: 'Planned', running: 'Running', done: 'Done' };
export const batchesChanged = () => window.dispatchEvent(new Event('psc-batches'));

export default function Batches({
  openId,
  onOpen,
  onOpenIv,
  onSchedule,
}: {
  openId: number | null;
  onOpen: (id: number | null) => void;
  onOpenIv?: (id: number) => void;
  onSchedule?: (id: number) => void;
}) {
  return openId ? (
    <Detail id={openId} onBack={() => onOpen(null)} onOpenIv={onOpenIv} onSchedule={onSchedule} />
  ) : (
    <List onOpen={onOpen} />
  );
}

function List({ onOpen }: { onOpen: (id: number) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null),
    [f, setF] = useState<'all' | Status>('all'),
    [q, setQ] = useState(''),
    [layout, setLayout] = useLayout();
  const load = () =>
    api<Row[]>('/batches')
      .then(setRows)
      .catch(() => setRows([]));
  useEffect(() => {
    load();
  }, []);
  useRefresh(load, ['batches', 'calendar']);
  const count = (s: Status) => (rows ?? []).filter((r) => r.status === s).length;
  const shown = (rows ?? []).filter(
    (r) => (f === 'all' || r.status === f) && (r.code + ' ' + r.name).toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <>
      <div className="lib-bar">
        <Seg
          value={f}
          on={setF}
          small
          opts={[
            ['all', 'All'],
            ['planned', `Planned ${count('planned') || ''}`],
            ['running', `Running ${count('running') || ''}`],
            ['done', `Done ${count('done') || ''}`],
          ]}
        />
        <input
          className="lib-search"
          type="search"
          placeholder="Search batches"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="grow" />
        <LayoutToggle v={layout} on={setLayout} />
      </div>
      {rows === null ? (
        <div className="cards">
          {[0, 1, 2].map((i) => (
            <div key={i} className="pcard skeleton" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <Empty
          title={rows.length ? 'Nothing matches' : 'No batches yet'}
          text={
            rows.length
              ? 'Change the filter or the search text.'
              : 'Open a stack and use Start batch. The batch keeps a frozen copy of the stack and its recipes.'
          }
        />
      ) : layout === 'cards' ? (
        <div className="cards">
          {shown.map((r) => (
            <button key={r.id} className="pcard" onClick={() => onOpen(r.id)}>
              <div className="pcard-art">
                {r.thumb ? <img className="thumb" src={r.thumb} alt="" /> : <StackIcon />}
              </div>
              <div className="pcard-body">
                <div className="pcard-name">{r.code}</div>
                <div className="pcard-sum">
                  {r.name || r.arch} · {r.arch}
                </div>
                <div className="progress" title={progressText(r)}>
                  <i style={{ width: `${r.steps ? (100 * r.concluded) / r.steps : 0}%` }} />
                </div>
                <div className="pcard-meta">
                  <span className={'status ' + r.status}>
                    {STATUS[r.status]}
                    {r.locked && <LockGlyph />}
                  </span>
                  <span>{progressText(r)}</span>
                  {!!r.variants?.length && (
                    <span>
                      {r.variants.length} variant{r.variants.length > 1 ? 's' : ''}
                    </span>
                  )}
                  {r.runs > 0 && <Badge>{r.runs} run data</Badge>}
                  <span>
                    {r.mine ? 'You' : r.owner} · {fmtDate(r.created_at)}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <section className="group scroll flush">
          <table className="list">
            <thead>
              <tr>
                <th>Batch</th>
                <th>Name</th>
                <th>Status</th>
                <th>Steps</th>
                <th>Owner</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="click" onClick={() => onOpen(r.id)}>
                  <td>
                    <b>{r.code}</b>
                  </td>
                  <td className="mut">
                    {r.name || r.arch}, {r.arch}
                  </td>
                  <td>
                    <span className={'status ' + r.status}>
                      {STATUS[r.status]}
                      {r.locked && <LockGlyph />}
                    </span>
                  </td>
                  <td className="mut">{progressText(r)}</td>
                  <td>{r.mine ? 'You' : r.owner}</td>
                  <td className="mut">{fmtDate(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

const progressText = (r: Pick<Row, 'steps' | 'concluded'>) =>
  r.steps ? `${r.concluded} of ${r.steps} steps concluded` : 'Not scheduled';

/** A Ctx built from the batch's frozen snapshot, so recipe outputs and the 3D view show the batch exactly as it was started. */
export function snapCtx(b: Pick<Batch, 'snapshot'>): Ctx {
  const chems = b.snapshot.chems.map((c, i) => ({ id: i, ...c })),
    all: Rec[] = [];
  b.snapshot.stack.sl.forEach((s, i) => {
    const r = b.snapshot.resolved[i] ?? {},
      seg = SEG[s.m];
    const push = (id: string, segment: string | null, p?: { name: string; data: any } | null) => {
      if (id && segment && p) all.push({ id: +id, segment, name: p.name, data: p.data } as Rec);
    };
    push(s.a, seg, r.a);
    if (s.m === 'Spin') push(s.b, 's2', r.b);
  });
  return {
    chems,
    cl: chems.map((c: any) => ({ n: c.name, f: c.f, M: c.M, pur: c.pur })),
    solutions: [],
    designs: [],
    all,
    refresh: () => {},
  };
}
const presetsOf = (s: Slot): { id: string; seg: string }[] =>
  s.m === 'Spin'
    ? [
        { id: s.a, seg: 's1' },
        { id: s.b, seg: 's2' },
      ].filter((x) => x.id)
    : SEG[s.m] && s.a
      ? [{ id: s.a, seg: SEG[s.m]! }]
      : [];

function Detail({
  id,
  onBack,
  onOpenIv,
  onSchedule,
}: {
  id: number;
  onBack: () => void;
  onOpenIv?: (id: number) => void;
  onSchedule?: (id: number) => void;
}) {
  const [b, setB] = useState<Batch | null>(null),
    [runs, setRuns] = useState<BRun[]>([]),
    [msg, setMsg] = useState(''),
    [adding, setAdding] = useState<{ slot: number; id: string; seg: string } | null>(null);
  const { me } = useContext(MeCtx);
  const pr = usePrint(),
    saved = useRef(''),
    [busyRep, setBusyRep] = useState<'' | 'pdf' | 'xlsx'>('');
  const loadRuns = () =>
    api<BRun[]>(`/batches/${id}/runs`)
      .then(setRuns)
      .catch(() => {});
  const [books, setBooks] = useState<Booking[]>([]);
  const loadBooks = () =>
    api<Booking[]>(`/batches/${id}/bookings`)
      .then(setBooks)
      .catch(() => {});
  useEffect(() => {
    loadBooks();
    const f = () => {
      loadBooks();
      api<Batch>('/batches/' + id)
        .then((x) => setB((o) => (o ? { ...o, status: x.status, lock: x.lock, editable: x.editable } : x)))
        .catch(() => {});
    };
    window.addEventListener('psc-batches', f);
    return () => window.removeEventListener('psc-batches', f);
  }, [id]);
  useEffect(() => {
    api<Batch>('/batches/' + id)
      .then((x) => {
        saved.current = JSON.stringify(x.record ?? {});
        setB(x);
      })
      .catch((e) => setMsg(e.message));
    loadRuns();
  }, [id]);
  useEffect(() => {
    // autosave layer checklist and notes
    if (!b?.editable) return;
    const cur = JSON.stringify(b.record ?? {});
    if (cur === saved.current) return;
    const t = setTimeout(
      () =>
        api('/batches/' + id, 'PATCH', { record: b.record })
          .then(() => {
            saved.current = cur;
            setMsg('Saved');
            batchesChanged();
          })
          .catch((e) => setMsg(e.message)),
      600,
    );
    return () => clearTimeout(t);
  }, [b?.record]);
  const ctx = useMemo(() => (b ? snapCtx(b) : null), [b?.id]);
  if (!b || !ctx) return <p className="mut">{msg || 'Loading…'}</p>;
  const st = b.snapshot.stack,
    rec = b.record ?? {};
  const patch = (p: Partial<Batch>) =>
    api('/batches/' + id, 'PATCH', p)
      .then(() => {
        setB({ ...b, ...p });
        batchesChanged();
      })
      .catch((e) => setMsg(e.message));
  // a layer's progress comes from the calendar: its bookings (scheduler blocks cover several layers) and their outcomes
  const stepsOf = books.filter((k) => k.outcome !== 'canceled').map((k) => ({ k, items: stepPresets(b, k.step) }));
  const statusOf = (i: number) => layerState(b, books, i);
  // concluded steps whose recipes have no run data under this batch yet
  const missing = stepsOf
    .filter(({ k }) => k.outcome === 'done')
    .flatMap(({ k, items }) =>
      items.filter((x) => !runs.some((r) => String(r.preset_id) === x.id)).map((x) => ({ ...x, step: k.step })),
    )
    .filter((x, j, a) => a.findIndex((y) => y.id === x.id && y.slot === x.slot) === j);
  const concludedN = stepsOf.filter(({ k }) => k.outcome === 'done').length;
  const dataOf = (pid: string | number) => ctx.all.find((p) => String(p.id) === String(pid))?.data;
  const lock = b.lock,
    admin = me.role === 'admin';
  const relock = (path: 'unlock' | 'lock') =>
    api(`/batches/${id}/${path}`, 'POST')
      .then(() => api<Batch>('/batches/' + id))
      .then((x) => {
        setB({ ...b, lock: x.lock, editable: x.editable });
        batchesChanged();
      })
      .catch((e) => setMsg(e.message));

  return (
    <div className="batch">
      <div className="batch-head">
        <button className="link" onClick={onBack}>
          ‹ Batches
        </button>
        <h2>{b.code}</h2>
        <input
          className="batch-name"
          placeholder="Description"
          value={b.name}
          disabled={!b.editable}
          onChange={(e) => setB({ ...b, name: e.target.value })}
          onBlur={() => patch({ name: b.name })}
        />
        <div className="grow" />
        <span
          className={'status-pill st-' + b.status}
          title="Follows the schedule: Running when the first booking starts, Done when every step is answered"
        >
          {STATUS[b.status]}
        </span>
        <Seg
          value={b.visibility}
          small
          on={(v) => b.editable && patch({ visibility: v })}
          opts={[
            ['private', 'Private'],
            ['shared', 'Shared'],
          ]}
        />
        <button
          className="btn"
          onClick={() =>
            pr.print(<RunSheet st={st} ctx={ctx} name={b.name || st.arch} batch={b.code} variants={b.variants} />)
          }
        >
          Print sheet
        </button>
        <button
          className="link"
          disabled={!!busyRep}
          onClick={() => {
            setBusyRep('pdf');
            batchMeasurements(b.id)
              .then((sets) => pr.print(<BatchReport b={b} ctx={ctx} runs={runs} sets={sets} books={books} />))
              .catch((e) => setMsg(e.message))
              .finally(() => setBusyRep(''));
          }}
        >
          {busyRep === 'pdf' ? 'Preparing…' : 'Report (PDF)'}
        </button>
        <button
          className="link"
          disabled={!!busyRep}
          onClick={() => {
            setBusyRep('xlsx');
            batchMeasurements(b.id)
              .then((sets) => batchSpreadsheet(b, ctx, runs, sets, books))
              .catch((e) => setMsg(e.message))
              .finally(() => setBusyRep(''));
          }}
        >
          {busyRep === 'xlsx' ? 'Preparing…' : 'Spreadsheet'}
        </button>
        {b.editable && (
          <button
            className="link danger-link"
            title="Moves it to the trash: Undo right after, or restore it from Trash for 30 days"
            onClick={() =>
              api('/batches/' + id, 'DELETE').then(() => {
                batchesChanged();
                trashed('batch', id, b.code);
                onBack();
              })
            }
          >
            Move to trash
          </button>
        )}
      </div>
      <p className="mut small">
        {b.owner}, created {fmtDate(b.created_at)}.{' '}
        {stepsOf.length ? `${concludedN} of ${stepsOf.length} booked steps concluded` : 'Not scheduled yet'}
        {lock?.locksAt && !lock.locked && !lock.unlockedUntil ? `. Locks on ${fmtDate(lock.locksAt)}` : ''}
        {msg ? `. ${msg}` : ''}
      </p>
      {(lock?.locked || lock?.unlockedUntil) && (
        <div className="batch-lock" role="status">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d={lock.locked ? 'M8 11V8a4 4 0 0 1 8 0v3' : 'M8 11V8a4 4 0 0 1 7.5-2'} />
          </svg>
          <span>
            {lock.locked ? (
              <>
                <b>Locked</b> since {fmtDate(lock.locksAt!)}: steps, run data, variants and notes stay as recorded.
                Comments, sharing and measurement links stay open.
              </>
            ) : (
              <>
                <b>Unlocked</b> by an admin until {fmtDateTime(lock.unlockedUntil!)}. It locks again by itself.
              </>
            )}
          </span>
          {admin && (
            <button className="link" onClick={() => relock(lock.locked ? 'unlock' : 'lock')}>
              {lock.locked ? 'Unlock for 7 days' : 'Lock now'}
            </button>
          )}
        </div>
      )}
      {missing.length > 0 && (
        <div className="runs-missing" role="status">
          <b>Run data missing</b> for{' '}
          {missing.length === 1 ? 'a concluded step' : `${missing.length} recipes of concluded steps`}:
          <ul>
            {missing.map((x) => (
              <li key={x.slot + '|' + x.id}>
                {x.layer}, {x.name}{' '}
                {b.editable && (
                  <button className="link small" onClick={() => setAdding({ slot: x.slot, id: x.id, seg: x.seg })}>
                    Add run data
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="batch-grid">
        <div>
          <View3D st={st} ctx={ctx} height={440} cog />
          <div className="below-3d">
            <ScheduleButton b={b} books={books} onSchedule={onSchedule} />
          </div>
        </div>
        <section className="group">
          <h3>Layers</h3>
          {[...st.sl]
            .map((s, i) => ({ s, i }))
            .reverse()
            .map(({ s, i }) => {
              const ps = presetsOf(s),
                state = statusOf(i);
              return (
                <div key={s.id ?? i} className={'layer-step' + (state.done ? ' done' : '')}>
                  <div className="layer-step-h">
                    <b>
                      {i + 1}. {s.n}
                    </b>
                    <span className="mut small">{s.m}</span>
                    <div className="grow" />
                    <span className={'small layer-state' + (state.done ? ' ok' : '')}>{state.text}</span>
                  </div>
                  <div className="check-presets">
                    {s.m === 'Manual' && <span className="small">{s.t}</span>}
                    {ps.map((p) => {
                      const r = (b.snapshot.resolved[i] ?? {})[p.seg === 's2' ? 'b' : 'a'],
                        n = runs.filter((x) => String(x.preset_id) === p.id).length;
                      return (
                        <span key={p.id} className="inline small">
                          {r?.name ?? 'Unavailable preset'}
                          {n > 0 && <Badge tone="ac">{n} run data</Badge>}
                          {!lock?.locked && (
                            <button className="link" onClick={() => setAdding({ slot: i, id: p.id, seg: p.seg })}>
                              Add run data
                            </button>
                          )}
                        </span>
                      );
                    })}
                  </div>
                  {adding?.slot === i &&
                    (() => {
                      const k = KINDS[adding.seg],
                        d = norm(k, dataOf(adding.id));
                      return (
                        <RunForm
                          kind={k}
                          ctx={ctx}
                          d={d}
                          presetId={+adding.id}
                          batch={b.code}
                          required={missing.some((x) => x.slot === adding.slot && x.id === adding.id)}
                          onCancel={() => setAdding(null)}
                          onDone={() => {
                            setAdding(null);
                            loadRuns();
                            batchesChanged();
                          }}
                        />
                      );
                    })()}
                </div>
              );
            })}
        </section>
      </div>

      <Variants b={b} onSaved={(v) => setB({ ...b, variants: v })} />

      <section className="group">
        <h3>Batch notes</h3>
        <textarea
          value={rec.notes ?? ''}
          readOnly={!b.editable}
          placeholder="Conditions, glovebox readings, anything that applies to the whole batch…"
          onChange={(e) => setB({ ...b, record: { ...rec, notes: e.target.value } })}
        />
      </section>

      <BatchMeasurements batchId={b.id} code={b.code} onOpen={(i) => onOpenIv?.(i)} />

      <BatchBookings list={books} />
      <h3 className="sub">Run data for {b.code}</h3>
      {runs.length === 0 ? (
        <p className="mut">
          No run data yet. Use Add run data on a layer, or enter the batch code when adding run data to a recipe.
        </p>
      ) : (
        runs.map((r) => {
          const k = KINDS[r.segment];
          return k ? (
            <RunEntry
              key={r.id}
              kind={k}
              ctx={ctx}
              d={norm(k, dataOf(r.preset_id))}
              r={r}
              onDelete={loadRuns}
              title={<b className="run-title">{r.preset}</b>}
            />
          ) : null;
        })
      )}
      <h3 className="sub">Comments</h3>
      <Comments kind="batch" id={b.id} />
      {pr.portal}
    </div>
  );
}

/** The equipment booked for this batch (from the Calendar), with how each step went. */
function BatchBookings({ list }: { list: Booking[] }) {
  if (!list.length) return null;
  const t = (x: string) =>
    new Date(x).toLocaleString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  const OUT: Record<string, string> = { done: 'Concluded', postponed: 'Postponed', canceled: 'Canceled' };
  return (
    <>
      <h3 className="sub">Equipment</h3>
      <section className="group batch-bookings">
        {list.map((k) => {
          const over = new Date(k.end) < new Date();
          return (
            <div
              key={k.id}
              className={'bb' + (k.outcome === 'canceled' ? ' off' : '')}
              style={{ '--eq': k.color } as React.CSSProperties}
            >
              <i />
              <b>{k.equipment}</b>
              <span>{k.step}</span>
              <span className="mut">
                {t(k.start)} to {new Date(k.end).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span className="grow" />
              {k.outcome ? (
                <span className={'oc oc-' + k.outcome} title={k.reason || undefined}>
                  {OUT[k.outcome]}
                  {k.reason ? `: ${k.reason}` : ''}
                </span>
              ) : over ? (
                <span className="oc oc-wait">Needs an answer</span>
              ) : null}
            </div>
          );
        })}
      </section>
    </>
  );
}

/**
 * Bottom-right of the batch's 3D view: opens the Calendar with this batch's equipment blocks ready to drag in. Reads
 * "Scheduled" once every block has a booking. Scheduling is done on a computer; on a phone the button only shows the state.
 */
function ScheduleButton({ b, books, onSchedule }: { b: Batch; books: Booking[]; onSchedule?: (id: number) => void }) {
  // substrate preparation (new in 0.32) only counts for batches still planned, or when it was booked
  const need = bundlesOf(b.snapshot.stack).filter(
    (x) => x.role !== 'prep' || b.status === 'planned' || placedOf(x, books),
  );
  if (!need.length) return null;
  const left = need.filter((x) => !placedOf(x, books)).length,
    done = left === 0,
    phone = window.innerWidth < 760;
  const tip = done
    ? 'Every equipment block is booked. Open the Calendar to move them'
    : `${left} of ${need.length} equipment block${need.length === 1 ? '' : 's'} still to place in the Calendar`;
  return (
    <button
      className={'btn sched-btn' + (done ? ' scheduled' : '')}
      title={phone ? 'Scheduling a batch is done on a computer' : tip}
      disabled={!b.editable || b.status === 'done' || phone || !onSchedule}
      onClick={() => onSchedule?.(b.id)}
    >
      {done && (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M5 12.5l4.5 4.5L19 7" />
        </svg>
      )}
      {done ? 'Scheduled' : books.length ? `Schedule equipment (${left} left)` : 'Schedule equipment'}
    </button>
  );
}
