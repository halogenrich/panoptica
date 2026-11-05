import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { boxStats, despike, hysteresisIndex, ivDate, ivMetrics, parseIvFiles, splitId } from './iv';

// real exports from the lab's two J–V systems (copied from a measurement day)
const dir = join(__dirname, '..', 'test-data', 'iv');
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const load = (sub: string) => walk(join(dir, sub)).map((f) => ({ name: f.slice(dir.length + 1), text: readFileSync(f, 'latin1') }));
const near = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

describe('file names', () => {
  it('splits sample, substrate and scan', () => {
    expect(splitId('TripleC_Padrao_1_01')).toEqual({ sample: 'TripleC_Padrao', substrate: '1', scan: '01' });
    expect(splitId('TripleC_fulerenol_com_aneal_2_01r')).toEqual({ sample: 'TripleC_fulerenol_com_aneal', substrate: '2', scan: '01r' });
    expect(splitId('pvk_TC_3_1')).toEqual({ sample: 'pvk_TC', substrate: '3', scan: '1' });
    expect(splitId('pvk_TC_4')).toEqual({ sample: 'pvk_TC', substrate: '4', scan: '' });
  });
  it('reads the dates used by both systems', () => {
    expect(ivDate('20_10_26')).toBe('2026-10-20');
    expect(ivDate('20-Sep-2026')).toBe('2026-09-20');
    expect(ivDate('260921')).toBe('2026-09-21');
  });
});

describe('8-pixel system (Padrão)', () => {
  const { curves, warnings } = parseIvFiles(load('padrao'));
  const c = (scan: string, px: string, d = 'fwd') => curves.find((x) => x.scan === scan && x.pixel === px && x.dir === d)!;
  it('reads every pixel, both scan directions, area and light from the settings', () => {
    expect(warnings).toEqual([]);
    expect(curves.filter((x) => x.scan === '01')).toHaveLength(8);
    expect(curves.filter((x) => x.scan === '02')).toHaveLength(16);
    expect(c('01', '3')).toMatchObject({ sample: 'TripleC_Padrao', substrate: '1', date: '2026-10-20', area: 0.02, pin: 100, system: 'padrao' });
    expect(c('02', '3', 'rev').V[0]).toBeGreaterThan(1); // reverse scan starts at high voltage
  });
  it('photocurrent is positive and metrics match the instrument on working pixels', () => {
    const p = c('01', '3'), m = ivMetrics(p.V, p.J, p.pin);
    expect(m.jsc).toBeGreaterThan(20);
    near(m.pce, p.inst!.pce!, 0.05); near(m.voc, p.inst!.voc!, 0.005); near(m.ff, p.inst!.ff!, 0.5); near(m.jsc, p.inst!.jsc!, 0.1);
    expect(m.status).toBe('ok');
  });
  it('flags dead (no current) and shorted (current but no voltage) pixels', () => {
    expect(ivMetrics(c('01', '1').V, c('01', '1').J).status).toBe('dead');
    expect(ivMetrics(c('01', '8').V, c('01', '8').J).status).toBe('dead');
    expect(ivMetrics(c('01', '4').V, c('01', '4').J).status).toBe('short');
  });
  it('hysteresis index from reverse and forward', () => {
    const r = ivMetrics(c('02', '6', 'rev').V, c('02', '6', 'rev').J), f = ivMetrics(c('02', '6').V, c('02', '6').J);
    near(hysteresisIndex(r.pce, f.pce), (17.49 - 17.28) / 17.49, 0.002);
  });
});

describe('1.5 × 2.5 system (Sun)', () => {
  const { curves } = parseIvFiles(load('sun'));
  const c = (px: string, d: string) => curves.find((x) => x.pixel === px && x.dir === d)!;
  it('reads curves, area from I/J, light and the instrument values from Parameters', () => {
    expect(curves).toHaveLength(4);
    expect(c('A1', 'rev')).toMatchObject({ sample: 'pvk_TC', substrate: '1', date: '2026-09-20', area: 0.16, pin: 100, system: 'sun' });
    const m = ivMetrics(c('A1', 'rev').V, c('A1', 'rev').J);
    near(m.pce, c('A1', 'rev').inst!.pce!, 0.05); near(m.jsc, 21.23, 0.01); near(m.voc, 0.93, 0.01);
  });
  it('ignores contact glitches instead of reading them as Voc', () => {
    const p = c('A2', 'fwd'), m = ivMetrics(p.V, p.J);
    expect(m.spikes).toBeGreaterThan(0);
    near(m.voc, 1.0, 0.01); near(m.pce, 10.42, 0.05);
  });
});

describe('statistics', () => {
  it('Tukey box', () => {
    const b = boxStats([1, 2, 3, 4, 5, 6, 7, 8, 100])!;
    expect(b).toMatchObject({ n: 9, median: 5, q1: 3, q3: 7, lo: 1, hi: 8, outliers: [100] });
  });
  it('despike keeps smooth steep curves', () => {
    const p = Array.from({ length: 30 }, (_, i) => [i * 0.05, 25 - Math.exp(i * 0.3) / 20] as [number, number]);
    expect(despike(p).spikes).toBe(0);
  });
});

import { tFraction } from './iv';
describe('stability', () => {
  it('finds T80 and T90 by interpolation', () => {
    const p = [{ t: 0, v: 1 }, { t: 100, v: 0.95 }, { t: 200, v: 0.85 }, { t: 300, v: 0.75 }];
    expect(tFraction(p, 0.9)).toBeCloseTo(150);
    expect(tFraction(p, 0.8)).toBeCloseTo(250);
    expect(tFraction(p, 0.5)).toBeNull();
    expect(tFraction([{ t: 0, v: 1 }, { t: 10, v: 1.05 }, { t: 20, v: 0.7 }], 0.8)).toBeCloseTo(10 + (0.25 / 0.35) * 10);
  });
});
