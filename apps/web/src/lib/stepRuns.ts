import { bundlesOf } from './bundles';
import { slotPresets } from '../views/BatchReport';
import type { Batch } from '../views/Batches';
import type { Booking } from '../views/Calendar';
import { fmtDate, fmtDateTime } from './ui';

/** One recipe of a booked step that takes run data. */
export type StepPreset = { slot: number; id: string; seg: string; name: string; layer: string };

/**
 * The recipes whose run data a booked step produces. Scheduler bookings carry the step of their equipment block: the scale
 * session prepares the solutions of the spin-coated layers, the spinner session spins them (the spin programs), an evaporator run
 * makes its layers. A single booking named after a layer covers that layer's recipes.
 */
export function stepPresets(b: Pick<Batch, 'snapshot'>, step: string): StepPreset[] {
  const sl = b.snapshot.stack.sl,
    name = (i: number, seg: string) => (b.snapshot.resolved[i] ?? {})[seg === 's2' ? 'b' : 'a']?.name ?? 'Recipe';
  const bundle = bundlesOf(b.snapshot.stack).find((x) => x.step === step);
  const slots = bundle
    ? sl.map((s, i) => ({ s, i })).filter(({ s }) => bundle.layers.includes(s.n))
    : sl.map((s, i) => ({ s, i })).filter(({ s }) => s.n === step);
  const segOk = (seg: string) =>
    !bundle ? true : bundle.role === 'scale' ? seg === 's1' : bundle.role === 'spinner' ? seg === 's2' : true;
  return slots.flatMap(({ s, i }) =>
    slotPresets(s)
      .filter((p) => segOk(p.seg))
      .map((p) => ({ slot: i, id: p.id, seg: p.seg, name: name(i, p.seg), layer: s.n })),
  );
}

/** A layer's state from the calendar: its bookings (a scheduler block covers several layers) and their outcomes. */
export function layerState(b: Pick<Batch, 'snapshot'>, books: Booking[], i: number): { text: string; done: boolean } {
  const ks = books
    .filter((k) => k.outcome !== 'canceled')
    .filter((k) => {
      const items = stepPresets(b, k.step);
      return items.some((x) => x.slot === i) || (!items.length && k.step === b.snapshot.stack.sl[i].n);
    });
  if (!ks.length) return { text: 'Not scheduled', done: false };
  if (ks.every((k) => k.outcome === 'done')) return { text: `Concluded ${fmtDate(ks[ks.length - 1].end)}`, done: true };
  const next = ks.find((k) => !k.outcome);
  return { text: next ? `Booked ${fmtDateTime(next.start)}` : 'Postponed, to be scheduled again', done: false };
}
