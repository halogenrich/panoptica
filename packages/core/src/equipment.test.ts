import { describe, expect, it } from 'vitest';
import { abilities, covers, roleFromSteps, stepsFromRole, wouldLoop } from './equipment';

describe('equipment abilities', () => {
  const all = [
    { id: 1, steps: [] }, // a glovebox
    { id: 2, parent_id: 1, steps: ['spin'] },
    { id: 3, parent_id: 1, steps: ['annealing'] },
    { id: 4, parent_id: 1, steps: ['dissolving'] },
    { id: 5, steps: ['uvozone'] },
  ];
  it('a glovebox can do what is inside it', () => {
    expect([...abilities(all[0], all)].sort()).toEqual(['annealing', 'dissolving', 'spin']);
    expect(covers(all[0], all, ['spin', 'annealing'])).toBe(true);
    expect(covers(all[4], all, ['spin'])).toBe(false);
  });
  it('no loops when moving equipment into equipment', () => {
    expect(wouldLoop(1, 2, all)).toBe(true); // the glovebox into its own spin coater
    expect(wouldLoop(5, 1, all)).toBe(false);
  });
  it('older procedures become steps, and steps give back the procedure', () => {
    expect(stepsFromRole('prep', 'UV-Ozone')).toEqual(['uvozone']);
    expect(stepsFromRole('prep', 'Substrate Cleaner')).toEqual(['sonication', 'n2dry']);
    expect(roleFromSteps(stepsFromRole('spinner'))).toBe('spinner');
    expect(roleFromSteps(['jv'])).toBe('measure');
    expect(roleFromSteps(['annealing'])).toBe('');
  });
});
