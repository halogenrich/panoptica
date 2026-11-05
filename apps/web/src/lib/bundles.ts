import type { StackD } from '../stacks/model';

export type Role = 'scale' | 'spinner' | 'organic' | 'metal';
/** One block to place in the calendar: one piece of equipment, used once, for one or more steps of the batch. */
export type Bundle = { key: string; role: Role; step: string; layers: string[]; minutes: number };
export const ROLE_NAME: Record<Role, string> = {
  scale: 'Solution preparation',
  spinner: 'Spin coating',
  organic: 'Organic evaporation',
  metal: 'Metal evaporation',
};

const roleOf = (m: string): Role | null =>
  m === 'Spin' ? 'spinner' : m === 'Organic evap' ? 'organic' : m === 'Metal evap' ? 'metal' : null;

/**
 * The blocks a batch needs, by equipment: every solution of the stack is prepared in one session on the scale; layers made
 * one after another on the same equipment (two spin-coated layers, C60 then BCP in the organic evaporator) share one session.
 * Durations are starting points (20 min per solution, 40 min per spin-coated layer, 60 min per organic layer with at least
 * 90, 150 min per metal run); a booking can be stretched in the calendar.
 */
export function bundlesOf(st: StackD): Bundle[] {
  const out: Bundle[] = [],
    spins = st.sl.filter((s) => s.m === 'Spin').map((s) => s.n);
  if (spins.length)
    out.push({
      key: 'scale',
      role: 'scale',
      layers: spins,
      step: `Solutions: ${spins.join(', ')}`,
      minutes: Math.max(30, 20 * spins.length),
    });
  let run: { role: Role; layers: string[] } | null = null;
  const flush = () => {
    if (!run) return;
    const n = run.layers.length,
      min = run.role === 'spinner' ? 40 * n : run.role === 'organic' ? Math.max(90, 60 * n) : 150 * n;
    out.push({
      key: `${run.role}-${out.length}`,
      role: run.role,
      layers: run.layers,
      step: run.layers.join(' + '),
      minutes: min,
    });
    run = null;
  };
  for (const s of st.sl) {
    const r = roleOf(s.m);
    if (!r) {
      flush();
      continue;
    } // a manual or substrate step in between breaks the session
    if (run && run.role === r) run.layers.push(s.n);
    else {
      flush();
      run = { role: r, layers: [s.n] };
    }
  }
  flush();
  return out;
}

/** Placed: a booking of the batch with this step that is not waiting to be rebooked (postponed with no newer booking). */
export function placedOf<T extends { step: string; outcome?: string | null }>(b: Bundle, bookings: T[]): T | null {
  const mine = bookings.filter((k) => k.step === b.step);
  return mine.find((k) => !k.outcome) ?? mine.find((k) => k.outcome === 'done' || k.outcome === 'canceled') ?? null;
}
