/**
 * Substances (0.44): molar mass from a formula, CAS numbers, hazard pictograms. The inventory's substances are made from the
 * containers people add or import; these helpers fill in what can be worked out.
 */

/** Standard atomic weights (IUPAC, conventional values), g/mol. */
// prettier-ignore
const W: Record<string, number> = {
  H: 1.008, He: 4.0026, Li: 6.94, Be: 9.0122, B: 10.81, C: 12.011, N: 14.007, O: 15.999, F: 18.998, Ne: 20.18,
  Na: 22.99, Mg: 24.305, Al: 26.982, Si: 28.085, P: 30.974, S: 32.06, Cl: 35.45, Ar: 39.95, K: 39.098, Ca: 40.078,
  Sc: 44.956, Ti: 47.867, V: 50.942, Cr: 51.996, Mn: 54.938, Fe: 55.845, Co: 58.933, Ni: 58.693, Cu: 63.546,
  Zn: 65.38, Ga: 69.723, Ge: 72.63, As: 74.922, Se: 78.971, Br: 79.904, Kr: 83.798, Rb: 85.468, Sr: 87.62,
  Y: 88.906, Zr: 91.224, Nb: 92.906, Mo: 95.95, Ru: 101.07, Rh: 102.91, Pd: 106.42, Ag: 107.87, Cd: 112.41,
  In: 114.82, Sn: 118.71, Sb: 121.76, Te: 127.6, I: 126.904, Xe: 131.29, Cs: 132.905, Ba: 137.33, La: 138.91,
  Ce: 140.12, Pr: 140.91, Nd: 144.24, Sm: 150.36, Eu: 151.96, Gd: 157.25, Tb: 158.93, Dy: 162.5, Ho: 164.93,
  Er: 167.26, Tm: 168.93, Yb: 173.05, Lu: 174.97, Hf: 178.49, Ta: 180.95, W: 183.84, Re: 186.21, Os: 190.23,
  Ir: 192.22, Pt: 195.08, Au: 196.97, Hg: 200.59, Tl: 204.38, Pb: 207.2, Bi: 208.98, Th: 232.04, Pa: 231.04,
  U: 238.03,
};

/**
 * Molar mass of a formula (CH3NH3PbI3, (CH3)2SO, CuSO4·5H2O, I2Pb), g/mol to two decimals; null when it cannot be read (an
 * unknown element, a hydrate with n water, charges written as in SMILES). Never a guess: a wrong molar mass gives wrong masses.
 */
export function molarMass(formula: string): number | null {
  // parts joined by "·" or "." (CuSO4·5H2O, Cl2Sr.6.0H2O): a "." between digits is a decimal point
  const raw = formula.replace(/\s+/g, '').split(/[·•*]/),
    parts: string[] = [];
  for (const r of raw) {
    const t = r.split('.');
    for (let i = 0; i < t.length; i++) {
      if (/^\d+$/.test(t[i]) && i + 1 < t.length && /^\d/.test(t[i + 1])) {
        t[i + 1] = t[i] + '.' + t[i + 1];
        continue;
      }
      if (t[i]) parts.push(t[i]);
    }
  }
  if (!parts.length) return null;
  let total = 0;
  for (const part of parts) {
    const m = part.match(/^(\d*(?:\.\d+)?)(.*)$/)!;
    const k = m[1] ? +m[1] : 1,
      v = group(m[2]);
    if (v === null || !k) return null;
    total += k * v;
  }
  return Math.round(total * 100) / 100;
}
function group(s: string): number | null {
  let i = 0;
  const read = (): number | null => {
    let sum = 0;
    while (i < s.length && s[i] !== ')' && s[i] !== ']') {
      let v: number | null;
      if (s[i] === '(' || s[i] === '[') {
        i++;
        v = read();
        if (v === null || (s[i] !== ')' && s[i] !== ']')) return null;
        i++;
      } else {
        const e = s.slice(i).match(/^[A-Z][a-z]?/);
        if (!e || W[e[0]] === undefined) return null;
        v = W[e[0]];
        i += e[0].length;
      }
      const n = s.slice(i).match(/^\d+(?:\.\d+)?/);
      if (n) i += n[0].length;
      sum += v * (n ? +n[0] : 1);
    }
    return sum;
  };
  const v = read();
  return i === s.length && v ? v : null;
}

/** A CAS number written the usual way: no spaces, no leading zeros ("0127-08-2" → "127-08-2"). '' when there is none. */
export function normCas(cas: string): string {
  const s = cas.replace(/[\s\u00a0]/g, '');
  const m = s.match(/^0*(\d{2,7})-(\d{2})-(\d)$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s;
}
/** The check digit of a CAS number is right. */
export function casValid(cas: string): boolean {
  const m = normCas(cas).match(/^(\d{2,7})-(\d{2})-(\d)$/);
  if (!m) return false;
  const digits = (m[1] + m[2]).split('').reverse();
  return digits.reduce((t, d, i) => t + +d * (i + 1), 0) % 10 === +m[3];
}

/** The GHS hazard pictograms, by code. */
export const GHS: Record<string, string> = {
  GHS01: 'Explosive',
  GHS02: 'Flammable',
  GHS03: 'Oxidising',
  GHS04: 'Gas under pressure',
  GHS05: 'Corrosive',
  GHS06: 'Toxic',
  GHS07: 'Harmful',
  GHS08: 'Health hazard',
  GHS09: 'Environment',
};
