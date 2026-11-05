/** Inventory arithmetic: units, consumption per week or month, run-out forecast and unusual use. Pure functions. */

export type Unit = 'mg' | 'g' | 'kg' | 'µL' | 'mL' | 'L';
export type Use = { mg?: number; ul?: number };
const MASS: Record<string, number> = { mg: 1, g: 1e3, kg: 1e6 },
  VOL: Record<string, number> = { µL: 1, mL: 1e3, L: 1e6 };
export const isMass = (u: string) => u in MASS;

/**
 * An amount in the base unit of `base` ('mg' for solids, 'µL' for liquids). Mass and volume convert with the density
 * (g/mL = mg/µL); without one, a mismatched amount is null.
 */
export function toBase(v: number, unit: string, base: 'mg' | 'µL', density?: number | null): number | null {
  if (unit in MASS) {
    const mg = v * MASS[unit];
    return base === 'mg' ? mg : density ? mg / density : null;
  }
  if (unit in VOL) {
    const ul = v * VOL[unit];
    return base === 'µL' ? ul : density ? ul * density : null;
  }
  return null;
}
/** A use (mg and/or µL) in one base unit. */
export const amountIn = (u: Use, base: 'mg' | 'µL', density?: number | null) =>
  (u.mg ? (toBase(u.mg, 'mg', base, density) ?? 0) : 0) + (u.ul ? (toBase(u.ul, 'µL', base, density) ?? 0) : 0);
/** Readable amount: 1 234 mg → 1.23 g, 2 500 µL → 2.5 mL. */
export function fmtAmount(v: number, base: 'mg' | 'µL') {
  const [s, m, l] = base === 'mg' ? ['mg', 'g', 'kg'] : ['µL', 'mL', 'L'],
    a = Math.abs(v);
  const [x, u] = a >= 1e6 ? [v / 1e6, l] : a >= 1e3 ? [v / 1e3, m] : [v, s];
  return `${+x.toPrecision(3)} ${u}`;
}

export type Period = 'week' | 'month';
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
/** Start of the period containing `iso` (weeks start on Monday), as YYYY-MM-DD. */
export function periodStart(iso: string, p: Period) {
  const d = new Date(
    iso.length === 10 ? iso + 'T00:00:00Z' : iso.replace(' ', 'T') + (/[Z+]/.test(iso.slice(10)) ? '' : 'Z'),
  );
  if (p === 'month') return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`;
  const k = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - k);
  return ymd(d);
}
/** The next period start after `start`. */
export function nextPeriod(start: string, p: Period) {
  const d = new Date(start + 'T00:00:00Z');
  if (p === 'month') d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCDate(d.getUTCDate() + 7);
  return ymd(d);
}
/** Every period from the one containing `from` to the one containing `to`, with the summed values (0 where nothing was used). */
export function series(events: { date: string; v: number }[], p: Period, from: string, to: string) {
  const sum = new Map<string, number>();
  for (const e of events) {
    const k = periodStart(e.date, p);
    sum.set(k, (sum.get(k) ?? 0) + e.v);
  }
  const out: { start: string; v: number }[] = [],
    end = periodStart(to, p);
  for (let k = periodStart(from, p), i = 0; k <= end && i < 600; k = nextPeriod(k, p), i++)
    out.push({ start: k, v: sum.get(k) ?? 0 });
  return out;
}

/**
 * Rate and run-out: the mean use per period over the last `n` complete periods (8 weeks or 6 months by default), and how many
 * periods the stock lasts at that rate. Unusual: a period above both 2 × the mean of the earlier periods and the mean plus 3
 * standard deviations (needs at least 4 earlier periods, 3 of them with some use).
 */
export function forecast(s: { start: string; v: number }[], stock: number, p: Period, n = p === 'week' ? 8 : 6) {
  const done = s.slice(0, -1),
    win = done.slice(-n),
    rate = win.length ? win.reduce((a, x) => a + x.v, 0) / win.length : 0;
  const periods = rate > 0 ? stock / rate : Infinity;
  const unusual = s.map((x, i) => {
    const prev = s.slice(Math.max(0, i - 12), i).map((y) => y.v);
    if (prev.length < 4 || prev.filter((v) => v > 0).length < 3 || x.v <= 0) return false; // the first weeks of use are not unusual
    const m = prev.reduce((a, v) => a + v, 0) / prev.length,
      sd = Math.sqrt(prev.reduce((a, v) => a + (v - m) ** 2, 0) / (prev.length - 1));
    return x.v > 2 * m && x.v > m + 3 * sd;
  });
  return { rate, periods, unusual, days: periods * (p === 'week' ? 7 : 30.44) };
}
