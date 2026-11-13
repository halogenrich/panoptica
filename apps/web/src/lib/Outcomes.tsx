import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Booking } from '../views/Calendar';

type Pending = Booking & {
  /** the equipment records its atmosphere: O₂ and H₂O (ppm) are written down at the end */
  atmosphere?: number;
  /** only the atmosphere is asked (a booking outside a batch, or a step already answered) */
  atmoOnly?: boolean;
};
type Kind = 'done' | 'postponed' | 'canceled';
const when = (b: Pending) => {
  const s = new Date(b.start),
    e = new Date(b.end),
    t = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${s.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}, ${t(s)}–${t(e)}`;
};

/**
 * After a scheduled step has ended, whoever booked it (or owns the batch) must say how it went: concluded, postponed (to be
 * scheduled again) or canceled, with a reason for the last two. Until then this asks on every page; the batch only becomes
 * Done when every step has an answer.
 */
export default function Outcomes({
  after = {},
}: {
  /** per subject ('batch'): what its module asks after "Concluded" */
  after?: Record<string, React.FC<{ booking: Booking; onClose: () => void }>>;
}) {
  const [list, setList] = useState<Pending[]>([]),
    [pick, setPick] = useState<Record<number, Kind>>({}),
    [why, setWhy] = useState<Record<number, string>>({}),
    [atmo, setAtmo] = useState<Record<number, { o2: string; h2o: string }>>({}),
    [err, setErr] = useState(''),
    [busy, setBusy] = useState(0),
    [follow, setFollow] = useState<Pending | null>(null);
  const load = () =>
    api<Pending[]>('/bookings/pending')
      .then(setList)
      .catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    window.addEventListener('psc-bookings', load);
    window.addEventListener('psc-refresh', load);
    return () => {
      clearInterval(t);
      window.removeEventListener('psc-bookings', load);
      window.removeEventListener('psc-refresh', load);
    };
  }, []);
  // after "Concluded": what the subject's module asks next (Electronic Devices: the run data of the step's recipes)
  if (follow) {
    const F = after[follow.subject];
    return F ? <F booking={follow} onClose={() => setFollow(null)} /> : null;
  }
  if (!list.length) return null;
  const atmoOf = (b: Pending) => {
    const a = atmo[b.id];
    return a && a.o2.trim() !== '' && a.h2o.trim() !== '' && +a.o2 >= 0 && +a.h2o >= 0
      ? { o2: +a.o2, h2o: +a.h2o }
      : undefined;
  };
  const sendAtmo = (b: Pending) => {
    setBusy(b.id);
    api(`/bookings/${b.id}/atmosphere`, 'POST', atmoOf(b))
      .then(() => {
        setErr('');
        setList((l) => l.filter((x) => x.id !== b.id));
      })
      .catch((e) => setErr(e.message))
      .finally(() => setBusy(0));
  };
  const send = (b: Pending, outcome: Kind) => {
    setBusy(b.id);
    api(`/bookings/${b.id}/outcome`, 'POST', { outcome, reason: why[b.id], atmo: atmoOf(b) })
      .then(() => {
        setErr('');
        setList((l) => l.filter((x) => x.id !== b.id));
        window.dispatchEvent(new Event('psc-bookings'));
        if (outcome === 'done' && b.subject && after[b.subject]) setFollow(b);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setBusy(0));
  };
  return (
    <div className="scrim outcome-scrim">
      <div className="dialog wide outcomes" role="dialog" aria-modal="true" aria-labelledby="outcomes-h">
        <div className="dialog-head">
          <h2 id="outcomes-h">
            {list.every((b) => b.atmoOnly)
              ? 'Glovebox atmosphere'
              : list.length === 1
                ? 'How did this step go?'
                : `How did these ${list.length} steps go?`}
          </h2>
        </div>
        <p className="mut small">The booked time is over. Each batch is closed only when all its steps are answered.</p>
        {list.map((b) => {
          const k = pick[b.id],
            needWhy = k === 'postponed' || k === 'canceled',
            needAtmo = !!b.atmosphere && (b.atmoOnly || k === 'done'),
            ok = (!needWhy || (why[b.id] ?? '').trim().length >= 3) && (!needAtmo || !!atmoOf(b));
          const atmoFields = !!b.atmosphere && (b.atmoOnly || !!k) && (
            <div className="atmo-row">
              <label className="fld">
                <span>O₂ (ppm){needAtmo ? '' : ', if measured'}</span>
                <input
                  inputMode="decimal"
                  value={atmo[b.id]?.o2 ?? ''}
                  onChange={(e) => setAtmo({ ...atmo, [b.id]: { o2: e.target.value, h2o: atmo[b.id]?.h2o ?? '' } })}
                />
              </label>
              <label className="fld">
                <span>H₂O (ppm){needAtmo ? '' : ', if measured'}</span>
                <input
                  inputMode="decimal"
                  value={atmo[b.id]?.h2o ?? ''}
                  onChange={(e) => setAtmo({ ...atmo, [b.id]: { o2: atmo[b.id]?.o2 ?? '', h2o: e.target.value } })}
                />
              </label>
            </div>
          );
          if (b.atmoOnly)
            return (
              <section key={b.id} className="outcome" style={{ '--eq': b.color } as React.CSSProperties}>
                <div className="outcome-what">
                  <div>
                    <b>{b.equipment}</b>
                    <i className="cbar" />
                    <span>
                      {b.subject ? `${b.subject_name || b.subject_code}${b.step ? ` (${b.step})` : ''}` : b.purpose}
                    </span>
                    <span className="mut small">{when(b)}</span>
                  </div>
                </div>
                <p className="mut small">The glovebox atmosphere at the end of the booking.</p>
                {atmoFields}
                <div className="dialog-actions">
                  <button className="btn" disabled={!ok || busy === b.id} onClick={() => sendAtmo(b)}>
                    Save
                  </button>
                </div>
              </section>
            );
          return (
            <section key={b.id} className="outcome" style={{ '--eq': b.color } as React.CSSProperties}>
              <div className="outcome-what">
                <div>
                  <b>{b.equipment}</b>
                  <i className="cbar" />
                  <span>
                    {b.subject_name || b.subject_code}
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
                      k === 'postponed'
                        ? 'For example, glovebox O₂ too high, finish on Thursday'
                        : 'For example, the films dewetted'
                    }
                    onChange={(e) => setWhy({ ...why, [b.id]: e.target.value })}
                  />
                </label>
              )}
              {atmoFields}
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
