/**
 * What equipment can do, in the steps the recipes know (the photovoltaics module's steps; another module brings its own).
 * Equipment can hold other equipment (a glovebox with a spin coater, a hotplate and a stirring plate inside): what it can do is
 * its own steps plus those of everything inside it. Booking is for the bookable item (the glovebox), never for what is inside.
 */
export const STEP_KINDS = [
  { key: 'sonication', label: 'Sonication', group: 'Substrate preparation' },
  { key: 'n2dry', label: 'N₂ drying', group: 'Substrate preparation' },
  { key: 'uvozone', label: 'UV-ozone', group: 'Surface treatment' },
  { key: 'plasma', label: 'O₂ plasma', group: 'Surface treatment' },
  { key: 'weighing', label: 'Weighing', group: 'Solutions' },
  { key: 'dissolving', label: 'Dissolving and stirring', group: 'Solutions' },
  { key: 'spin', label: 'Spin coating', group: 'Films' },
  { key: 'annealing', label: 'Annealing', group: 'Films' },
  { key: 'organic', label: 'Organic evaporation', group: 'Evaporation' },
  { key: 'metal', label: 'Metal evaporation', group: 'Evaporation' },
  { key: 'coevap', label: 'Perovskite co-evaporation', group: 'Evaporation' },
  { key: 'jv', label: 'J–V measurement', group: 'Measurement' },
  { key: 'lifetime', label: 'Lifetime', group: 'Measurement' },
] as const;
export type StepKind = (typeof STEP_KINDS)[number]['key'];
export const STEP_KEYS = STEP_KINDS.map((s) => s.key) as StepKind[];
export const stepLabel = (k: string) => STEP_KINDS.find((s) => s.key === k)?.label ?? k;

/** The steps an equipment set up before 0.38 did, from its one procedure (role) and, for substrate preparation, its name. */
export function stepsFromRole(role: string, name = ''): StepKind[] {
  switch (role) {
    case 'prep':
      return /plasma/i.test(name) ? ['plasma'] : /uv|ozone|uvo/i.test(name) ? ['uvozone'] : ['sonication', 'n2dry'];
    case 'scale':
      return ['weighing', 'dissolving'];
    case 'spinner':
      return ['spin', 'annealing'];
    case 'organic':
      return ['organic'];
    case 'metal':
      return ['metal'];
    case 'measure':
      return ['jv', 'lifetime'];
    default:
      return [];
  }
}

/**
 * The one procedure (role) older rules still use, from what an equipment can do: J–V measurement first (it takes finished
 * batches), then evaporation, spin coating, solutions, substrate preparation.
 */
export function roleFromSteps(steps: readonly string[]): string {
  const has = (...k: string[]) => k.some((x) => steps.includes(x));
  if (has('jv', 'lifetime')) return 'measure';
  if (has('metal')) return 'metal';
  if (has('organic', 'coevap')) return 'organic';
  if (has('spin')) return 'spinner';
  if (has('weighing')) return 'scale';
  if (has('sonication', 'n2dry', 'uvozone', 'plasma')) return 'prep';
  return '';
}

export interface EqNode {
  id: number;
  parent_id?: number | null;
  steps?: readonly string[] | null;
}
/** What an equipment can do: its own steps and those of everything inside it (any depth). */
export function abilities(eq: EqNode, all: readonly EqNode[]): Set<string> {
  const out = new Set<string>(eq.steps ?? []),
    seen = new Set([eq.id]);
  const walk = (id: number) => {
    for (const c of all)
      if (c.parent_id === id && !seen.has(c.id)) {
        seen.add(c.id);
        (c.steps ?? []).forEach((s) => out.add(s));
        walk(c.id);
      }
  };
  walk(eq.id);
  return out;
}
/** True when `eq` can do every step in `needs`. */
export const covers = (eq: EqNode, all: readonly EqNode[], needs: readonly string[]) => {
  const a = abilities(eq, all);
  return needs.every((n) => a.has(n));
};
/** Would putting `child` inside `parent` make a loop (parent inside child)? */
export function wouldLoop(child: number, parent: number | null | undefined, all: readonly EqNode[]): boolean {
  let p = parent ?? null;
  for (let i = 0; p != null && i < 100; i++) {
    if (p === child) return true;
    p = all.find((e) => e.id === p)?.parent_id ?? null;
  }
  return false;
}
