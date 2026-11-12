import { describe, it, expect } from 'vitest';
import { spinPlan } from './index';

describe('spinPlan', () => {
  it('orders events and totals volumes', () => {
    const steps = [
      { t: 10, rpm: 1000, n2: false, final: false },
      { t: 30, rpm: 5000, n2: true, final: true },
    ];
    const r = spinPlan(
      steps,
      [
        { src: 'Solvent: CB', v: 100, filter: false, when: 'remaining', at: 10 },
        { src: 'Preset: A', v: 50, filter: true, when: 'before', at: 0 },
        { src: 'Preset: A', v: 50, filter: true, when: 'remaining', at: 99 },
      ],
      4,
      25,
    );
    expect(r.total).toBe(40);
    expect(r.events.map((e) => e.when)).toEqual(['before', 'remaining', 'remaining']);
    expect(r.events[1].over).toBe(true);
    expect(r.vol['Preset: A']).toBeCloseTo(0.5, 6);
  });
});
