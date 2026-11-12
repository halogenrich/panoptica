import type { IvFile } from './iv';

/**
 * Synthetic J–V exports for tests (unit tests and the browser tests): never measured data. See the comment below.
 */
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
export function csvFiles(): IvFile[] {
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
export const A = 0.16;
export function txtFiles(): IvFile[] {
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
