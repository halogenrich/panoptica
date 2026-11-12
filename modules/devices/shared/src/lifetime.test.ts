import { describe, expect, it } from 'vitest';
import { curveDistorted, ivMetrics, parseIvFiles, parseLifetime, type IvFile } from './iv';

// a synthetic two-point lifetime run of pixels 1 and 2 (diode-like curves, J in A/cm², photocurrent negative)
const curve = (jsc: number, voc: number, rev: boolean) => {
  const V = Array.from({ length: 14 }, (_, i) => -0.1 + i * 0.1);
  const pts = V.map((v) => [v, -jsc * (1 - Math.exp((v - voc) / 0.05))] as const);
  return rev ? [...pts].reverse() : pts;
};
const jvFile = (jsc: number) => {
  const cols = ['1', '1 Reverse', '2', '2 Reverse'].map((p) => curve(jsc, 1.02, p.includes('Reverse')));
  const head = ['Pixel 1,,Pixel 1 Reverse,,Pixel 2,,Pixel 2 Reverse,', 'V (V),J (A/cm^2),'.repeat(4).slice(0, -1)];
  const rows = cols[0].map((_, i) => cols.map((c) => `${c[i][0]},${c[i][1]}`).join(','));
  return [...head, ...rows].join('\n');
};
const settings =
  'Pixel Area (cm^2),0.02\nIllumination (mW/cm^-2),100.0\nInterval (mins),0.5\nHold Voltage (V),Maximum Power\n';
const summary = (t0: number) =>
  'Time (s),PCE (%),FF (%),Jsc (A.cm^-2),Voc (V)\n' + `${t0},18,80,-0.024,1\n${t0 + 50},12,70,-0.02,0.95\n`;
const files: IvFile[] = [
  { name: 'run/Settings/aged Lifetime Settings.csv', text: settings },
  { name: 'run/Settings/aged Lifetime Settings (2).csv', text: settings },
  { name: 'run/aged Pixel 1.csv', text: 'Time (s),PCE (%)\n' }, // an aborted first run: header only
  { name: 'run/aged Pixel 1 (2).csv', text: summary(3) },
  { name: 'run/aged Pixel 1 Reverse (2).csv', text: summary(6) },
  {
    name: 'run/aged Light Temperature Data (2).csv',
    text: 'Time (s),Photodiode Current (A),Temperature (C)\n1,-2e-8,-273.07\n',
  },
  { name: 'run/J-V Data/26-11-05_19-44-57 J-V Data.csv', text: jvFile(0.024) },
  { name: 'run/J-V Data/26-11-05_19-45-47 J-V Data.csv', text: jvFile(0.02) },
];

describe('parseLifetime', () => {
  const [r] = parseLifetime(files);
  it('reads one run with its time points', () => {
    expect(r.run).toBe('aged');
    expect(r.date).toBe('2026-11-05');
    expect(r.start).toBe('2026-11-05T19:44:57');
    expect(r.points).toBe(2);
    expect(r.curves).toHaveLength(8);
    expect(r.area).toBe(0.02);
  });
  it('takes times and instrument values from the copy that matches the J–V files', () => {
    const c = r.curves.find((x) => x.pixel === '1' && x.dir === 'fwd' && x.point === 2)!;
    expect(c.t).toBe(53);
    expect(c.scan).toBe('0002');
    expect(c.inst?.pce).toBe(12);
    expect(c.inst?.jsc).toBeCloseTo(20);
  });
  it('turns the photocurrent positive', () => {
    const c = r.curves[0];
    expect(c.J[c.V.indexOf(c.V.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a)))]).toBeGreaterThan(0);
  });
  it('drops light and temperature readings of unconnected sensors', () => {
    expect(r.sensors).toBe(false);
    expect(r.light).toHaveLength(0);
  });
  it('leaves out points the instrument missed (a current of exactly 0)', () => {
    const t = files[6].text.split('\n'),
      cells = t[2].split(',');
    cells[1] = '0.0';
    t[2] = cells.join(',');
    const [z] = parseLifetime(files.map((f, i) => (i === 6 ? { ...f, text: t.join('\n') } : f)));
    const c = z.curves.find((x) => x.pixel === '1' && x.dir === 'fwd' && x.point === 1)!;
    expect(c.V).toHaveLength(13);
    expect(z.warnings.join()).toMatch(/1 J–V point with a current of exactly 0/);
    expect(r.warnings).toHaveLength(0);
  });
  it('keeps the timestamped J–V files away from the normal reader', () => {
    expect(parseIvFiles(files).curves).toHaveLength(0);
  });
  it('flags a forward scan whose current reverses and recovers', () => {
    // pixel 2, forward, second reading of the example run: negative between 0.25 and 0.6 V, positive again up to 0.85 V
    const V = [-0.1, 0, 0.1, 0.2, 0.25, 0.35, 0.45, 0.55, 0.6, 0.66, 0.76, 0.8, 0.85, 0.9, 1.0, 1.15],
      J = [9.4, 7.9, 5.9, 1.9, -1.7, -13.2, -18.8, -12.1, -4.8, 4.9, 7.9, 8.2, 5.2, -1.2, -30.6, -141.7];
    expect(curveDistorted(V, J)).toBe(true);
    expect(ivMetrics(V, J, 100).voc).toBeLessThan(0.3); // read from the first crossing
    const good = [-0.1, 0, 0.3, 0.6, 0.8, 0.9, 1.0, 1.1].map((v) => 24 - 1e-9 * Math.exp(v / 0.045));
    expect(curveDistorted([-0.1, 0, 0.3, 0.6, 0.8, 0.9, 1.0, 1.1], good)).toBe(false);
  });
});
