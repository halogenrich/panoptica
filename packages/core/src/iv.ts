/**
 * J–V measurements: reading the lab's instrument exports, and the photovoltaic figures of merit.
 *
 * Conventions after import: V in volts, J in mA/cm², photocurrent POSITIVE (power quadrant V > 0, J > 0),
 * light intensity in mW/cm². Every system's export is converted to this on reading.
 *
 * Supported exports
 *  - "csv" (multi-pixel systems that write CSV, such as Ossila's): per measurement `<id> J-V Data.csv`
 *    (pairs of columns "Pixel n" / "Pixel n Reverse", V (V) and J (A/cm^2)), optional `<id> Metrics.csv`,
 *    `<id> J-V Settings.csv` (often in a Settings folder: pixel area, illumination, sweep) and
 *    `<id> Light Temperature Data.csv` (ignored). id = `dd_mm_yy-<sample>_<substrate>_<scan>[r]`.
 *  - "txt" (systems that write one text file per curve): one file per curve `<dd-Mon-yyyy> -<id>-JV-<Backward|Forward>-Sun-<pixel>.txt`
 *    with columns V, J (mA/cm²), I (mA); and `<date>-<id>-Parameters.txt` with the instrument's values.
 */

export type IvSystem = 'csv' | 'txt';
export type Dir = 'fwd' | 'rev';
export type PixelStatus = 'ok' | 'dead' | 'short';

export interface IvCurve {
  file: string;
  system: IvSystem;
  date: string; // yyyy-mm-dd when it can be read from the name, else ''
  sample: string; // condition / sample name from the file name, e.g. "Control", "Additive_x"
  substrate: string; // substrate number within the sample
  scan: string; // repeat or measurement number ("01", "02", "01r", "1", "")
  pixel: string; // "1".."8", "A1"…
  dir: Dir;
  area: number; // cm² as reported by the system (0 when unknown)
  pin: number; // mW/cm²
  V: number[];
  J: number[];
  /** Values the instrument software reported, for comparison (may be wrong: e.g. FF > 100 % on dead pixels). */
  inst?: { pce?: number; ff?: number; jsc?: number; voc?: number };
  settings?: Record<string, string>;
}

export interface IvMetrics {
  jsc: number;
  voc: number;
  ff: number;
  pce: number; // mA/cm², V, %, %
  vmp: number;
  jmp: number;
  pmax: number; // V, mA/cm², mW/cm²
  rs: number;
  rsh: number; // Ω·cm² (slopes at Voc and at 0 V)
  status: PixelStatus;
  spikes: number; // glitch points left out of the calculation
  /** 'pixel': this scan worked, but another scan of the same pixel shorted, so the pixel counts as shorted (`shortedPixels`) */
  shortBy?: 'pixel';
}

export interface IvFile {
  name: string;
  text: string;
}

// ------------------------------------------------------------------ helpers
const num = (s: string | undefined) => {
  const t = (s ?? '').trim();
  if (!t || /j\)?$/.test(t)) return NaN;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
const base = (p: string) => p.split(/[\\/]/).pop() ?? p;
const csvRows = (text: string) =>
  text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => {
      const out: string[] = [];
      let cur = '',
        q = false;
      for (const ch of l) {
        if (ch === '"') q = !q;
        else if (ch === ',' && !q) {
          out.push(cur);
          cur = '';
        } else cur += ch;
      }
      out.push(cur);
      return out;
    });
const MONTHS: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};
/** dd_mm_yy, yymmdd prefix or dd-Mon-yyyy → yyyy-mm-dd */
export function ivDate(s: string): string {
  let m = /^(\d{2})_(\d{2})_(\d{2})$/.exec(s);
  if (m) return `20${m[3]}-${m[2]}-${m[1]}`;
  m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, '0')}`;
  m = /^(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `20${m[1]}-${m[2]}-${m[3]}`;
  return '';
}
/** "<sample>_<substrate>[_<scan>][r]" → parts. The sample keeps underscores ("Additive_x_annealed"). */
export function splitId(id: string): { sample: string; substrate: string; scan: string } {
  const m = /^(.+?)_(\d+)(?:_(\d+[a-z]*))?([a-z]*)$/i.exec(id);
  if (!m) return { sample: id, substrate: '', scan: '' };
  return { sample: m[1], substrate: m[2], scan: (m[3] ?? '') + (m[4] ?? '') };
}

/** Flip a set of curves so the photocurrent is positive, judged on the strongest curve (dead pixels are noise). */
function orient(curves: { V: number[]; J: number[] }[]) {
  let best = 0;
  for (const c of curves) {
    const j0 = interp(c.V, c.J, 0);
    if (Number.isFinite(j0) && Math.abs(j0) > Math.abs(best)) best = j0;
  }
  if (best < 0) for (const c of curves) c.J = c.J.map((j) => -j);
}

/** Linear interpolation of y at x (x need not be sorted); extrapolates from the two nearest points. */
export function interp(x: number[], y: number[], at: number): number {
  const p = x
    .map((v, i) => [v, y[i]] as const)
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b))
    .sort((a, b) => a[0] - b[0]);
  if (p.length < 2) return NaN;
  let i = p.findIndex(([v]) => v >= at);
  if (i <= 0) i = i === 0 ? 1 : p.length - 1;
  const [x0, y0] = p[i - 1],
    [x1, y1] = p[i];
  return x1 === x0 ? y0 : y0 + ((at - x0) * (y1 - y0)) / (x1 - x0);
}

// ------------------------------------------------------------------ figures of merit
/** Linear least squares slope dy/dx. */
const slope = (pts: [number, number][]) => {
  const n = pts.length;
  if (n < 2) return NaN;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n,
    my = pts.reduce((s, p) => s + p[1], 0) / n;
  const sxx = pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0),
    sxy = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0);
  return sxx ? sxy / sxx : NaN;
};

export const DEAD_JSC = 1; // mA/cm²: below this the pixel did not work (no contact, no device)
export const SHORT_VOC = 0.3; // V: a working photocurrent but (almost) no voltage = shunted / shorted pixel

export const SPIKE = 2; // mA/cm²: minimum jump for a point to count as a contact glitch

/**
 * Drops contact glitches: runs of one or two points that sit far off the straight line between their two neighbours
 * (further than SPIKE and further than the neighbours differ from each other). Steep but smooth stretches stay, end points are never dropped.
 */
export function despike(p: [number, number][]): { kept: [number, number][]; spikes: number } {
  const drop = new Set<number>();
  for (let i = 1; i < p.length - 1; i++)
    for (const k of [1, 2]) {
      if (i + k >= p.length) continue;
      const [vl, jl] = p[i - 1],
        [vr, jr] = p[i + k],
        lim = Math.max(SPIKE, Math.abs(jr - jl));
      const dev = Array.from({ length: k }, (_, n) => {
        const [v, j] = p[i + n];
        return j - (jl + ((jr - jl) * (v - vl)) / (vr - vl || 1));
      });
      if (dev.every((d) => Math.abs(d) > lim) && dev.every((d) => Math.sign(d) === Math.sign(dev[0]))) {
        for (let n = 0; n < k; n++) drop.add(i + n);
        break;
      }
    }
  return { kept: p.filter((_, i) => !drop.has(i)), spikes: drop.size };
}

export function ivMetrics(V: number[], J: number[], pin = 100): IvMetrics {
  const all = V.map((v, i) => [v, J[i]] as [number, number])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b))
    .sort((a, b) => a[0] - b[0]);
  const { kept: p, spikes } = despike(all);
  const xs = p.map((q) => q[0]),
    ys = p.map((q) => q[1]);
  const jsc = interp(xs, ys, 0);
  // Voc: first sign change from + to − at V > 0
  let voc = NaN;
  for (let i = 0; i < p.length - 1; i++) {
    const [v0, j0] = p[i],
      [v1, j1] = p[i + 1];
    if (v1 > 0 && j0 > 0 && j1 <= 0) {
      voc = v0 + (j0 * (v1 - v0)) / (j0 - j1);
      break;
    }
  }
  // maximum power on a fine grid between 0 and Voc (coarse 50 mV sweeps otherwise underestimate it)
  let pmax = 0,
    vmp = NaN,
    jmp = NaN;
  const vEnd = Number.isFinite(voc) ? voc : Math.max(0, ...xs);
  for (let k = 0; k <= 600; k++) {
    const v = (vEnd * k) / 600,
      j = interp(xs, ys, v),
      pw = v * j;
    if (pw > pmax) {
      pmax = pw;
      vmp = v;
      jmp = j;
    }
  }
  const ff = Number.isFinite(voc) && jsc > 0 ? (100 * pmax) / (voc * jsc) : NaN;
  const pce = (100 * pmax) / (pin || 100);
  const step = p.length > 1 ? (xs[xs.length - 1] - xs[0]) / (p.length - 1) : 0.01;
  const near = (c: number, w: number) => p.filter(([v]) => Math.abs(v - c) <= w);
  const sV = Number.isFinite(voc) ? slope(near(voc, Math.max(0.03, 1.5 * step)).map(([v, j]) => [j / 1000, v])) : NaN; // dV/dJ, J in A/cm²
  const s0 = slope(near(0, Math.max(0.1, 2.5 * step)).map(([v, j]) => [v, j / 1000])); // dJ/dV at 0 V
  const rs = Number.isFinite(sV) ? Math.abs(sV) : NaN;
  const rsh = Number.isFinite(s0) ? (s0 < 0 ? -1 / s0 : Infinity) : NaN;
  const status: PixelStatus = !(Math.abs(jsc) >= DEAD_JSC) ? 'dead' : !(voc >= SHORT_VOC) ? 'short' : 'ok';
  return { jsc, voc, ff, pce: status === 'dead' ? 0 : pce, vmp, jmp, pmax, rs, rsh, status, spikes };
}

/** Hysteresis index from reverse and forward PCE: (rev − fwd) / rev. */
export const hysteresisIndex = (rev: number, fwd: number) => (rev > 0 ? (rev - fwd) / rev : NaN);

export interface BoxStats {
  n: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  lo: number;
  hi: number;
  mean: number;
  sd: number;
  outliers: number[];
}
/** Tukey box: quartiles by linear interpolation, whiskers to the last point within 1.5 IQR. */
export function boxStats(values: number[]): BoxStats | null {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b),
    n = v.length;
  if (!n) return null;
  const q = (p: number) => {
    const i = (n - 1) * p,
      lo = Math.floor(i);
    return v[lo] + (v[Math.min(n - 1, lo + 1)] - v[lo]) * (i - lo);
  };
  const q1 = q(0.25),
    q3 = q(0.75),
    iqr = q3 - q1,
    mean = v.reduce((s, x) => s + x, 0) / n;
  const inside = v.filter((x) => x >= q1 - 1.5 * iqr && x <= q3 + 1.5 * iqr);
  return {
    n,
    min: v[0],
    q1,
    median: q(0.5),
    q3,
    max: v[n - 1],
    lo: inside[0],
    hi: inside[inside.length - 1],
    mean,
    sd: n > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : 0,
    outliers: v.filter((x) => x < q1 - 1.5 * iqr || x > q3 + 1.5 * iqr),
  };
}

// ------------------------------------------------------------------ check sweeps
/** Voltage step of a sweep: the median |ΔV| between points (V). */
export function sweepStep(V: number[]): number {
  const d = V.slice(1)
    .map((v, i) => Math.abs(v - V[i]))
    .filter((x) => x > 0)
    .sort((a, b) => a - b);
  return d.length ? d[d.length >> 1] : NaN;
}

type SweepKey = { sample: string; substrate: string; pixel: string; scan: string; dir: Dir; V: number[] };
/**
 * Check (exploratory) sweeps: quick scans run before the real measurement, e.g. 0.05 V steps forward only,
 * then the measurement at 0.02 V with both directions. Per pixel, a scan is a check sweep when another scan of the same pixel
 * is at least as fine and either clearly finer (step under 0.8×) or has both directions where this one has one. A scan that is
 * alone, or not beaten by another, is never a check sweep. Returns the keys `sample|substrate|pixel|scan` of the check sweeps.
 */
export function checkSweeps(curves: SweepKey[]): Set<string> {
  const scans = new Map<string, Map<string, { step: number; dirs: Set<Dir> }>>();
  for (const c of curves) {
    const px = `${c.sample}|${c.substrate}|${c.pixel}`;
    const m = scans.get(px) ?? new Map();
    scans.set(px, m);
    const s = m.get(c.scan) ?? { step: NaN, dirs: new Set<Dir>() };
    const st = sweepStep(c.V);
    s.step = Number.isFinite(s.step) ? Math.min(s.step, st) : st;
    s.dirs.add(c.dir);
    m.set(c.scan, s);
  }
  const out = new Set<string>();
  for (const [px, m] of scans) {
    if (m.size < 2) continue;
    for (const [scan, a] of m)
      for (const [other, b] of m) {
        if (other === scan || !Number.isFinite(a.step) || !Number.isFinite(b.step)) continue;
        const asFine = b.step <= a.step * 1.02,
          finer = b.step < a.step * 0.8,
          bothDirs = b.dirs.size > 1 && a.dirs.size < 2;
        if (asFine && (finer || bothDirs)) {
          out.add(`${px}|${scan}`);
          break;
        }
      }
  }
  return out;
}

/**
 * A pixel that shorts in one regular scan (backward, say) and works in another (forward) is a shorted pixel: every regular scan
 * of it then counts as short. Check sweeps and later readings of a lifetime run (`kind` set) are not looked at and not changed.
 * Returns the keys `sample|substrate|pixel` of the shorted pixels.
 */
export function shortedPixels(
  curves: { sample: string; substrate: string; pixel: string; kind?: string | null; status: PixelStatus }[],
): Set<string> {
  const out = new Set<string>();
  for (const c of curves) if (!c.kind && c.status === 'short') out.add(`${c.sample}|${c.substrate}|${c.pixel}`);
  return out;
}

// ------------------------------------------------------------------ readers
const CSV_EXPORT = / (J-V Data|Metrics|J-V Settings|Light Temperature Data)\.csv$/i;
const DATE_PREFIX = String.raw`(\d{1,2}-[A-Za-z]{3}-\d{4}|\d{2}_\d{2}_\d{2})`;
const TXT_CURVE = new RegExp(
  String.raw`^(?:${DATE_PREFIX}\s*-\s*)?(.+)-JV-(Backward|Forward)-(Sun|Dark)-([A-Za-z]*\d+)\.txt$`,
  'i',
);
const TXT_PARAMS = new RegExp(String.raw`^(?:${DATE_PREFIX}\s*-\s*)?(.+)-Parameters\.txt$`, 'i');

function readCsvExport(files: IvFile[], warn: string[]): IvCurve[] {
  const by = new Map<string, Partial<Record<string, string>>>();
  for (const f of files) {
    const b = base(f.name),
      m = CSV_EXPORT.exec(b);
    if (!m) continue;
    const id = b.slice(0, m.index),
      e = by.get(id) ?? {};
    e[m[1].toLowerCase()] = f.text;
    by.set(id, e);
    if (m[1].toLowerCase() === 'j-v data') e.dataFile = f.name;
  }
  const out: IvCurve[] = [];
  for (const [id, e] of by) {
    if (!e['j-v data']) continue; // settings of a measurement whose data was not included
    const settings = Object.fromEntries(csvRows(e['j-v settings'] ?? '').map((r) => [r[0], r.slice(1).join(',')]));
    const dash = id.indexOf('-'),
      date = dash > 0 ? ivDate(id.slice(0, dash)) : '',
      rest = date ? id.slice(dash + 1) : id;
    const { sample, substrate, scan } = splitId(rest);
    const rows = csvRows(e['j-v data']!),
      head = rows[0] ?? [],
      units = rows[1] ?? [];
    const area = num(settings['Pixel Area (cm^2)']),
      pin = num(settings['Illumination (mW/cm^-2)']) || num(settings['Illumination (mW/cm^2)']) || 100;
    const inst = new Map<string, IvCurve['inst']>();
    for (const r of csvRows(e.metrics ?? '').slice(1))
      inst.set(r[0].trim(), { pce: num(r[1]), ff: num(r[2]), jsc: Math.abs(num(r[3]) * 1000), voc: num(r[4]) });
    const group: IvCurve[] = [];
    for (let c = 0; c + 1 < head.length; c += 2) {
      const label = head[c].trim();
      if (!label) continue;
      const pm = /Pixel\s*(\w+)(\s+Reverse)?/i.exec(label);
      if (!pm) continue;
      const scale = /mA/.test(units[c + 1] ?? '') ? 1 : 1000; // A/cm² → mA/cm²
      const V: number[] = [],
        J: number[] = [];
      for (const r of rows.slice(2)) {
        const v = num(r[c]),
          j = num(r[c + 1]);
        if (Number.isFinite(v) && Number.isFinite(j)) {
          V.push(v);
          J.push(j * scale);
        }
      }
      if (V.length < 3) continue;
      group.push({
        file: e.dataFile ?? id,
        system: 'csv',
        date,
        sample,
        substrate,
        scan,
        pixel: pm[1],
        dir: pm[2] ? 'rev' : 'fwd',
        area: area || 0,
        pin,
        V,
        J,
        inst: inst.get(label),
        settings,
      });
    }
    if (!group.length) warn.push(`${id}: no curves found in the J-V Data file`);
    orient(group);
    out.push(...group);
  }
  return out;
}

function readTxtExport(files: IvFile[], warn: string[]): IvCurve[] {
  const params = new Map<string, { pin: number; inst: IvCurve['inst'] }>();
  for (const f of files) {
    if (!TXT_PARAMS.test(base(f.name))) continue;
    for (const block of f.text.split(/\r?\n\s*\r?\n/)) {
      const lines = block
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (!lines.length) continue;
      const val = (k: string) => {
        const l = lines.find((x) => x.toLowerCase().startsWith(k.toLowerCase()));
        return l ? num(l.split('=')[1]?.trim().split(/\s+/)[0]) : NaN;
      };
      const light = val('Power light');
      params.set(lines[0], {
        pin: Number.isFinite(light) ? light : 100,
        inst: { voc: val('Voc'), jsc: val('Jsc'), ff: val('FF'), pce: val('n ') },
      });
    }
  }
  const out: IvCurve[] = [],
    bySub = new Map<string, IvCurve[]>();
  for (const f of files) {
    const m = TXT_CURVE.exec(base(f.name));
    if (!m) continue;
    const [, d, id, dirw, , pixel] = m;
    const V: number[] = [],
      J: number[] = [],
      A: number[] = [];
    for (const l of f.text.split(/\r?\n/)) {
      const t = l
        .trim()
        .split(/[\s,;]+/)
        .map(num);
      if (t.length < 2 || !Number.isFinite(t[0]) || !Number.isFinite(t[1])) continue;
      V.push(t[0]);
      J.push(t[1]);
      if (Number.isFinite(t[2]) && Math.abs(t[1]) > 1) A.push(Math.abs(t[2] / t[1])); // I (mA) / J (mA/cm²) = area
    }
    if (V.length < 3) {
      warn.push(`${base(f.name)}: no data rows`);
      continue;
    }
    const s = splitId(id.replace(/^\d{6}_/, '')),
      date = ivDate((d ?? '').trim()) || ivDate(id.slice(0, 6));
    const dir: Dir = /back/i.test(dirw) ? 'rev' : 'fwd',
      p = params.get(`${id}-${dirw}-${pixel}`);
    A.sort((a, b) => a - b);
    const c: IvCurve = {
      file: f.name,
      system: 'txt',
      date,
      ...s,
      pixel: pixel.toUpperCase(),
      dir,
      area: A.length ? +A[Math.floor(A.length / 2)].toFixed(4) : 0,
      pin: p?.pin ?? 100,
      V,
      J,
      inst: p?.inst,
    };
    out.push(c);
    const k = `${s.sample}|${s.substrate}|${s.scan}`;
    bySub.set(k, [...(bySub.get(k) ?? []), c]);
  }
  for (const g of bySub.values()) {
    orient(g);
    const known = g
      .map((c) => c.area)
      .filter((a) => a > 0)
      .sort((a, b) => a - b);
    if (known.length) for (const c of g) if (!c.area) c.area = known[Math.floor(known.length / 2)]; // dead pixels: same mask as their neighbours
  }
  return out;
}

/** Reads every supported export among the given files (other files are ignored). */
export function parseIvFiles(files: IvFile[]): { curves: IvCurve[]; warnings: string[]; ignored: number } {
  const warnings: string[] = [],
    useful = files.filter(
      (f) => !/(^|[\\/])(__MACOSX|\._)/.test(f.name) && !/^\._/.test(base(f.name)) && !LIFE_JV.test(base(f.name)), // lifetime runs: parseLifetime
    );
  const curves = [...readCsvExport(useful, warnings), ...readTxtExport(useful, warnings)];
  const used = useful.filter(
    (f) => CSV_EXPORT.test(base(f.name)) || TXT_CURVE.test(base(f.name)) || TXT_PARAMS.test(base(f.name)),
  ).length;
  return { curves, warnings, ignored: files.length - used };
}

/**
 * A J–V curve whose parameters are ambiguous: between 0 V and the highest voltage the photocurrent changes sign more than once
 * (it reverses and recovers, as in forward scans of a degrading or charging device), so there are two candidate Voc values and
 * the parameters depend on which one is taken. Sign changes smaller than 0.5 mA/cm² are ignored as noise. Expects the
 * photocurrent positive (as `orient` leaves it).
 */
export function curveDistorted(V: number[], J: number[]): boolean {
  const pts = V.map((v, i) => [v, J[i]] as const)
    .filter(([v, j]) => v >= 0 && Number.isFinite(j))
    .sort((a, b) => a[0] - b[0]);
  let sign = 0,
    flips = 0;
  for (const [, j] of pts) {
    if (Math.abs(j) < 0.5) continue;
    const s = Math.sign(j);
    if (sign && s !== sign) flips++;
    sign = s;
  }
  return flips > 1;
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
    const a = p[i - 1],
      b = p[i];
    return a.v === b.v ? b.t : a.t + ((a.v - f) / (a.v - b.v)) * (b.t - a.t);
  }
  return null;
}

// ------------------------------------------------------------------ lifetime runs (multi-pixel CSV systems)
/**
 * The Ossila software's lifetime test: the same pixels scanned again and again (held at maximum power in between), one export
 * folder per run:
 *  - `Settings/<run> Lifetime Settings.csv`: area, illumination, pixels, duration, interval, hold voltage;
 *  - `J-V Data/<yy-mm-dd_hh-mm-ss> J-V Data.csv`: every pixel's forward and reverse scan at that moment (A/cm²);
 *  - `<run> Pixel <n>[ Reverse].csv`: the software's own values per scan, with the time in seconds since the start;
 *  - `<run> Light Temperature Data.csv`: photodiode current and temperature, when those sensors are connected.
 * A run started again in the same folder writes "(2)" copies; the copy whose scans match the J–V files is used. Each time point
 * becomes a scan ("0001", "0002", …) of the same pixels with `t`, its time in seconds since the start.
 */
const LIFE_JV = /^(\d{2})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2}) J-V Data\.csv$/i;
const LIFE_SET = /^(.+) Lifetime Settings(?: \((\d+)\))?\.csv$/i;
const LIFE_PX = /^(.+) Pixel (\w+)( Reverse)?(?: \((\d+)\))?\.csv$/i;
const LIFE_LIGHT = /^(.+) Light Temperature Data(?: \((\d+)\))?\.csv$/i;

export type LifeCurve = IvCurve & { t: number; point: number };
export interface LifetimeRun {
  /** run name given in the software ("additive_lifetime") */
  run: string;
  folder: string;
  date: string; // yyyy-mm-dd
  start: string; // local date and time of the first scan, yyyy-mm-ddThh:mm:ss
  settings: Record<string, string>;
  area: number;
  pin: number;
  points: number;
  /** seconds since the start of each time point (its first scan) */
  times: number[];
  curves: LifeCurve[];
  /** light and temperature readings, empty when the sensors were not connected */
  light: { t: number; photodiode: number; temp: number }[];
  sensors: boolean;
  warnings: string[];
}

const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, '');
const verOf = (v: string | undefined) => (v ? +v : 1);

export function parseLifetime(files: IvFile[]): LifetimeRun[] {
  const runs: LifetimeRun[] = [];
  const settingsFiles = files.filter((f) => LIFE_SET.test(base(f.name)));
  for (const sf of settingsFiles) {
    const run = LIFE_SET.exec(base(sf.name))![1];
    const sdir = dirOf(sf.name),
      folder = /[\\/]?Settings$/i.test(sdir) ? sdir.replace(/[\\/]?Settings$/i, '') : sdir;
    if (runs.some((r) => r.folder === folder)) continue; // one run per folder (its "(2)" copies are versions)
    const inFolder = files.filter((f) => f.name === base(f.name) || f.name.startsWith(folder));
    const jv = inFolder
      .filter((f) => LIFE_JV.test(base(f.name)))
      .map((f) => {
        const m = LIFE_JV.exec(base(f.name))!;
        const at = `20${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
        return { f, at, ms: Date.parse(at + 'Z') };
      })
      .sort((a, b) => a.ms - b.ms);
    if (!jv.length) continue;
    // the software's per-scan values, by version; the version with as many rows as there are J–V files belongs to them
    const summary = new Map<number, Map<string, number[][]>>();
    for (const f of inFolder) {
      const m = LIFE_PX.exec(base(f.name));
      if (!m || m[1] !== run) continue;
      const v = verOf(m[4]),
        key = `${m[2]}|${m[3] ? 'rev' : 'fwd'}`;
      const rows = csvRows(f.text)
        .slice(1)
        .map((r) => r.map(num));
      if (!summary.has(v)) summary.set(v, new Map());
      summary.get(v)!.set(key, rows);
    }
    const vers = [...summary.entries()].map(([v, m]) => ({
      v,
      n: Math.max(0, ...[...m.values()].map((r) => r.length)),
    }));
    const pick = vers.find((x) => x.n === jv.length) ?? vers.sort((a, b) => b.n - a.n)[0];
    const sum = pick ? summary.get(pick.v)! : new Map<string, number[][]>();
    const setFile =
      inFolder.find((f) => LIFE_SET.test(base(f.name)) && verOf(LIFE_SET.exec(base(f.name))![2]) === (pick?.v ?? 1)) ??
      sf;
    const settings = Object.fromEntries(csvRows(setFile.text).map((r) => [r[0], r.slice(1).join(',')]));
    const area = num(settings['Pixel Area (cm^2)']) || 0,
      pin = num(settings['Illumination (mW/cm^-2)']) || num(settings['Illumination (mW/cm^2)']) || 100;
    const warnings: string[] = [];
    if (pick && pick.n !== jv.length)
      warnings.push(
        `${run}: ${jv.length} J–V files but ${pick.n} rows in the software's own values; times are taken from the file names`,
      );
    const exact = !!pick && pick.n === jv.length;
    const curves: LifeCurve[] = [];
    const times: number[] = [];
    let dropped = 0;
    jv.forEach(({ f, ms }, k) => {
      const rows = csvRows(f.text),
        head = rows[0] ?? [],
        units = rows[1] ?? [];
      const group: LifeCurve[] = [];
      for (let c = 0; c + 1 < head.length; c += 2) {
        const pm = /Pixel\s*(\w+)(\s+Reverse)?/i.exec(head[c].trim());
        if (!pm) continue;
        const scale = /mA/.test(units[c + 1] ?? '') ? 1 : 1000;
        const V: number[] = [],
          J: number[] = [];
        for (const r of rows.slice(2)) {
          const v = num(r[c]),
            j = num(r[c + 1]);
          // a current of exactly 0 is a reading the instrument missed (it writes 0.0), not a measured value
          if (j === 0) dropped++;
          else if (Number.isFinite(v) && Number.isFinite(j)) {
            V.push(v);
            J.push(j * scale);
          }
        }
        if (V.length < 3) continue;
        const dir: Dir = pm[2] ? 'rev' : 'fwd',
          row = sum.get(`${pm[1]}|${dir}`)?.[k];
        const t = exact && row && Number.isFinite(row[0]) ? row[0] : (ms - jv[0].ms) / 1000;
        group.push({
          file: f.name,
          system: 'csv',
          date: jv[0].at.slice(0, 10),
          sample: run,
          substrate: '1',
          scan: String(k + 1).padStart(4, '0'),
          pixel: pm[1],
          dir,
          area,
          pin,
          V,
          J,
          inst:
            exact && row
              ? {
                  pce: row[1],
                  ff: row[2],
                  jsc: Number.isFinite(row[3]) ? Math.abs(row[3] * 1000) : undefined,
                  voc: row[4],
                }
              : undefined,
          settings,
          t,
          point: k + 1,
        });
      }
      orient(group);
      curves.push(...group);
      times.push(group.length ? Math.min(...group.map((c) => c.t)) : (ms - jv[0].ms) / 1000);
    });
    if (dropped)
      warnings.push(
        `${run}: ${dropped} J–V point${dropped === 1 ? '' : 's'} with a current of exactly 0 (readings the instrument missed) left out`,
      );
    // light and temperature: kept only when the sensors were connected (unconnected, the software reports about −273 °C)
    const lf = inFolder.find(
      (f) => LIFE_LIGHT.test(base(f.name)) && verOf(LIFE_LIGHT.exec(base(f.name))![2]) === (pick?.v ?? 1),
    );
    const light = (lf ? csvRows(lf.text).slice(1) : [])
      .map((r) => ({ t: num(r[0]), photodiode: num(r[1]), temp: num(r[2]) }))
      .filter((x) => Number.isFinite(x.t));
    const sensors = light.length > 0 && light.some((x) => x.temp > -100);
    runs.push({
      run,
      folder,
      date: jv[0].at.slice(0, 10),
      start: jv[0].at,
      settings,
      area,
      pin,
      points: jv.length,
      times,
      curves,
      light: sensors ? light : [],
      sensors,
      warnings,
    });
  }
  return runs;
}
