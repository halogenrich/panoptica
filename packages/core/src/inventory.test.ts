import { describe, expect, it } from 'vitest';
import { forecast, fmtAmount, periodStart, series, toBase } from './inventory';

describe('inventory', () => {
  it('converts units, with density across mass and volume', () => {
    expect(toBase(2.5, 'g', 'mg')).toBe(2500);
    expect(toBase(1, 'L', 'µL')).toBe(1e6);
    expect(toBase(10, 'mL', 'mg', 1.1)).toBeCloseTo(11000);
    expect(toBase(10, 'mL', 'mg')).toBeNull();
    expect(fmtAmount(1234, 'mg')).toBe('1.23 g');
  });
  it('groups by Monday weeks and months', () => {
    expect(periodStart('2026-11-04 10:00:00', 'week')).toBe('2026-11-02'); // Wednesday → Monday
    expect(periodStart('2026-11-02', 'week')).toBe('2026-11-02');
    expect(periodStart('2026-11-08T23:00:00Z', 'week')).toBe('2026-11-02'); // Sunday
    expect(periodStart('2026-11-30', 'month')).toBe('2026-11-01');
    const s = series(
      [
        { date: '2026-10-06', v: 1 },
        { date: '2026-10-07', v: 2 },
        { date: '2026-10-20', v: 4 },
      ],
      'week',
      '2026-10-05',
      '2026-10-21',
    );
    expect(s.map((x) => x.v)).toEqual([3, 0, 4]);
  });
  it('forecasts run-out from recent use and flags unusual weeks', () => {
    const s = [1, 1, 1.2, 0.8, 1, 1, 6, 0].map((v, i) => ({ start: String(i), v }));
    const f = forecast(s, 10, 'week');
    expect(f.rate).toBeCloseTo(12 / 7);
    expect(f.unusual[6]).toBe(true);
    expect(f.unusual.filter(Boolean).length).toBe(1);
    expect(forecast([{ start: 'a', v: 0 }], 5, 'week').periods).toBe(Infinity);
    expect(
      forecast(
        [0, 0, 0, 0, 0, 2, 2].map((v, i) => ({ start: String(i), v })),
        1,
        'week',
      ).unusual.some(Boolean),
    ).toBe(false);
  });
});
