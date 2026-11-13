import { useEffect, useState } from 'react';
import { api } from '@web/api';
import { showToast } from '@web/lib/trash';
import { HOUR_PX, MIN_BOOK, hm, type Booking } from '@web/views/Calendar';
import type { TrayProps } from '@web/modules/types';
import { ROLE_NAME, autoSplit, bundlesOf, eqCandidates, placedOf } from './lib/bundles';
import type { StackD } from './stacks/model';
import { STEP_KINDS } from '@psc/devices';

const STEP_LABEL: Record<string, string> = Object.fromEntries(STEP_KINDS.map((s) => [s.key, s.label]));

type Sched = {
  id: number;
  code: string;
  name: string;
  snapshot: { stack: StackD; resolved?: Record<number, any> };
  status: string;
  plan_split?: string;
};

/**
 * Scheduling a batch (computer only): its equipment blocks under the Calendar, to drag onto their day and time (0.43: Electronic
 * Devices' tray in the core's Calendar). It reads the batch and its bookings, tells the server the plan's blocks (the batch is
 * not Done until each is booked and answered) and books each block for the batch where it is dropped.
 */
export default function Tray({ id, eqs, trained, isAdmin, narrow, version, onDrag, close, open }: TrayProps) {
  const [batch, setBatch] = useState<Sched | null>(null),
    [books, setBooks] = useState<Booking[]>([]);
  const stepsOf = (b: Sched, split: string[]) =>
    bundlesOf(b.snapshot.stack, b.snapshot.resolved, split).map((x) => x.step);
  const load = () => {
    api<Sched>('/batches/' + id)
      .then((b) => {
        setBatch(b);
        if (b?.status !== 'done') {
          const split: string[] = JSON.parse(b.plan_split || '[]');
          api(`/batches/${b.id}/plan`, 'PUT', { steps: stepsOf(b, split), split }).catch(() => {});
        }
      })
      .catch(() => setBatch(null));
    api<Booking[]>(`/batches/${id}/bookings`)
      .then(setBooks)
      .catch(() => {});
  };
  useEffect(load, [id, version]);
  /** the blocks whose annealing goes elsewhere, chosen for this batch */
  const onSplit = (split: string[]) =>
    batch &&
    api(`/batches/${batch.id}/plan`, 'PUT', { steps: stepsOf(batch, split), split })
      .then(load)
      .catch((e) => showToast(e.message));
  const onEnd = (back: boolean) => (back ? open('batches', id) : close());
  const label = (k: string) => STEP_LABEL[k] ?? k;
  // the equipment picked for a block when more than one can take it
  const [pick, setPick] = useState<Record<string, number>>({});
  if (narrow)
    return (
      <p className="mut small cal-hint">
        Scheduling a batch is done on a computer: open the Calendar there to place its equipment blocks.
      </p>
    );
  if (!batch)
    return (
      <div className="tray">
        <p className="mut">Loading the batch…</p>
      </div>
    );
  const chosen: string[] = JSON.parse(batch.plan_split || '[]'),
    split = autoSplit(batch.snapshot.stack, batch.snapshot.resolved, eqs, chosen),
    blocks = bundlesOf(batch.snapshot.stack, batch.snapshot.resolved, split),
    left = blocks.filter((b) => !placedOf(b, books)).length;
  return (
    <section className="tray" aria-label={`Equipment blocks for batch ${batch.name}`}>
      <div className="tray-head">
        <h3>Schedule {batch.name}</h3>
        <span className="mut small">
          {left
            ? `Drag each block to its day and time. ${left} of ${blocks.length} left.`
            : 'Every block is placed. Drag a booking to move it, click it to change its length.'}
        </span>
        <div className="grow" />
        <button className="link" onClick={() => onEnd(false)}>
          Close
        </button>
        <button className="btn" onClick={() => onEnd(true)}>
          {left ? 'Back to the batch' : 'Done'}
        </button>
      </div>
      <div className="tray-blocks">
        {blocks.map((b) => {
          const cands = eqCandidates(b, eqs, trained),
            eq = cands.find((e) => e.id === pick[b.key]) ?? cands[0],
            placed = placedOf(b, books),
            notTrained = !!eq && !isAdmin && !trained.includes(eq.id),
            least = eq?.min_booking ?? MIN_BOOK,
            dur = Math.max(least, b.minutes), // what will be booked: the recipe's time, at least the equipment's shortest booking
            base = b.key.replace(/-anneal$/, ''),
            movable = !placed && !!b.extra && !(split.includes(b.key) && !chosen.includes(b.key));
          const usable = !!eq && !placed && !notTrained;
          return (
            <div key={b.key} className="tray-cell">
              <button
                type="button"
                className={'tray-block' + (placed ? ' placed' : '') + (usable || placed ? '' : ' missing')}
                style={
                  {
                    '--eq': eq?.color ?? 'var(--sep)',
                    minHeight: Math.max(52, Math.min(110, (dur / 60) * HOUR_PX)), // grows to show its text
                  } as React.CSSProperties
                }
                disabled={!usable}
                title={
                  !eq
                    ? `No equipment can do ${b.needs.map(label).join(' and ').toLowerCase()} (set up under Lab › Equipment)`
                    : placed
                      ? `Placed: ${new Date(placed.start).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`
                      : notTrained
                        ? `You are not trained on ${eq.name} yet`
                        : 'Drag onto the calendar'
                }
                onPointerDown={(e) => {
                  if (!usable || e.button !== 0) return;
                  e.preventDefault();
                  onDrag({
                    eq: eq!.id,
                    dur,
                    color: eq!.color,
                    label: eq!.name,
                    grab: Math.min(30, b.minutes / 2),
                    book: (start, end) =>
                      api('/bookings', 'POST', {
                        equipment_id: eq!.id,
                        subject: 'batch',
                        subject_id: id,
                        step: b.step,
                        start,
                        end,
                      }).then((r) => {
                        load();
                        return r as { offHours?: boolean };
                      }),
                  });
                }}
              >
                <b>{eq?.name ?? (b.role ? ROLE_NAME[b.role] : b.needs.map(label).join(', '))}</b>
                <span>{b.what ?? b.layers.join(', ')}</span>
                <span className="tray-t">
                  {placed
                    ? `✓ ${new Date(placed.start).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric' })} ${hm(new Date(placed.start))}`
                    : notTrained
                      ? 'Not trained on it'
                      : `${dur >= 60 ? `${Math.floor(dur / 60)} h${dur % 60 ? ` ${dur % 60}` : ''}` : `${dur} min`}`}
                </span>
              </button>
              {!placed && cands.length > 1 && (
                <select
                  className="tray-eq"
                  aria-label={`Equipment for ${b.step}`}
                  value={eq?.id}
                  onChange={(e) => setPick({ ...pick, [b.key]: +e.target.value })}
                >
                  {cands.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {!isAdmin && !trained.includes(c.id) ? ' (not trained)' : ''}
                    </option>
                  ))}
                </select>
              )}
              {movable && (
                <button
                  type="button"
                  className="link small"
                  onClick={() => onSplit(chosen.includes(base) ? chosen.filter((k) => k !== base) : [...chosen, base])}
                >
                  {chosen.includes(base) ? 'Anneal in the same place' : 'Anneal elsewhere'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
