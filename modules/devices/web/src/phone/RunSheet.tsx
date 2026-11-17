import { useEffect, useMemo, useState } from 'react';
import { api } from '@web/api';
import type { PhoneProps } from '@web/modules/types';
import type { Booking } from '@web/views/Calendar';
import { useChems } from '@web/views/common';
import { useRefresh } from '@web/lib/trash';
import { Back } from '@web/Icons';
import { BookingRow, startOfDay, useCal } from '@web/phone/parts';
import { KINDS } from '../recipes';
import { norm } from '../recipes/types';
import { RunForm } from '../lib/Library';
import { layerState } from '../lib/stepRuns';
import { slotPresets } from '../views/BatchReport';
import { snapCtx, STATUS, batchesChanged, type Batch, type BRun } from '../views/Batches';
import { methodName } from '../stacks/model';

/**
 * Run sheet on the phone (0.55): a batch's layers in the order of the printed run sheet, each with its procedure, the state
 * its bookings give it, and its run data, typed at the bench. Nothing is ticked: a step is done when its booking is answered
 * Concluded, as on a computer (Richard, 17 Nov: "there is no ticking in the version with scheduling").
 */
type Row = {
  id: number;
  code: string;
  name: string;
  status: 'planned' | 'running' | 'done';
  mine: number | boolean;
  owner: string;
  total: number;
  steps: number;
  concluded: number;
  locked: boolean;
};

export default function RunSheetTab(p: PhoneProps) {
  return p.openId ? <Sheet id={p.openId} onBack={() => p.go('run')} /> : <List go={p.go} />;
}

function useBatches() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const load = () =>
    api<Row[]>('/batches')
      .then(setRows)
      .catch(() => setRows([]));
  useEffect(() => {
    load();
  }, []);
  useRefresh(load, ['batches']);
  return rows;
}

const progress = (r: Row) =>
  r.status === 'done'
    ? 'Done'
    : r.steps
      ? `${r.concluded} of ${r.steps} booked ${r.steps === 1 ? 'step' : 'steps'} concluded`
      : r.status === 'planned'
        ? 'Planned, nothing booked yet'
        : STATUS[r.status];

function List({ go }: { go: PhoneProps['go'] }) {
  const rows = useBatches(),
    [done, setDone] = useState(false);
  if (!rows) return <p className="mut">Loading…</p>;
  const open = rows.filter((r) => r.status !== 'done'),
    shown = (done ? rows : open).slice().sort((a, b) => +!!b.mine - +!!a.mine);
  return (
    <div className="ph-stack">
      {!shown.length ? (
        <p className="mut ph-hint">No batch in progress. Batches are started from a stack in the full app.</p>
      ) : (
        <section className="group">
          <div className="ph-list">
            {shown.map((r) => (
              <button key={r.id} className="ph-tap ph-batch" onClick={() => go('run', r.id)}>
                <b>{r.name}</b>
                <span className="mut small">
                  {r.code}
                  {r.mine ? '' : `, ${r.owner}`}
                </span>
                <span className="small">{progress(r)}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {rows.length > open.length && (
        <button className="link ph-more" onClick={() => setDone(!done)}>
          {done ? 'Hide done batches' : 'Show done batches'}
        </button>
      )}
    </div>
  );
}

/** Today: my batches in progress and the step each is at. */
export function RunToday({ go }: PhoneProps) {
  const rows = useBatches();
  const mine = (rows ?? []).filter((r) => r.mine && r.status !== 'done');
  if (!mine.length) return null;
  return (
    <section className="group">
      <h3>Your batches</h3>
      <div className="ph-list">
        {mine.map((r) => (
          <button key={r.id} className="ph-tap ph-batch" onClick={() => go('run', r.id)}>
            <b>{r.name}</b>
            <span className="small">{progress(r)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Sheet({ id, onBack }: { id: number; onBack: () => void }) {
  const [b, setB] = useState<Batch | null>(null),
    [runs, setRuns] = useState<BRun[]>([]),
    [books, setBooks] = useState<Booking[]>([]),
    [err, setErr] = useState(''),
    [open, setOpen] = useState<number | null>(null),
    [adding, setAdding] = useState<{ slot: number; id: string; seg: string } | null>(null);
  const live = useChems();
  const load = () => {
    api<Batch>('/batches/' + id)
      .then(setB)
      .catch((e) => setErr(e.message));
    api<BRun[]>(`/batches/${id}/runs`)
      .then(setRuns)
      .catch(() => {});
    api<Booking[]>(`/batches/${id}/bookings`)
      .then(setBooks)
      .catch(() => {});
  };
  useEffect(() => {
    load();
    window.addEventListener('psc-bookings', load);
    return () => window.removeEventListener('psc-bookings', load);
  }, [id]);
  // today's calendar, for the booking that is now (its time in large figures)
  const today = useMemo(() => startOfDay(new Date()), []);
  const cal = useCal(today, 1).d;
  const ctx = useMemo(() => (b ? snapCtx(b, live) : null), [b?.id, live]);
  if (!b || !ctx) return <p className="mut">{err || 'Loading…'}</p>;
  const sl = b.snapshot.stack.sl;
  const now = Date.now(),
    current = (cal?.bookings ?? []).find(
      (k) =>
        k.subject === 'batch' &&
        k.subject_id === b.id &&
        new Date(k.start).getTime() <= now &&
        new Date(k.end).getTime() > now,
    );
  // the first layer not concluded: opened at first
  const states = sl.map((_, i) => layerState(b, books, i)),
    first = states.findIndex((s) => !s.done),
    shownOpen = open ?? (first < 0 ? null : first);
  const dataOf = (pid: string) => ctx.all.find((x) => String(x.id) === String(pid))?.data;
  return (
    <div className="ph-stack">
      <button className="link ph-back" onClick={onBack}>
        <Back size={18} /> Batches
      </button>
      <div className="ph-batch-h">
        <h2>{b.name}</h2>
        <span className="mut">
          {b.code}, {STATUS[b.status]}
        </span>
      </div>
      {current && (
        <section className="group ph-hero" aria-label="Booked now">
          <div className="ph-hero-when">Now</div>
          <BookingRow k={current} big />
        </section>
      )}
      <div className="ph-layers">
        {sl.map((s, i) => {
          const st = states[i],
            ps = slotPresets(s),
            isOpen = shownOpen === i;
          return (
            <section key={s.id ?? i} className={'group ph-layer' + (st.done ? ' done' : '')}>
              <button className="ph-layer-h" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? -1 : i)}>
                <span className="ph-layer-n">{i + 1}</span>
                <span className="grow">
                  <b>{s.n}</b>
                  <span className="mut small">{methodName(s.m)}</span>
                </span>
                <span className={'small' + (st.done ? ' ok' : ' mut')}>{st.text}</span>
              </button>
              {isOpen && (
                <div className="ph-layer-b">
                  {s.m === 'Manual' && s.t && <p>{s.t}</p>}
                  {ps.map((x) => {
                    const k = KINDS[x.seg],
                      r = (b.snapshot.resolved[i] ?? {})[x.seg === 's2' ? 'b' : 'a'],
                      n = runs.filter((y) => String(y.preset_id) === x.id).length;
                    return (
                      <div key={x.id} className="ph-proc">
                        <div className="ph-proc-h">
                          <b>{r?.name ?? 'Recipe not available'}</b>
                          {n > 0 && <span className="mut small">{n} run data</span>}
                        </div>
                        {r?.data && (
                          <div className="ph-out">
                            <k.Output d={norm(k, r.data)} ctx={ctx} />
                          </div>
                        )}
                        {adding?.slot === i && adding.id === x.id ? (
                          <RunForm
                            kind={k}
                            ctx={ctx}
                            d={norm(k, dataOf(x.id))}
                            presetId={+x.id}
                            batch={b.code}
                            onCancel={() => setAdding(null)}
                            onDone={() => {
                              setAdding(null);
                              load();
                              batchesChanged();
                            }}
                          />
                        ) : (
                          !b.lock?.locked && (
                            <button
                              className="btn secondary ph-wide"
                              onClick={() => setAdding({ slot: i, id: x.id, seg: x.seg })}
                            >
                              Add run data
                            </button>
                          )
                        )}
                      </div>
                    );
                  })}
                  {!ps.length && !s.t && <p className="mut small">No procedure for this layer.</p>}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
