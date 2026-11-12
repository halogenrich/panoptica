/**
 * What equipment can do, in the steps the recipes know: the photovoltaics steps (0.43: this module's own; the core keeps none and
 * learns each module's from its manifest).
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
