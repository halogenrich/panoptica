import { describe, it, expect } from 'vitest';
import type { Dir, IvFile } from './iv';
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
  sweepStep,
} from './iv';

/*
 * Synthetic exports in the two supported formats, made from an ideal-diode model so nothing measured is kept in the repository.
 * A cell: J(V) = Jsc − J0·(exp(V/a) − 1) − V/Rsh in mA/cm² (photocurrent positive); the instruments write it with their own
 * units and signs, which the readers must undo.
 */
const cell = (jsc: number, voc: number, a = 0.035, rsh = 3000) => {
  const j0 = (jsc - voc / rsh) / (Math.exp(voc / a) - 1);
  return (v: number) => jsc - j0 * (Math.exp(v / a) - 1) - v / rsh;
};
/** The figures of merit the instrument writes: from its own sampled points (no interpolation). */
const instOf = (V: number[], J: number[], pin = 100) => {
  let pmax = 0;
  V.forEach((v, i) => {
    if (v > 0 && J[i] > 0 && v * J[i] > pmax) pmax = v * J[i];
  });
  const jsc = J[V.findIndex((v) => Math.abs(v) < 1e-9)];
  let voc = NaN;
  const p = V.map((v, i) => [v, J[i]] as const).sort((x, y) => x[0] - y[0]);
  for (let i = 0; i + 1 < p.length; i++)
    if (p[i][0] >= 0 && p[i][1] > 0 && p[i + 1][1] <= 0) {
      voc = p[i][0] + (p[i][1] * (p[i + 1][0] - p[i][0])) / (p[i][1] - p[i + 1][1]);
      break;
    }
  return { pce: (pmax / pin) * 100, ff: (pmax / (jsc * voc)) * 100, jsc, voc };
};
const sweep = (from: number, to: number, step: number) =>
  Array.from(
    { length: Math.round(Math.abs(to - from) / step) + 1 },
    (_, i) => +(from + Math.sign(to - from) * i * step).toFixed(4),
  );
const noise = (k: number) => Math.sin(k * 12.9898) * 1e-9; // a dead pixel: no current, a little instrument noise

// ------------------------------------------------------------------ multi-pixel CSV export (8 pixels, A/cm², negative photocurrent)
type Px = { label: string; V: number[]; J: number[] }; // J in mA/cm², photocurrent positive
function csvExport(id: string, step: number, pixels: Px[]): IvFile[] {
  const rows = Math.max(...pixels.map((p) => p.V.length));
  const data = [
    pixels.flatMap((p) => [p.label, '']).join(','),
    pixels.flatMap(() => ['V (V)', 'J (A/cm^2)']).join(','),
    ...Array.from({ length: rows }, (_, r) =>
      pixels.flatMap((p): (string | number)[] => (r < p.V.length ? [p.V[r], -p.J[r] / 1000] : ['', ''])).join(','),
    ),
  ].join('\n');
  const metrics = [
    'Pixel,PCE (%),FF (%),Jsc (A.cm^-2),Voc (V)',
    ...pixels.map((p) => {
      const m = instOf(p.V, p.J);
      return [p.label, m.pce, m.ff, -m.jsc / 1000, m.voc].join(',');
    }),
  ].join('\n');
  const settings = [
    'Start Voltage (V),-0.1',
    'End Voltage (V),1.2',
    `Voltage Increment (V),${step}`,
    'Illumination (mW/cm^-2),100.0',
    'Pixel Area (cm^2),0.02',
  ].join('\n');
  return [
    { name: `csv/${id} J-V Data.csv`, text: data },
    { name: `csv/${id} Metrics.csv`, text: metrics },
    { name: `csv/Settings/${id} J-V Settings.csv`, text: settings },
  ];
}
const good = cell(22.4, 1.06),
  fwdLow = cell(22.0, 1.04); // forward scans of the hysteresis pixel: a little lower
function csvFiles(): IvFile[] {
  // scan 01: a quick forward check sweep at 0.05 V; pixels 1 and 8 dead, 4 shorted
  const V1 = sweep(-0.1, 1.2, 0.05);
  const scan1: Px[] = Array.from({ length: 8 }, (_, i) => {
    const n = i + 1,
      J =
        n === 1 || n === 8
          ? V1.map((_, k) => noise(k + n))
          : n === 4
            ? V1.map((v) => 19 - v * 1500) // current but no voltage: a short
            : V1.map(good);
    return { label: `Pixel ${n}`, V: V1, J };
  });
  // scan 02: the measurement at 0.02 V, forward and reverse
  const Vf = sweep(-0.1, 1.2, 0.02),
    Vr = sweep(1.2, -0.1, 0.02);
  const scan2: Px[] = Array.from({ length: 8 }, (_, i) => [
    { label: `Pixel ${i + 1}`, V: Vf, J: Vf.map(i === 5 ? fwdLow : good) },
    { label: `Pixel ${i + 1} Reverse`, V: Vr, J: Vr.map(good) },
  ]).flat();
  return [...csvExport('15_03_26-Control_1_01', 0.05, scan1), ...csvExport('15_03_26-Control_1_02', 0.02, scan2)];
}

// ------------------------------------------------------------------ per-curve TXT export (mA/cm², one file per curve)
const A = 0.16;
function txtFiles(): IvFile[] {
  const id = '260314_Control_1',
    pre = '14-Mar-2026 -',
    curves: { dir: 'Backward' | 'Forward'; px: string; f: (v: number) => number; glitch?: boolean }[] = [
      { dir: 'Backward', px: 'A1', f: cell(21.2, 0.95) },
      { dir: 'Forward', px: 'A1', f: cell(21.0, 0.94) },
      { dir: 'Backward', px: 'A2', f: cell(19.8, 1.0) },
      { dir: 'Forward', px: 'A2', f: cell(19.6, 1.0), glitch: true },
    ];
  const out: IvFile[] = [],
    params: string[] = [];
  for (const c of curves) {
    const V = c.dir === 'Backward' ? sweep(1.2, -0.1, 0.01) : sweep(-0.1, 1.2, 0.01);
    const J = V.map((v) => {
      // contact glitches: one point and a two-point dip that would read as Voc if taken at face value
      if (c.glitch && Math.abs(v - 0.45) < 1e-6) return -1.4;
      if (c.glitch && (Math.abs(v - 0.49) < 1e-6 || Math.abs(v - 0.5) < 1e-6)) return -38;
      return c.f(v);
    });
    // the instrument writes current as negative photocurrent, and I (mA) = −J × area
    out.push({
      name: `txt/${pre}${id}-JV-${c.dir}-Sun-${c.px}.txt`,
      text: V.map((v, k) =>
        [v.toExponential(4), (-J[k]).toExponential(12), (J[k] * A).toExponential(12)].join(' '),
      ).join('\n'),
    });
    const clean = V.map((v) => c.f(v)),
      m = instOf(V, clean);
    params.push(
      [
        `${id}-${c.dir}-${c.px}`,
        `Voc= ${m.voc.toFixed(2)} V `,
        `Jsc= ${m.jsc.toFixed(2)} mA/cm² `,
        `FF= ${m.ff.toFixed(2)} %  `,
        `n = ${m.pce.toFixed(2)} % `,
        'Step = 0.01 V ',
        'Power light = 100.0% Sun ',
      ].join('\n'),
    );
  }
  out.push({ name: `txt/14-Mar-2026-${id}-Parameters.txt`, text: params.join('\n\n') });
  return out;
}

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
