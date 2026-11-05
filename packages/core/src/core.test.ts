import { describe, it, expect } from 'vitest';
import { plan, solution, SALTS, spinTimeline, metalStages, pattern, convertRate, formula } from './index';

describe('core parity with the HTML prototype', () => {
  it('FAPbI3 salt plan and masses (1 M, 1 mL)', () => {
    expect(plan({ A: { FA: 1 }, X: { I: 1 } })).toEqual({ PbI2: 1, FAI: 1 });
    const r = solution({ A: { FA: 1 }, X: { I: 1 } }, SALTS, 1, 1);
    expect(r.find((x) => x.salt === 'PbI2')!.mg).toBeCloseTo(461.01, 2);
    expect(r.find((x) => x.salt === 'FAI')!.mg).toBeCloseTo(171.97, 2);
    expect(formula({ PbI2: 1, FAI: 1 })).toBe('FAPbI3');
  });
  it('I total combines PbI2, FAI and MAI', () => {
    const p = plan({ A: { FA: 0.9, MA: 0.1 }, X: { I: 1 } });
    expect(2 * p.PbI2 + p.FAI + p.MAI).toBeCloseTo(3, 6);
  });
  it('spin total time is the sum of step times', () => {
    const t = spinTimeline([{ t: 1, rpm: 1000, n2: false, final: false }, { t: 9, rpm: 1000, n2: false, final: false }, { t: 1, rpm: 5000, n2: false, final: false }, { t: 39, rpm: 5000, n2: true, final: true }]);
    expect(t.total).toBe(50);
    expect(t.rows[3].from).toBe(39);
    expect(t.finalOk).toBe(true);
  });
  it('metal stages at 0.1 / 0.2 / 1.0 A/s take 1850 s', () => {
    const m = metalStages([{ until: 5, rate: 0.1 }, { until: 15, rate: 0.2 }, { until: 100, rate: 1 }]);
    expect(m.total).toBeCloseTo(1850, 6);
    expect(m.rows[0].kA).toBeCloseTo(0.05, 6);
  });
  it('rate unit conversion and pattern pixel area', () => {
    expect(convertRate(0.1, 'A/s', 'A/min')).toBe(6);
    expect(pattern('1.2 × 1.2 cm').areas[0]).toBeCloseTo(12, 6);
  });
});
