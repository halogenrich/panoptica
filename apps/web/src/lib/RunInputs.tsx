import type { RunField } from '../recipes/types';

const SUP: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };

/** "2.1e-6", "2,1e-6", "2.1x10-6", "2.1 × 10^-6" -> [2.1, -6]. Null when it is not a number in that form. */
export function parseSci(v: string): [number, number] | null {
  const s = v.trim().replace(/,/g, '.').replace(/\s+/g, '');
  const m = s.match(/^(-?\d*\.?\d+)(?:(?:e|[x×*]10\^?)([+-]?\d+))?$/i);
  if (!m) return null;
  const mant = +m[1], ex = m[2] === undefined ? 0 : +m[2];
  if (!Number.isFinite(mant)) return null;
  if (m[2] === undefined && mant !== 0) { const e = Math.floor(Math.log10(Math.abs(mant))); return [+(mant / 10 ** e).toPrecision(4), e]; }
  return [mant, ex];
}

/** A run value as people write it: pressures as 2.1 × 10⁻⁶ mbar, the sensor life as T.V = 87.5 %. */
export function fmtRun(f: RunField, v: string): string {
  if (f.input === 'sci') { const p = parseSci(v); return p ? `${p[0]} × 10${String(p[1]).split('').map((c) => SUP[c] ?? c).join('')}${f.unit ? ' ' + f.unit : ''}` : `${v}${f.unit ? ' ' + f.unit : ''}`; }
  if (f.input === 'pct' && f.key === 'tv') return `T.V = ${v.replace(',', '.')} %`;
  return `${v}${f.unit ? ' ' + f.unit : ''}`;
}

/** Problem with a value, shown under the field before saving. */
export function runError(f: RunField, v: string | undefined): string {
  if (!v) return '';
  if (f.input === 'pct') { const n = +v.replace(',', '.'); return Number.isFinite(n) && n >= 0 && n <= 100 ? '' : 'Between 0 and 100 %'; }
  if (f.input === 'sci') return parseSci(v) ? '' : /e-?$/.test(v) ? 'Add the exponent' : 'Check the value';
  return '';
}

/** Pressure input: mantissa × 10^exponent. The exponent fills in from `ex` (the last one used) so a run usually needs only the mantissa. */
export function SciInput({ value, on, ex = -6, label }: { value: string; on: (v: string) => void; ex?: number; label: string }) {
  const [m = '', e = ''] = value ? value.split('e') : ['', ''];
  const set = (mm: string, ee: string) => on(mm ? `${mm.replace(/,/g, '.')}e${ee}` : '');
  return (
    <span className="sci-in" role="group" aria-label={label}>
      <input value={m} inputMode="decimal" placeholder="2.1" aria-label={label + ', value'} onChange={(x) => set(x.target.value, e || (x.target.value ? String(ex) : ''))} />
      <span className="sci-x">× 10</span>
      <input className="sci-e" value={e} inputMode="numeric" placeholder={String(ex)} aria-label={label + ', exponent'} onChange={(x) => set(m, x.target.value.replace(/[^\d-]/g, ''))} />
    </span>
  );
}

/** Percentage input with a fixed prefix, e.g. "T.V = [87.5] %". */
export function PctInput({ value, on, prefix, label }: { value: string; on: (v: string) => void; prefix?: string; label: string }) {
  return (
    <span className="pct-in">
      {prefix && <span className="mut">{prefix}</span>}
      <input value={value} inputMode="decimal" placeholder="87.5" aria-label={label} onChange={(x) => on(x.target.value.replace(/[^\d.,]/g, ''))} />
      <span className="mut">%</span>
    </span>
  );
}

/** The right control for a run field. */
export function RunInput({ f, value, on, ex }: { f: RunField; value: string; on: (v: string) => void; ex?: number }) {
  if (f.input === 'sci') return <SciInput value={value} on={on} ex={ex} label={f.label} />;
  if (f.input === 'pct') return <PctInput value={value} on={on} prefix={f.key === 'tv' ? 'T.V =' : undefined} label={f.label} />;
  return <input value={value} placeholder={f.unit ?? ''} inputMode={f.unit && f.unit !== 'mbar' ? 'decimal' : undefined} aria-label={f.label} onChange={(e) => on(e.target.value)} />;
}
