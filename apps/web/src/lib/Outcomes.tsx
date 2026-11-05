import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Booking } from '../views/Calendar';

type Pending = Booking & { batch_name: string };
type Kind = 'done' | 'postponed' | 'canceled';
const when = (b: Pending) => {
  const s = new Date(b.start),
    e = new Date(b.end),
    t = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${s.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}, ${t(s)}–${t(e)}`;
};

/**
 * After a scheduled step has ended, whoever booked it (or owns the batch) must say how it went: concluded, postponed (to be
 * scheduled again) or canceled, with a reason for the last two. Until then this asks on every page; the batch only becomes
 * Done when every step has an answer.
 */
export default function Outcomes() {
  const [list, setList] = useState<Pending[]>([]),
    [pick, setPick] = useState<Record<number, Kind>>({}),
    [why, setWhy] = useState<Record<number, string>>({}),
    [err, setErr] = useState(''),
    [busy, setBusy] = useState(0);
  const load = () =>
    api<Pending[]>('/bookings/pending')
      .then(setList)
      .catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    window.addEventListener('psc-batches', load);
    window.addEventListener('psc-refresh', load);
    return () => {
      clearInterval(t);
      window.removeEventListener('psc-batches', load);
      window.removeEventListener('psc-refresh', load);
    };
  }, []);
  if (!list.length) return null;
  const send = (b: Pending, outcome: Kind) => {
    setBusy(b.id);
    api(`/bookings/${b.id}/outcome`, 'POST', { outcome, reason: why[b.id] })
      .then(() => {
        setErr('');
        setList((l) => l.filter((x) => x.id !== b.id));
        window.dispatchEvent(new Event('psc-batches'));
      })
      .catch((e) => setErr(e.message))
      .finally(() => setBusy(0));
  };
  return (
    <div className="scrim outcome-scrim">
      <div className="dialog wide outcomes" role="dialog" aria-modal="true" aria-labelledby="outcomes-h">
        <div className="dialog-head">
          <h2 id="outcomes-h">
            {list.length === 1 ? 'How did this step go?' : `How did these ${list.length} steps go?`}
          </h2>
        </div>
        <p className="mut small">The booked time is over. Each batch is closed only when all its steps are answered.</p>
        {list.map((b) => {
          const k = pick[b.id],
            needWhy = k === 'postponed' || k === 'canceled',
            ok = !needWhy || (why[b.id] ?? '').trim().length >= 3;
          return (
            <section key={b.id} className="outcome" style={{ '--eq': b.color } as React.CSSProperties}>
              <div className="outcome-what">
                <i />
                <div>
                  <b>{b.equipment}</b>
                  <span>
                    {b.batch_code}
                    {b.step ? ` (${b.step})` : ''}
                  </span>
                  <span className="mut small">{when(b)}</span>
                </div>
              </div>
              <div className="outcome-pick" role="radiogroup" aria-label="Outcome">
                {(
                  [
                    ['done', 'Concluded'],
                    ['postponed', 'Postponed'],
                    ['canceled', 'Canceled'],
                  ] as [Kind, string][]
                ).map(([v, l]) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={k === v}
                    className={'op-' + v + (k === v ? ' on' : '')}
                    onClick={() => setPick({ ...pick, [b.id]: v })}
                  >
                    {l}
                  </button>
                ))}
              </div>
              {needWhy && (
                <label className="fld">
                  <span>{k === 'postponed' ? 'Why was it postponed?' : 'Why was it canceled?'}</span>
                  <input
                    autoFocus
                    value={why[b.id] ?? ''}
                    placeholder={
                      k === 'postponed' ? 'e.g. glovebox O₂ too high, finish on Thursday' : 'e.g. the films dewetted'
                    }
                    onChange={(e) => setWhy({ ...why, [b.id]: e.target.value })}
                  />
                </label>
              )}
              {k === 'postponed' && (
                <p className="mut small">
                  Schedule the step again from the batch page; the batch stays Running until then.
                </p>
              )}
              {k && (
                <div className="dialog-actions">
                  <button className="btn" disabled={!ok || busy === b.id} onClick={() => send(b, k)}>
                    Save
                  </button>
                </div>
              )}
            </section>
          );
        })}
        {err && <p className="err small">{err}</p>}
      </div>
    </div>
  );
}
