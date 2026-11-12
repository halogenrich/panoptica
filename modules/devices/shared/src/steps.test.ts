import { describe, expect, it } from 'vitest';
import { roleFromSteps, stepsFromRole } from './steps';

describe('photovoltaics steps', () => {
  it('older procedures become steps, and steps give back the procedure', () => {
    expect(stepsFromRole('prep', 'UV-Ozone')).toEqual(['uvozone']);
    expect(stepsFromRole('prep', 'Substrate Cleaner')).toEqual(['sonication', 'n2dry']);
    expect(roleFromSteps(stepsFromRole('spinner'))).toBe('spinner');
    expect(roleFromSteps(['jv'])).toBe('measure');
    expect(roleFromSteps(['annealing'])).toBe('');
  });
});
