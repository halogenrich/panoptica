/**
 * J–V measurements: reading the lab's instrument exports, and the photovoltaic figures of merit.
 *
 * Conventions after import: V in volts, J in mA/cm², photocurrent POSITIVE (power quadrant V > 0, J > 0),
 * light intensity in mW/cm². Every system's export is converted to this on reading.
 *
 * Supported exports
 *  - "padrao" (8-pixel system, e.g. 1.2 × 1.2 substrates): per measurement `<id> J-V Data.csv`
 *    (pairs of columns "Pixel n" / "Pixel n Reverse", V (V) and J (A/cm^2)), optional `<id> Metrics.csv`,
 *    `<id> J-V Settings.csv` (often in a Settings folder: pixel area, illumination, sweep) and
 *    `<id> Light Temperature Data.csv` (ignored). id = `dd_mm_yy-<sample>_<substrate>_<scan>[r]`.
 *  - "sun" (1.5 × 2.5 system): one file per curve `<dd-Mon-yyyy> -<id>-JV-<Backward|Forward>-Sun-<pixel>.txt`
 *    with columns V, J (mA/cm²), I (mA); and `<date>-<id>-Parameters.txt` with the instrument's values.
 */

export type IvSystem = 'padrao' | 'sun';
export type Dir = 'fwd' | 'rev';
export type PixelStatus = 'ok' | 'dead' | 'short';

export interface IvCurve {
  file: string;
  system: IvSystem;
  date: string;        // yyyy-mm-dd when it can be read from the name, else ''
  sample: string;      // condition / sample name from the file name, e.g. "TripleC_Padrao", "pvk_TC"
  substrate: string;   // substrate number within the sample
  scan: string;        // repeat or measurement number ("01", "02", "01r", "1", "")
  pixel: string;       // "1".."8", "A1"…
  dir: Dir;
  area: number;        // cm² as reported by the system (0 when unknown)
  pin: number;         // mW/cm²
  V: number[];
  J: number[];
  /** Values the instrument software reported, for comparison (may be wrong: e.g. FF > 100 % on dead pixels). */
  inst?: { pce?: number; ff?: number; jsc?: number; voc?: number };
  settings?: Record<string, string>;
}

export interface IvMetrics {
  jsc: number; voc: number; ff: number; pce: number; // mA/cm², V, %, %
  vmp: number; jmp: number; pmax: number;            // V, mA/cm², mW/cm²
  rs: number; rsh: number;                           // Ω·cm² (slopes at Voc and at 0 V)
  status: PixelStatus;
  spikes: number;                                    // glitch points left out of the calculation
}

export interface IvFile { name: string; text: string }

// ------------------------------------------------------------------ helpers
const num = (s: string | undefined) => { const t = (s ?? '').trim(); if (!t || /j\)?$/.test(t)) return NaN; const n = Number(t); return Number.isFinite(n) ? n : NaN; };
const base = (p: string) => p.split(/[\\/]/).pop() ?? p;
const csvRows = (text: string) => text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim()).map((l) => {
  const out: string[] = []; let cur = '', q = false;
  for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; }
  out.push(cur); return out;
});
const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
/** dd_mm_yy, yymmdd prefix or dd-Mon-yyyy → yyyy-mm-dd */
export function ivDate(s: string): string {
  let m = /^(\d{2})_(\d{2})_(\d{2})$/.exec(s); if (m) return `20${m[3]}-${m[2]}-${m[1]}`;
  m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(s); if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, '0')}`;
  m = /^(\d{2})(\d{2})(\d{2})$/.exec(s); if (m && +m[2] >= 1 && +m[2] <= 12) return `20${m[1]}-${m[2]}-${m[3]}`;
  return '';
}
/** "<sample>_<substrate>[_<scan>][r]" → parts. The sample keeps underscores ("TripleC_fulerenol_com_aneal"). */
export function splitId(id: string): { sample: string; substrate: string; scan: string } {
  const m = /^(.+?)_(\d+)(?:_(\d+[a-z]*))?([a-z]*)$/i.exec(id);
  if (!m) return { sample: id, substrate: '', scan: '' };
  return { sample: m[1], substrate: m[2], scan: (m[3] ?? '') + (m[4] ?? '') };
}

/** Flip a set of curves so the photocurrent is positive, judged on the strongest curve (dead pixels are noise). */
function orient(curves: { V: number[]; J: number[] }[]) {
  let best = 0;
  for (const c of curves) { const j0 = interp(c.V, c.J, 0); if (Number.isFinite(j0) && Math.abs(j0) > Math.abs(best)) best = j0; }
  if (best < 0) for (const c of curves) c.J = c.J.map((j) => -j);
}

/** Linear interpolation of y at x (x need not be sorted); extrapolates from the two nearest points. */
export function interp(x: number[], y: number[], at: number): number {
  const p = x.map((v, i) => [v, y[i]] as const).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b)).sort((a, b) => a[0] - b[0]);
  if (p.length < 2) return NaN;
  let i = p.findIndex(([v]) => v >= at);
  if (i <= 0) i = i === 0 ? 1 : p.length - 1;
  const [x0, y0] = p[i - 1], [x1, y1] = p[i];
  return x1 === x0 ? y0 : y0 + ((at - x0) * (y1 - y0)) / (x1 - x0);
}

// ------------------------------------------------------------------ figures of merit
/** Linear least squares slope dy/dx. */
const slope = (pts: [number, number][]) => {
  const n = pts.length; if (n < 2) return NaN;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
  const sxx = pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0), sxy = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0);
  return sxx ? sxy / sxx : NaN;
};

export const DEAD_JSC = 1;   // mA/cm²: below this the pixel did not work (no contact, no device)
export const SHORT_VOC = 0.3; // V: a working photocurrent but (almost) no voltage = shunted / shorted pixel

export const SPIKE = 2; // mA/cm²: minimum jump for a point to count as a contact glitch

/**
 * Drops contact glitches: runs of one or two points that sit far off the straight line between their two neighbours
 * (further than SPIKE and further than the neighbours differ from each other). Steep but smooth stretches stay, end points are never dropped.
 */
export function despike(p: [number, number][]): { kept: [number, number][]; spikes: number } {
  const drop = new Set<number>();
  for (let i = 1; i < p.length - 1; i++) for (const k of [1, 2]) {
    if (i + k >= p.length) continue;
    const [vl, jl] = p[i - 1], [vr, jr] = p[i + k], lim = Math.max(SPIKE, Math.abs(jr - jl));
    const dev = Array.from({ length: k }, (_, n) => { const [v, j] = p[i + n]; return j - (jl + ((jr - jl) * (v - vl)) / (vr - vl || 1)); });
    if (dev.every((d) => Math.abs(d) > lim) && dev.every((d) => Math.sign(d) === Math.sign(dev[0]))) { for (let n = 0; n < k; n++) drop.add(i + n); break; }
  }
  return { kept: p.filter((_, i) => !drop.has(i)), spikes: drop.size };
}

export function ivMetrics(V: number[], J: number[], pin = 100): IvMetrics {
  const all = V.map((v, i) => [v, J[i]] as [number, number]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b)).sort((a, b) => a[0] - b[0]);
  const { kept: p, spikes } = despike(all);
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  const jsc = interp(xs, ys, 0);
  // Voc: first sign change from + to − at V > 0
  let voc = NaN;
  for (let i = 0; i < p.length - 1; i++) {
    const [v0, j0] = p[i], [v1, j1] = p[i + 1];
    if (v1 > 0 && j0 > 0 && j1 <= 0) { voc = v0 + (j0 * (v1 - v0)) / (j0 - j1); break; }
  }
  // maximum power on a fine grid between 0 and Voc (coarse 50 mV sweeps otherwise underestimate it)
  let pmax = 0, vmp = NaN, jmp = NaN;
  const vEnd = Number.isFinite(voc) ? voc : Math.max(0, ...xs);
  for (let k = 0; k <= 600; k++) {
    const v = (vEnd * k) / 600, j = interp(xs, ys, v), pw = v * j;
    if (pw > pmax) { pmax = pw; vmp = v; jmp = j; }
  }
  const ff = Number.isFinite(voc) && jsc > 0 ? (100 * pmax) / (voc * jsc) : NaN;
  const pce = (100 * pmax) / (pin || 100);
  const step = p.length > 1 ? (xs[xs.length - 1] - xs[0]) / (p.length - 1) : 0.01;
  const near = (c: number, w: number) => p.filter(([v]) => Math.abs(v - c) <= w);
  const sV = Number.isFinite(voc) ? slope(near(voc, Math.max(0.03, 1.5 * step)).map(([v, j]) => [j / 1000, v])) : NaN; // dV/dJ, J in A/cm²
  const s0 = slope(near(0, Math.max(0.1, 2.5 * step)).map(([v, j]) => [v, j / 1000]));                                  // dJ/dV at 0 V
  const rs = Number.isFinite(sV) ? Math.abs(sV) : NaN;
  const rsh = Number.isFinite(s0) ? (s0 < 0 ? -1 / s0 : Infinity) : NaN;
  const status: PixelStatus = !(Math.abs(jsc) >= DEAD_JSC) ? 'dead' : !(voc >= SHORT_VOC) ? 'short' : 'ok';
  return { jsc, voc, ff, pce: status === 'dead' ? 0 : pce, vmp, jmp, pmax, rs, rsh, status, spikes };
}

/** Hysteresis index from reverse and forward PCE: (rev − fwd) / rev. */
export const hysteresisIndex = (rev: number, fwd: number) => (rev > 0 ? (rev - fwd) / rev : NaN);

export interface BoxStats { n: number; min: number; q1: number; median: number; q3: number; max: number; lo: number; hi: number; mean: number; sd: number; outliers: number[] }
/** Tukey box: quartiles by linear interpolation, whiskers to the last point within 1.5 IQR. */
export function boxStats(values: number[]): BoxStats | null {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b), n = v.length;
  if (!n) return null;
  const q = (p: number) => { const i = (n - 1) * p, lo = Math.floor(i); return v[lo] + (v[Math.min(n - 1, lo + 1)] - v[lo]) * (i - lo); };
  const q1 = q(0.25), q3 = q(0.75), iqr = q3 - q1, mean = v.reduce((s, x) => s + x, 0) / n;
  const inside = v.filter((x) => x >= q1 - 1.5 * iqr && x <= q3 + 1.5 * iqr);
  return { n, min: v[0], q1, median: q(0.5), q3, max: v[n - 1], lo: inside[0], hi: inside[inside.length - 1], mean,
    sd: n > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : 0, outliers: v.filter((x) => x < q1 - 1.5 * iqr || x > q3 + 1.5 * iqr) };
}

// ------------------------------------------------------------------ readers
const PADRAO = / (J-V Data|Metrics|J-V Settings|Light Temperature Data)\.csv$/i;
const DATE_PREFIX = String.raw`(\d{1,2}-[A-Za-z]{3}-\d{4}|\d{2}_\d{2}_\d{2})`;
const SUN = new RegExp(String.raw`^(?:${DATE_PREFIX}\s*-\s*)?(.+)-JV-(Backward|Forward)-(Sun|Dark)-([A-Za-z]*\d+)\.txt$`, 'i');
const SUN_PARAMS = new RegExp(String.raw`^(?:${DATE_PREFIX}\s*-\s*)?(.+)-Parameters\.txt$`, 'i');

function readPadrao(files: IvFile[], warn: string[]): IvCurve[] {
  const by = new Map<string, Partial<Record<string, string>>>();
  for (const f of files) {
    const b = base(f.name), m = PADRAO.exec(b); if (!m) continue;
    const id = b.slice(0, m.index), e = by.get(id) ?? {}; e[m[1].toLowerCase()] = f.text; by.set(id, e);
    if (m[1].toLowerCase() === 'j-v data') e.dataFile = f.name;
  }
  const out: IvCurve[] = [];
  for (const [id, e] of by) {
    if (!e['j-v data']) continue; // settings of a measurement whose data was not included
    const settings = Object.fromEntries(csvRows(e['j-v settings'] ?? '').map((r) => [r[0], r.slice(1).join(',')]));
    const dash = id.indexOf('-'), date = dash > 0 ? ivDate(id.slice(0, dash)) : '', rest = date ? id.slice(dash + 1) : id;
    const { sample, substrate, scan } = splitId(rest);
    const rows = csvRows(e['j-v data']!), head = rows[0] ?? [], units = rows[1] ?? [];
    const area = num(settings['Pixel Area (cm^2)']), pin = num(settings['Illumination (mW/cm^-2)']) || num(settings['Illumination (mW/cm^2)']) || 100;
    const inst = new Map<string, IvCurve['inst']>();
    for (const r of csvRows(e.metrics ?? '').slice(1)) inst.set(r[0].trim(), { pce: num(r[1]), ff: num(r[2]), jsc: Math.abs(num(r[3]) * 1000), voc: num(r[4]) });
    const group: IvCurve[] = [];
    for (let c = 0; c + 1 < head.length; c += 2) {
      const label = head[c].trim(); if (!label) continue;
      const pm = /Pixel\s*(\w+)(\s+Reverse)?/i.exec(label); if (!pm) continue;
      const scale = /mA/.test(units[c + 1] ?? '') ? 1 : 1000; // A/cm² → mA/cm²
      const V: number[] = [], J: number[] = [];
      for (const r of rows.slice(2)) { const v = num(r[c]), j = num(r[c + 1]); if (Number.isFinite(v) && Number.isFinite(j)) { V.push(v); J.push(j * scale); } }
      if (V.length < 3) continue;
      group.push({ file: e.dataFile ?? id, system: 'padrao', date, sample, substrate, scan, pixel: pm[1], dir: pm[2] ? 'rev' : 'fwd', area: area || 0, pin, V, J, inst: inst.get(label), settings });
    }
    if (!group.length) warn.push(`${id}: no curves found in the J-V Data file`);
    orient(group); out.push(...group);
  }
  return out;
}

function readSun(files: IvFile[], warn: string[]): IvCurve[] {
  const params = new Map<string, { pin: number; inst: IvCurve['inst'] }>();
  for (const f of files) {
    if (!SUN_PARAMS.test(base(f.name))) continue;
    for (const block of f.text.split(/\r?\n\s*\r?\n/)) {
      const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean); if (!lines.length) continue;
      const val = (k: string) => { const l = lines.find((x) => x.toLowerCase().startsWith(k.toLowerCase())); return l ? num(l.split('=')[1]?.trim().split(/\s+/)[0]) : NaN; };
      const light = val('Power light');
      params.set(lines[0], { pin: Number.isFinite(light) ? light : 100, inst: { voc: val('Voc'), jsc: val('Jsc'), ff: val('FF'), pce: val('n ') } });
    }
  }
  const out: IvCurve[] = [], bySub = new Map<string, IvCurve[]>();
  for (const f of files) {
    const m = SUN.exec(base(f.name)); if (!m) continue;
    const [, d, id, dirw, , pixel] = m;
    const V: number[] = [], J: number[] = [], A: number[] = [];
    for (const l of f.text.split(/\r?\n/)) {
      const t = l.trim().split(/[\s,;]+/).map(num); if (t.length < 2 || !Number.isFinite(t[0]) || !Number.isFinite(t[1])) continue;
      V.push(t[0]); J.push(t[1]); if (Number.isFinite(t[2]) && Math.abs(t[1]) > 1) A.push(Math.abs(t[2] / t[1])); // I (mA) / J (mA/cm²) = area
    }
    if (V.length < 3) { warn.push(`${base(f.name)}: no data rows`); continue; }
    const s = splitId(id.replace(/^\d{6}_/, '')), date = ivDate((d ?? '').trim()) || ivDate(id.slice(0, 6));
    const dir: Dir = /back/i.test(dirw) ? 'rev' : 'fwd', p = params.get(`${id}-${dirw}-${pixel}`);
    A.sort((a, b) => a - b);
    const c: IvCurve = { file: f.name, system: 'sun', date, ...s, pixel: pixel.toUpperCase(), dir, area: A.length ? +A[Math.floor(A.length / 2)].toFixed(4) : 0, pin: p?.pin ?? 100, V, J, inst: p?.inst };
    out.push(c);
    const k = `${s.sample}|${s.substrate}|${s.scan}`; bySub.set(k, [...(bySub.get(k) ?? []), c]);
  }
  for (const g of bySub.values()) {
    orient(g);
    const known = g.map((c) => c.area).filter((a) => a > 0).sort((a, b) => a - b);
    if (known.length) for (const c of g) if (!c.area) c.area = known[Math.floor(known.length / 2)]; // dead pixels: same mask as their neighbours
  }
  return out;
}

/** Reads every supported export among the given files (other files are ignored). */
export function parseIvFiles(files: IvFile[]): { curves: IvCurve[]; warnings: string[]; ignored: number } {
  const warnings: string[] = [], useful = files.filter((f) => !/(^|[\\/])(__MACOSX|\._)/.test(f.name) && !/^\._/.test(base(f.name)));
  const curves = [...readPadrao(useful, warnings), ...readSun(useful, warnings)];
  const used = useful.filter((f) => PADRAO.test(base(f.name)) || SUN.test(base(f.name)) || SUN_PARAMS.test(base(f.name))).length;
  return { curves, warnings, ignored: files.length - used };
}

/**
 * Time at which a normalised quantity first falls to `f` (0.8 → T80), interpolating linearly between the two readings around
 * the crossing. Points in time order, t in any unit, v normalised to 1 at t = 0. Null when it never falls that far.
 */
export function tFraction(points: { t: number; v: number }[], f: number): number | null {
  const p = points.filter((x) => Number.isFinite(x.t) && Number.isFinite(x.v)).sort((a, b) => a.t - b.t);
  for (let i = 0; i < p.length; i++) {
    if (p[i].v > f) continue;
    if (i === 0) return p[0].t;
    const a = p[i - 1], b = p[i];
    return a.v === b.v ? b.t : a.t + ((a.v - f) / (a.v - b.v)) * (b.t - a.t);
  }
  return null;
}
