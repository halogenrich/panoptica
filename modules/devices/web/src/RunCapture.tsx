import { useEffect, useState } from 'react';
import { api } from '@web/api';
import type { Booking } from '@web/views/Calendar';
import { snapCtx, type Batch } from './views/Batches';
import { KINDS } from './recipes';
import { norm } from './recipes/types';
import { RunForm } from './lib/Library';
import { stepCaptures, type StepPreset } from './lib/stepRuns';

/**
 * After a batch step is concluded: the run data of the step's recipes, one form after the other (0.43: Electronic Devices'
 * answer to the core's outcome question). Nothing to ask closes at once.
 */
export default function RunCapture({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const [capture, setCapture] = useState<{ b: Batch; items: StepPreset[]; at: number } | null>(null);
  useEffect(() => {
    api<Batch>('/batches/' + booking.subject_id)
      .then((bt) => {
        const items = stepCaptures(bt, booking.step);
        if (items.length) setCapture({ b: bt, items, at: 0 });
        else onClose();
      })
      .catch(onClose);
  }, [booking.id]);
  if (!capture) return null;
  const it = capture.items[capture.at],
    k = KINDS[it.seg],
    d = norm(k, (capture.b.snapshot.resolved[it.slot] ?? {})[it.seg === 's2' ? 'b' : 'a']?.data ?? {}),
    next = () => (capture.at + 1 < capture.items.length ? setCapture({ ...capture, at: capture.at + 1 }) : onClose());
  return (
    <div className="scrim outcome-scrim">
      <div className="dialog wide outcomes" role="dialog" aria-modal="true" aria-labelledby="runs-h">
        <div className="dialog-head">
          <h2 id="runs-h">Run data: {it.name}</h2>
          {capture.items.length > 1 && (
            <span className="mut small">
              {capture.at + 1} of {capture.items.length}
            </span>
          )}
        </div>
        <p className="mut small">
          {booking.subject_code}, {it.layer}. The step is concluded; write down what the run actually was. If the
          notebook is not at hand, choose Add it later: the batch page keeps asking for it and you get a reminder.
        </p>
        <RunForm
          key={capture.at}
          kind={k}
          ctx={snapCtx(capture.b)}
          d={d}
          presetId={+it.id}
          batch={booking.subject_code}
          required
          onCancel={next}
          onDone={() => {
            window.dispatchEvent(new Event('psc-bookings'));
            next();
          }}
          onLater={() => {
            api(`/bookings/${booking.id}/runs-later`, 'POST', {}).catch(() => {});
            onClose();
          }}
        />
      </div>
    </div>
  );
}
