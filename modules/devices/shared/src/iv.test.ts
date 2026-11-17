import { describe, it, expect } from 'vitest';
import type { Dir } from './iv';
import { A, csvBackwardFirst, csvFiles, txtFiles } from './ivfixtures';
import {
  boxStats,
  checkSweeps,
  shortedPixels,
  despike,
  hysteresisIndex,
  ivDate,
  ivMetrics,
  parseIvFiles,
  splitId,
  sweepDir,
  sweepStep,
} from './iv';

const near = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

describe('file names', () => {
  it('splits sample, substrate and scan', () => {
    expect(splitId('Control_1_01')).toEqual({ sample: 'Control', substrate: '1', scan: '01' });
    expect(splitId('Additive_x_annealed_2_01r')).toEqual({
      sample: 'Additive_x_annealed',
      substrate: '2',
      scan: '01r',
    });
    expect(splitId('Ref_3_1')).toEqual({ sample: 'Ref', substrate: '3', scan: '1' });
    expect(splitId('Ref_4')).toEqual({ sample: 'Ref', substrate: '4', scan: '' });
  });
  it('reads the dates used by both systems', () => {
    expect(ivDate('15_03_26')).toBe('2026-03-15');
    expect(ivDate('14-Mar-2026')).toBe('2026-03-14');
    expect(ivDate('260314')).toBe('2026-03-14');
  });
});

describe('multi-pixel CSV export', () => {
  const { curves, warnings } = parseIvFiles(csvFiles());
  const c = (scan: string, px: string, d = 'fwd') =>
    curves.find((x) => x.scan === scan && x.pixel === px && x.dir === d)!;
  it('reads every pixel, both scan directions, area and light from the settings', () => {
    expect(warnings).toEqual([]);
    expect(curves.filter((x) => x.scan === '01')).toHaveLength(8);
    expect(curves.filter((x) => x.scan === '02')).toHaveLength(16);
    expect(c('01', '3')).toMatchObject({
      sample: 'Control',
      substrate: '1',
      date: '2026-03-15',
      area: 0.02,
      pin: 100,
      system: 'csv',
    });
    expect(c('02', '3', 'rev').V[0]).toBeGreaterThan(1); // reverse scan starts at high voltage
  });
  it('photocurrent is positive and metrics match the instrument on working pixels', () => {
    const p = c('02', '3'),
      m = ivMetrics(p.V, p.J, p.pin);
    expect(m.jsc).toBeGreaterThan(20);
    near(m.pce, p.inst!.pce!, 0.05);
    near(m.voc, p.inst!.voc!, 0.005);
    near(m.ff, p.inst!.ff!, 0.5);
    near(m.jsc, p.inst!.jsc!, 0.1);
    expect(m.status).toBe('ok');
  });
  it('flags dead (no current) and shorted (current but no voltage) pixels', () => {
    expect(ivMetrics(c('01', '1').V, c('01', '1').J).status).toBe('dead');
    expect(ivMetrics(c('01', '8').V, c('01', '8').J).status).toBe('dead');
    expect(ivMetrics(c('01', '4').V, c('01', '4').J).status).toBe('short');
  });
  it('hysteresis index from reverse and forward', () => {
    const r = c('02', '6', 'rev'),
      f = c('02', '6');
    const hi = hysteresisIndex(ivMetrics(r.V, r.J).pce, ivMetrics(f.V, f.J).pce);
    expect(hi).toBeGreaterThan(0);
    near(hi, (r.inst!.pce! - f.inst!.pce!) / r.inst!.pce!, 0.002);
  });
});

describe('per-curve TXT export', () => {
  const { curves } = parseIvFiles(txtFiles());
  const c = (px: string, d: string) => curves.find((x) => x.pixel === px && x.dir === d)!;
  it('reads curves, area from I/J, light and the instrument values from Parameters', () => {
    expect(curves).toHaveLength(4);
    expect(c('A1', 'rev')).toMatchObject({
      sample: 'Control',
      substrate: '1',
      date: '2026-03-14',
      area: A,
      pin: 100,
      system: 'txt',
    });
    const m = ivMetrics(c('A1', 'rev').V, c('A1', 'rev').J);
    near(m.pce, c('A1', 'rev').inst!.pce!, 0.05);
    near(m.jsc, 21.2, 0.01);
    near(m.voc, 0.95, 0.01);
  });
  it('ignores contact glitches instead of reading them as Voc', () => {
    const p = c('A2', 'fwd'),
      m = ivMetrics(p.V, p.J);
    expect(m.spikes).toBeGreaterThan(0);
    near(m.voc, 1.0, 0.01);
    near(m.pce, p.inst!.pce!, 0.05);
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
    const p = [
      { t: 0, v: 1 },
      { t: 100, v: 0.95 },
      { t: 200, v: 0.85 },
      { t: 300, v: 0.75 },
    ];
    expect(tFraction(p, 0.9)).toBeCloseTo(150);
    expect(tFraction(p, 0.8)).toBeCloseTo(250);
    expect(tFraction(p, 0.5)).toBeNull();
    expect(
      tFraction(
        [
          { t: 0, v: 1 },
          { t: 10, v: 1.05 },
          { t: 20, v: 0.7 },
        ],
        0.8,
      ),
    ).toBeCloseTo(10 + (0.25 / 0.35) * 10);
  });
});

describe('check sweeps', () => {
  const { curves } = parseIvFiles(csvFiles());
  it('reads the voltage step of a sweep', () => {
    near(sweepStep(curves.find((c) => c.scan === '01')!.V), 0.05, 0.001);
    near(sweepStep(curves.find((c) => c.scan === '02')!.V), 0.02, 0.001);
  });
  it('marks the quick 0.05 V forward-only scan before the 0.02 V measurement with hysteresis', () => {
    const k = checkSweeps(curves);
    expect([...k].filter((x) => x.endsWith('|01'))).toHaveLength(8);
    expect([...k].some((x) => x.endsWith('|02'))).toBe(false);
  });
  it('never marks a scan that is alone, or two equal repeats', () => {
    expect(checkSweeps(curves.filter((c) => c.scan === '01')).size).toBe(0);
    const twin = curves.filter((c) => c.scan === '02').map((c) => ({ ...c, scan: '03' }));
    expect(checkSweeps([...curves.filter((c) => c.scan === '02'), ...twin]).size).toBe(0);
  });
  it('a finer scan with one direction does not make a coarser one with both a check sweep, nor the other way round', () => {
    const fwd = (scan: string, step: number, dir: Dir = 'fwd') => ({
      sample: 's',
      substrate: '1',
      pixel: '1',
      scan,
      dir,
      V: Array.from({ length: 20 }, (_, i) => i * step),
    });
    // 0.02 fwd only vs 0.05 with both: the 0.05 one is coarser, so it is the check sweep (clearly finer wins)
    expect([...checkSweeps([fwd('1', 0.02), fwd('2', 0.05), fwd('2', 0.05, 'rev')])]).toEqual(['s|1|1|2']);
  });
});

describe('shorted pixels', () => {
  const c = (pixel: string, status: 'ok' | 'short' | 'dead', kind: string | null = null) => ({
    sample: 's',
    substrate: '1',
    pixel,
    kind,
    status,
  });
  it('a pixel that shorts in one direction and works in the other is shorted', () => {
    expect([...shortedPixels([c('1', 'ok'), c('1', 'short'), c('2', 'ok'), c('2', 'ok')])]).toEqual(['s|1|1']);
  });
  it('check sweeps and later lifetime readings do not short a pixel', () => {
    expect(shortedPixels([c('1', 'ok'), c('1', 'short', 'check'), c('2', 'ok'), c('2', 'short', 'life')]).size).toBe(0);
  });
  it('a dead scan is not a short', () => {
    expect(shortedPixels([c('1', 'ok'), c('1', 'dead')]).size).toBe(0);
  });
});

describe('scan direction (0.55.3)', () => {
  it('comes from the voltages: falling is backward, rising forward', () => {
    expect(sweepDir([1.2, 1.0, 0.8, 0.6])).toBe('rev');
    expect(sweepDir([-0.1, 0.1, 0.3, 0.5])).toBe('fwd');
    expect(sweepDir([0.1, 0.2])).toBe(null); // too short to tell
    expect(sweepDir([0, 0.1, 0, 0.1, 0])).toBe(null); // as many steps up as down
  });
  it('a forward-first export is read as before', () => {
    const { curves, warnings } = parseIvFiles(csvFiles());
    const scan2 = curves.filter((c) => c.scan === '02');
    expect(scan2.filter((c) => c.dir === 'rev').every((c) => c.V[0] > c.V[c.V.length - 1])).toBe(true);
    expect(scan2.filter((c) => c.dir === 'fwd').every((c) => c.V[0] < c.V[c.V.length - 1])).toBe(true);
    expect(warnings.some((w) => /measured first|named against/.test(w))).toBe(false);
  });
  it('a backward-first export: "Pixel n" is backward, "Pixel n Reverse" forward, and the import says so once', () => {
    const { curves, warnings } = parseIvFiles(csvBackwardFirst());
    expect(curves).toHaveLength(6);
    for (const c of curves) expect(c.dir).toBe(c.V[0] > c.V[c.V.length - 1] ? 'rev' : 'fwd');
    // the instrument's own values stay with the sweep they were written for: the forward one is the lower
    const p1 = curves.filter((c) => c.pixel === '1');
    expect(p1.find((c) => c.dir === 'fwd')!.inst!.pce!).toBeLessThan(p1.find((c) => c.dir === 'rev')!.inst!.pce!);
    expect(warnings.filter((w) => /backward sweep was measured first/.test(w))).toHaveLength(1);
    // hysteresis is now the right way round: backward above forward
    const m = (d: Dir) => ivMetrics(p1.find((c) => c.dir === d)!.V, p1.find((c) => c.dir === d)!.J, 100).pce;
    expect(hysteresisIndex(m('rev'), m('fwd'))).toBeGreaterThan(0);
  });
});
