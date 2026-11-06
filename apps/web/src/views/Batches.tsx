import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { trashed, useRefresh } from '../lib/trash';
import Comments from '../lib/Comments';
import { BatchReport, batchMeasurements, batchSpreadsheet } from './BatchReport';
import { RunEntry, RunForm, type Run } from '../lib/Library';
import { Badge, Empty, Seg, fmtDate, usePrint } from '../lib/ui';
import { KINDS } from '../recipes';
import { norm, type Ctx, type Rec } from '../recipes/types';
import { SEG, type Slot, type StackD } from '../stacks/model';
import RunSheet from '../stacks/RunSheet';
import { bundlesOf, placedOf } from '../lib/bundles';
import type { Booking } from './Calendar';
import { StackIcon, View3D } from '../stacks/stack';
import { BatchMeasurements } from '../iv/IvPage';

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
  done: number;
  runs: number;
  thumb?: string;
};
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
  };
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
    [q, setQ] = useState('');
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
      ) : (
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
                <div className="progress" title={`${r.done} of ${r.total} layers done`}>
                  <i style={{ width: `${r.total ? (100 * r.done) / r.total : 0}%` }} />
                </div>
                <div className="pcard-meta">
                  <span className={'status ' + r.status}>{STATUS[r.status]}</span>
                  <span>
                    {r.done}/{r.total} layers
                  </span>
                  {r.runs > 0 && <Badge>{r.runs} run data</Badge>}
                  <span>
                    {r.mine ? 'You' : r.owner} · {fmtDate(r.created_at)}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

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
        .then((x) => setB((o) => (o ? { ...o, status: x.status } : x)))
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
  const setSlot = (i: number, done: boolean) =>
    setB({
      ...b,
      record: {
        ...rec,
        slots: { ...(rec.slots ?? {}), [i]: { done, at: done ? new Date().toLocaleString() : undefined } },
      },
    });
  const doneN = st.sl.filter((_, i) => rec.slots?.[i]?.done).length;
  const dataOf = (pid: string | number) => ctx.all.find((p) => String(p.id) === String(pid))?.data;

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
          onClick={() => pr.print(<RunSheet st={st} ctx={ctx} name={b.name || st.arch} batch={b.code} />)}
        >
          Print sheet
        </button>
        <button
          className="link"
          disabled={!!busyRep}
          onClick={() => {
            setBusyRep('pdf');
            batchMeasurements(b.id)
              .then((sets) => pr.print(<BatchReport b={b} ctx={ctx} runs={runs} sets={sets} />))
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
              .then((sets) => batchSpreadsheet(b, ctx, runs, sets))
              .catch((e) => setMsg(e.message))
              .finally(() => setBusyRep(''));
          }}
        >
          {busyRep === 'xlsx' ? 'Preparing…' : 'Spreadsheet'}
        </button>
        {b.editable && (
          <button
            className="link danger-link"
            onClick={() =>
              window.confirm(`Move batch ${b.code} to the trash? You can restore it for 30 days (Library › Trash).`) &&
              api('/batches/' + id, 'DELETE').then(() => {
                batchesChanged();
                trashed('batch', id, b.code);
                onBack();
              })
            }
          >
            Delete
          </button>
        )}
      </div>
      <p className="mut small">
        {b.owner}, created {fmtDate(b.created_at)}. {doneN} of {st.sl.length} layers ticked{msg ? `. ${msg}` : ''}
      </p>

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
              const done = !!rec.slots?.[i]?.done,
                ps = presetsOf(s);
              return (
                <div key={s.id ?? i} className={'check-row' + (done ? ' done' : '')}>
                  <label className="inline">
                    <input
                      type="checkbox"
                      checked={done}
                      disabled={!b.editable}
                      onChange={(e) => setSlot(i, e.target.checked)}
                    />
                    <span>
                      <b>
                        {i + 1}. {s.n}
                      </b>{' '}
                      <span className="mut small">
                        · {s.m}
                        {rec.slots?.[i]?.at ? ` · done ${rec.slots[i].at}` : ''}
                      </span>
                    </span>
                  </label>
                  <div className="check-presets">
                    {s.m === 'Manual' && <span className="small">{s.t}</span>}
                    {ps.map((p) => {
                      const r = (b.snapshot.resolved[i] ?? {})[p.seg === 's2' ? 'b' : 'a'],
                        n = runs.filter((x) => String(x.preset_id) === p.id).length;
                      return (
                        <span key={p.id} className="inline small">
                          {r?.name ?? 'Unavailable preset'}
                          {n > 0 && <Badge tone="ac">{n} run data</Badge>}
                          <button className="link" onClick={() => setAdding({ slot: i, id: p.id, seg: p.seg })}>
                            Add run data
                          </button>
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
    new Date(x).toLocaleString(undefined, {
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
                {t(k.start)} to {new Date(k.end).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
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
  const need = bundlesOf(b.snapshot.stack);
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
