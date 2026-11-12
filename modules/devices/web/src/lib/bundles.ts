import { covers } from '@psc/core';
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
  role: Role | '';
  /**
   * The recipe steps the block needs its equipment to do (0.38): the scheduler picks equipment that can do all of them,
   * a glovebox counting what is inside it.
   */
  needs: string[];
  /**
   * A step that is done in the same place by default but can be done elsewhere (annealing outside the spin coater's
   * glovebox): then it becomes a block of its own.
   */
  extra?: { step: string; minutes: number };
  step: string;
  layers: string[];
  minutes: number;
  part?: 'clean' | 'surface';
  what?: string;
  noRuns?: boolean;
};
/** The recipes the batch was started with, per layer (the batch snapshot's `resolved`). */
type Resolved = Record<number, { a?: { data: any } | null; b?: { data: any } | null } | undefined>;
export const ROLE_NAME: Record<Role, string> = {
  prep: 'Substrate preparation',
  scale: 'Solution preparation',
  spinner: 'Spin coating',
  organic: 'Organic evaporation',
  metal: 'Metal evaporation',
};

const SURF_STEP: Record<string, string> = { 'UV-ozone': 'uvozone', 'O2 plasma': 'plasma' };
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
export function bundlesOf(st: StackD, resolved?: Resolved, split: readonly string[] = []): Bundle[] {
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
      needs: ['sonication', ...(dry.length ? ['n2dry'] : [])],
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
        needs: [...new Set(surface.map((x) => SURF_STEP[x.s] ?? 'uvozone'))],
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
      needs: ['weighing', 'dissolving'],
      layers: spins,
      step: `Solutions: ${spins.join(', ')}`,
      minutes: Math.max(30, 20 * spins.length),
    });
  let run: { role: Role; layers: string[]; anneal: number } | null = null;
  const flush = () => {
    if (!run) return;
    const n = run.layers.length,
      min = run.role === 'spinner' ? 40 * n : run.role === 'organic' ? Math.max(90, 60 * n) : 150 * n;
    const key = `${run.role}-${out.length}`,
      main = run.role === 'spinner' ? 'spin' : run.role;
    // annealing after spin coating: in the same glovebox unless the batch moves it elsewhere (its own block, then)
    const anneal =
      run.role === 'spinner' && run.anneal > 0 ? { step: 'annealing', minutes: up5(run.anneal) } : undefined;
    const apart = !!anneal && split.includes(key);
    out.push({
      key,
      role: run.role,
      needs: anneal && !apart ? [main, 'annealing'] : [main],
      extra: anneal,
      layers: run.layers,
      step: run.layers.join(' + '),
      minutes: min,
    });
    if (anneal && apart)
      out.push({
        key: key + '-anneal',
        role: '',
        needs: ['annealing'],
        layers: run.layers,
        step: `Annealing: ${run.layers.join(' + ')}`,
        minutes: anneal.minutes,
        what: `${run.layers.join(', ')}: annealing`,
      });
    run = null;
  };
  st.sl.forEach((s, i) => {
    const r = roleOf(s.m);
    if (!r) {
      flush();
      return;
    } // a manual or substrate step in between breaks the session
    const sp = resolved?.[i]?.b?.data;
    const an = r === 'spinner' && sp?.an ? +sp.aM || 0 : 0;
    if (run && run.role === r) {
      run.layers.push(s.n);
      run.anneal += an;
    } else {
      flush();
      run = { role: r, layers: [s.n], anneal: an };
    }
  });
  flush();
  return out;
}

type EqLike = {
  id: number;
  role: string;
  name: string;
  art?: string | null;
  steps?: string[];
  parent_id?: number | null;
  booked?: boolean;
  active?: boolean | number;
};
/**
 * The equipment that can take a block: active, booked by itself, and able to do every step it needs (with what is inside it).
 * Those the person is trained on come first; for surface treatment, one named for it (UV-ozone, plasma) before others.
 */
export function eqCandidates<E extends EqLike>(b: Bundle, eqs: E[], trained?: number[]): E[] {
  const ok = eqs.filter((e) => e.active !== false && e.active !== 0 && e.booked !== false && covers(e, eqs, b.needs));
  const score = (e: E) =>
    (trained && !trained.includes(e.id) ? 2 : 0) +
    (b.part === 'surface' && !(SURFACE_EQ.test(e.name) || e.art === 'uvozone') ? 1 : 0);
  return [...ok].sort((x, y) => score(x) - score(y));
}

const SURFACE_EQ = /uv|ozone|plasma/i;
/** The equipment a block goes to unless the person picks another: the first of `eqCandidates`. */
export const eqFor = <E extends EqLike>(b: Bundle, eqs: E[], trained?: number[]): E | undefined =>
  eqCandidates(b, eqs, trained)[0];
/**
 * Blocks whose extra step (annealing) must go elsewhere because no equipment does both: added to the batch's own choice.
 */
export function autoSplit<E extends EqLike>(st: StackD, resolved: Resolved | undefined, eqs: E[], split: string[]) {
  const out = [...split];
  for (const b of bundlesOf(st, resolved, split))
    if (b.extra && !out.includes(b.key) && !eqCandidates(b, eqs).length) out.push(b.key);
  return out;
}

/** Placed: a booking of the batch with this step that is not waiting to be rebooked (postponed with no newer booking). */
export function placedOf<T extends { step: string; outcome?: string | null }>(b: Bundle, bookings: T[]): T | null {
  const mine = bookings.filter((k) => k.step === b.step);
  return mine.find((k) => !k.outcome) ?? mine.find((k) => k.outcome === 'done' || k.outcome === 'canceled') ?? null;
}
