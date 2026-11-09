import type { StackD } from '../stacks/model';

export type Role = 'prep' | 'scale' | 'spinner' | 'organic' | 'metal';
/**
 * One block to place in the calendar: one piece of equipment, used once, for one or more steps of the batch. Substrate
 * preparation can be two blocks on two pieces of equipment: cleaning (sonication, drying) and surface treatment (UV-ozone,
 * plasma); `part` tells them apart, `what` says what is done, and `noRuns` marks the block whose run data is asked for at
 * the other one (the substrate recipe's run data covers both, entered once).
 */
export type Bundle = {
  key: string;
  role: Role;
  step: string;
  layers: string[];
  minutes: number;
  part?: 'clean' | 'surface';
  what?: string;
  noRuns?: boolean;
};
/** The recipes the batch was started with, per layer (the batch snapshot's `resolved`). */
type Resolved = Record<number, { a?: { data: any } | null } | undefined>;
export const ROLE_NAME: Record<Role, string> = {
  prep: 'Substrate preparation',
  scale: 'Solution preparation',
  spinner: 'Spin coating',
  organic: 'Organic evaporation',
  metal: 'Metal evaporation',
};

const roleOf = (m: string): Role | null =>
  m === 'Spin' ? 'spinner' : m === 'Organic evap' ? 'organic' : m === 'Metal evap' ? 'metal' : null;

type Step = { s: string; m: number };
const mins = (l: Step[]) => l.reduce((t, x) => t + (+x.m || 0), 0);
/** Booked lengths are recipe times rounded up to 5 min. */
const up5 = (m: number) => Math.ceil(m / 5) * 5;

/**
 * The blocks a batch needs, by equipment: substrate cleaning takes its sonication and drying times, surface treatment its
 * own time (a block of its own when the recipe has one); every solution of the stack is prepared in one session on the scale; layers made
 * one after another on the same equipment (two spin-coated layers, C60 then BCP in the organic evaporator) share one session.
 * Durations are starting points (20 min per solution, 40 min per spin-coated layer, 60 min per organic layer with at least
 * 90, 150 min per metal run); a booking can be stretched in the calendar.
 */
export function bundlesOf(st: StackD, resolved?: Resolved): Bundle[] {
  const out: Bundle[] = [],
    spins = st.sl.filter((s) => s.m === 'Spin').map((s) => s.n);
  // cleaning and surface treatment of the substrates (UV-ozone and the like), first, when the stack has a substrate recipe
  const si = st.sl.findIndex((s) => s.m === 'Substrate' && s.a),
    sub = st.sl[si];
  if (sub) {
    const d = resolved?.[si]?.a?.data,
      steps: Step[] = Array.isArray(d?.steps) ? d.steps : [],
      sf: Step[] = Array.isArray(d?.sf) ? d.sf : [];
    const dry = sf.filter((x) => x.s === 'N2 dry'),
      surface = sf.filter((x) => x.s !== 'N2 dry' && +x.m > 0);
    const clean = steps.length ? up5(mins(steps) + mins(dry)) : 60; // batches without the recipe at hand: one hour
    out.push({
      key: 'prep',
      role: 'prep',
      layers: [sub.n],
      step: `Substrate preparation: ${sub.n}`,
      minutes: clean,
      part: 'clean',
      what: steps.length ? `${sub.n}: sonication${dry.length ? ', N2 dry' : ''}` : undefined,
      noRuns: surface.length > 0,
    });
    if (surface.length)
      out.push({
        key: 'prep-surface',
        role: 'prep',
        layers: [sub.n],
        step: `Surface treatment: ${sub.n}`,
        minutes: up5(mins(surface)),
        part: 'surface',
        what: `${sub.n}: ${surface.map((x) => x.s).join(', ')}`,
      });
  }
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

const SURFACE_EQ = /uv|ozone|plasma/i;
/**
 * The equipment for a block: the first one set up for its procedure. With two for substrate preparation, surface treatment
 * goes to the UV-ozone or plasma one (by name or drawing) and cleaning to the other.
 */
export function eqFor<E extends { role: string; name: string; art?: string | null }>(
  b: Bundle,
  eqs: E[],
): E | undefined {
  const all = eqs.filter((e) => e.role === b.role);
  if (b.role !== 'prep' || all.length < 2) return all[0];
  const surf = (e: E) => SURFACE_EQ.test(e.name) || e.art === 'uvozone';
  return (b.part === 'surface' ? all.find(surf) : all.find((e) => !surf(e))) ?? all[0];
}

/** Placed: a booking of the batch with this step that is not waiting to be rebooked (postponed with no newer booking). */
export function placedOf<T extends { step: string; outcome?: string | null }>(b: Bundle, bookings: T[]): T | null {
  const mine = bookings.filter((k) => k.step === b.step);
  return mine.find((k) => !k.outcome) ?? mine.find((k) => k.outcome === 'done' || k.outcome === 'canceled') ?? null;
}
