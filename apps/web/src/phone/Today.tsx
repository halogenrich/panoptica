import { useMemo, type FC } from 'react';
import type { PhoneProps } from '../modules/types';
import { BookingRow, dayIn, hm, startOfDay, useCal } from './parts';

/**
 * Today (0.55): what this person has booked now or next, the rest of their day, then each module's part (Electronic Devices:
 * their batches and the step each is at). Ended bookings are answered in the question that opens by itself, as on a computer.
 */
export default function Today({
  go,
  parts = [],
  ...p
}: PhoneProps & { parts?: { id: string; Part: FC<PhoneProps> }[] }) {
  const from = useMemo(() => startOfDay(new Date()), []);
  const { d, err } = useCal(from, 14);
  const now = Date.now();
  const mine = (d?.bookings ?? []).filter((k) => k.mine && k.outcome !== 'canceled'),
    current = mine.find((k) => new Date(k.start).getTime() <= now && new Date(k.end).getTime() > now),
    next = mine.find((k) => new Date(k.start).getTime() > now),
    hero = current ?? next,
    today = mine.filter(
      (k) =>
        k !== hero && new Date(k.end).getTime() > now && startOfDay(new Date(k.start)).getTime() === from.getTime(),
    );
  return (
    <div className="ph-stack">
      <section className="group ph-hero" aria-label={current ? 'Booked now' : 'Next booking'}>
        {!d ? (
          <p className="mut">{err || 'Loading…'}</p>
        ) : hero ? (
          <>
            <div className="ph-hero-when">
              {current ? `Now, until ${hm(current.end)}` : `Next: ${dayIn(new Date(hero.start))}`}
            </div>
            <BookingRow k={hero} big />
          </>
        ) : (
          <>
            <p>Nothing booked for the next 14 days.</p>
            {d.equipment.some((e) => e.active && e.booked !== false) && (
              <button className="btn ph-wide" onClick={() => go('book')}>
                Book equipment
              </button>
            )}
          </>
        )}
      </section>
      {today.length > 0 && (
        <section className="group">
          <h3>Later today</h3>
          <div className="ph-list">
            {today.map((k) => (
              <BookingRow key={k.id} k={k} />
            ))}
          </div>
        </section>
      )}
      {parts.map(({ id, Part }) => (
        <Part key={id} {...p} go={go} />
      ))}
    </div>
  );
}
