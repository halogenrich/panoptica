import { casValid, composition, normCas } from './chem';

/**
 * Finding and naming substances (0.54): short names (DMF, MeO-2PACz), other names, a search that ranks what was typed, the
 * reference list of common compounds, and pairs that may be the same substance written twice.
 */

/** Text as search compares it: no case, accents, spaces or punctuation ("N,N-Dimetilformamida" → "nndimetilformamida"). */
export const fold = (t: string) =>
  (t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** What a search looks at for one choice: its main text, its short name, and other texts that also find it. */
export type Findable = { label: string; short?: string; other?: string[] };

/** Edits needed to turn `q` into some part of `t` (approximate matching: the part may start and end anywhere). */
function fuzzy(q: string, t: string) {
  let prev = new Array(t.length + 1).fill(0) as number[];
  for (let i = 1; i <= q.length; i++) {
    const cur = [i];
    for (let j = 1; j <= t.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (q[i - 1] === t[j - 1] ? 0 : 1));
    prev = cur;
  }
  return Math.min(...prev);
}

/**
 * How well `q` finds a choice, lower first; null when it does not. Order: the short name exactly, the short name's start, the
 * start of the main text, the start of one of its words, anywhere in it, then the other texts (other names, formula, CAS),
 * then a near miss (a few letters wrong, as in "dimetilformamida" for dimethylformamide).
 */
export function matchRank(q: string, x: Findable): number | null {
  const fq = fold(q);
  if (!fq) return 0;
  const s = fold(x.short ?? ''),
    m = fold(x.label);
  if (s && s === fq) return 0;
  if (s && s.startsWith(fq)) return 1;
  if (m === fq) return 1;
  if (m.startsWith(fq)) return 2;
  if (
    (x.label ?? '')
      .split(/[^\p{L}\p{N}]+/u)
      .map(fold)
      .some((w) => w && w.startsWith(fq))
  )
    return 3;
  if (m.includes(fq) || (s && s.includes(fq))) return 4;
  const others = (x.other ?? []).map(fold).filter(Boolean);
  if (others.some((o) => o === fq || o.startsWith(fq))) return 5;
  if (others.some((o) => o.includes(fq))) return 6;
  if (fq.length >= 5) {
    const allowed = Math.floor(fq.length / 4);
    if ([m, ...others].some((t) => t && fuzzy(fq, t) <= allowed)) return 7;
  }
  return null;
}

/** The choices `q` finds, best first (ties keep the order given). */
export function search<T>(q: string, list: T[], of: (x: T) => Findable): T[] {
  return list
    .map((x, i) => ({ x, i, r: matchRank(q, of(x)) }))
    .filter((r) => r.r !== null)
    .sort((a, b) => a.r! - b.r! || a.i - b.i)
    .map((r) => r.x);
}

/**
 * A common compound the lab may have: its usual short name, its roles, other names people search with, and (0.57) its
 * structure as SMILES for the organic ones (none for salts of metals, oxides, metals, polymers and fullerenes).
 */
export type ChemRef = { cas: string; s: string; roles: string[]; aka?: string[]; smiles?: string };

/**
 * Common compounds of solar cell labs, by CAS number (0.54, approved by Richard): when a container of one is added, its
 * substance gets this short name and these roles, and these other names, when it has none. Reference data, not a lab's: a
 * clean install holds no substance. Every CAS number here passes the check digit (unit test).
 */
// prettier-ignore
export const CHEM_REF: ChemRef[] = [
  // solvents
  { cas: '68-12-2', s: 'DMF', roles: ['solvent'], aka: ['Dimethylformamide', 'Dimetilformamida'], smiles: 'CN(C)C=O' },
  { cas: '67-68-5', s: 'DMSO', roles: ['solvent'], aka: ['Dimethyl sulfoxide', 'Dimetilsulfóxido'], smiles: 'CS(C)=O' },
  { cas: '108-90-7', s: 'CB', roles: ['solvent'], aka: ['Chlorobenzene', 'Clorobenzeno'], smiles: 'Clc1ccccc1' },
  { cas: '95-50-1', s: 'DCB', roles: ['solvent'], aka: ['o-Dichlorobenzene', 'Diclorobenzeno'], smiles: 'Clc1ccccc1Cl' },
  { cas: '67-63-0', s: 'IPA', roles: ['solvent'], aka: ['Isopropanol', '2-Propanol', 'Álcool isopropílico'], smiles: 'CC(C)O' },
  { cas: '64-17-5', s: 'EtOH', roles: ['solvent'], aka: ['Ethanol', 'Etanol'], smiles: 'CCO' },
  { cas: '67-56-1', s: 'MeOH', roles: ['solvent'], aka: ['Methanol', 'Metanol'], smiles: 'CO' },
  { cas: '71-36-3', s: 'n-BuOH', roles: ['solvent'], aka: ['1-Butanol', 'Butanol'], smiles: 'CCCCO' },
  { cas: '67-64-1', s: 'Acetone', roles: ['solvent'], aka: ['Acetona'], smiles: 'CC(C)=O' },
  { cas: '108-88-3', s: 'Toluene', roles: ['solvent'], aka: ['Tolueno'], smiles: 'Cc1ccccc1' },
  { cas: '100-66-3', s: 'Anisole', roles: ['solvent'], aka: ['Anisol'], smiles: 'COc1ccccc1' },
  { cas: '141-78-6', s: 'EtOAc', roles: ['solvent'], aka: ['Ethyl acetate', 'Acetato de etila'], smiles: 'CCOC(C)=O' },
  { cas: '79-20-9', s: 'MeOAc', roles: ['solvent'], aka: ['Methyl acetate', 'Acetato de metila'], smiles: 'COC(C)=O' },
  { cas: '60-29-7', s: 'Et2O', roles: ['solvent'], aka: ['Diethyl ether', 'Éter etílico', 'Éter dietílico'], smiles: 'CCOCC' },
  { cas: '67-66-3', s: 'CHCl3', roles: ['solvent'], aka: ['Chloroform', 'Clorofórmio'], smiles: 'ClC(Cl)Cl' },
  { cas: '75-09-2', s: 'DCM', roles: ['solvent'], aka: ['Dichloromethane', 'Diclorometano'], smiles: 'ClCCl' },
  { cas: '872-50-4', s: 'NMP', roles: ['solvent'], aka: ['N-Methyl-2-pyrrolidone', 'N-Metil-2-pirrolidona'], smiles: 'CN1CCCC1=O' },
  { cas: '127-19-5', s: 'DMAc', roles: ['solvent'], aka: ['Dimethylacetamide', 'Dimetilacetamida'], smiles: 'CN(C)C(C)=O' },
  { cas: '96-48-0', s: 'GBL', roles: ['solvent'], aka: ['gamma-Butyrolactone', 'γ-Butirolactona'], smiles: 'O=C1CCCO1' },
  { cas: '109-86-4', s: '2-ME', roles: ['solvent'], aka: ['2-Methoxyethanol', '2-Metoxietanol'], smiles: 'COCCO' },
  { cas: '75-05-8', s: 'ACN', roles: ['solvent'], aka: ['Acetonitrile', 'Acetonitrila'], smiles: 'CC#N' },
  { cas: '109-99-9', s: 'THF', roles: ['solvent'], aka: ['Tetrahydrofuran', 'Tetra-hidrofurano'], smiles: 'C1CCOC1' },
  { cas: '110-54-3', s: 'Hexane', roles: ['solvent'], aka: ['n-Hexane', 'Hexano'], smiles: 'CCCCCC' },
  { cas: '110-82-7', s: 'Cyclohexane', roles: ['solvent'], aka: ['Ciclo-hexano'], smiles: 'C1CCCCC1' },
  { cas: '108-67-8', s: 'Mesitylene', roles: ['solvent'], aka: ['Mesitileno'], smiles: 'Cc1cc(C)cc(C)c1' },
  { cas: '7732-18-5', s: 'H2O', roles: ['solvent'], aka: ['Water', 'Água'] },
  // perovskite salts and additives
  { cas: '10101-63-0', s: 'PbI2', roles: ['salt'], aka: ['Lead iodide', 'Iodeto de chumbo'] },
  { cas: '10031-22-8', s: 'PbBr2', roles: ['salt'], aka: ['Lead bromide', 'Brometo de chumbo'] },
  { cas: '7758-95-4', s: 'PbCl2', roles: ['salt'], aka: ['Lead chloride', 'Cloreto de chumbo'] },
  { cas: '592-87-0', s: 'Pb(SCN)2', roles: ['additive'], aka: ['Lead thiocyanate'] },
  { cas: '6080-56-4', s: 'Pb(OAc)2·3H2O', roles: ['salt'], aka: ['Lead acetate trihydrate'] },
  { cas: '10294-70-9', s: 'SnI2', roles: ['salt'], aka: ['Tin iodide'] },
  { cas: '7783-47-3', s: 'SnF2', roles: ['additive'], aka: ['Tin fluoride'] },
  { cas: '7789-17-5', s: 'CsI', roles: ['salt'], aka: ['Cesium iodide', 'Iodeto de césio'] },
  { cas: '7787-69-1', s: 'CsBr', roles: ['salt'], aka: ['Cesium bromide'] },
  { cas: '7647-17-8', s: 'CsCl', roles: ['salt'], aka: ['Cesium chloride'] },
  { cas: '7790-29-6', s: 'RbI', roles: ['salt'], aka: ['Rubidium iodide'] },
  { cas: '7681-11-0', s: 'KI', roles: ['additive'], aka: ['Potassium iodide'] },
  { cas: '14965-49-2', s: 'MAI', roles: ['salt'], aka: ['Methylammonium iodide'], smiles: 'C[NH3+].[I-]' },
  { cas: '6876-37-5', s: 'MABr', roles: ['salt'], aka: ['Methylammonium bromide'], smiles: 'C[NH3+].[Br-]' },
  { cas: '593-51-1', s: 'MACl', roles: ['additive'], aka: ['Methylammonium chloride', 'Methylamine hydrochloride'], smiles: 'C[NH3+].[Cl-]' },
  { cas: '879643-71-7', s: 'FAI', roles: ['salt'], aka: ['Formamidinium iodide'], smiles: 'NC=[NH2+].[I-]' },
  { cas: '146958-06-7', s: 'FABr', roles: ['salt'], aka: ['Formamidinium bromide'], smiles: 'NC=[NH2+].[Br-]' },
  { cas: '6313-33-3', s: 'FACl', roles: ['additive'], aka: ['Formamidinium chloride', 'Formamidine hydrochloride'], smiles: 'NC=[NH2+].[Cl-]' },
  { cas: '3473-63-0', s: 'FAAc', roles: ['salt'], aka: ['Formamidinium acetate', 'Formamidine acetate'], smiles: 'NC=[NH2+].CC(=O)[O-]' },
  { cas: '50-01-1', s: 'GACl', roles: ['additive'], aka: ['Guanidinium chloride', 'Guanidine hydrochloride'], smiles: 'NC(N)=[NH2+].[Cl-]' },
  { cas: '19227-70-4', s: 'GAI', roles: ['additive'], aka: ['Guanidinium iodide'], smiles: 'NC(N)=[NH2+].[I-]' },
  { cas: '593-84-0', s: 'GASCN', roles: ['additive'], aka: ['Guanidinium thiocyanate', 'Guanidine thiocyanate'], smiles: 'NC(N)=[NH2+].[S-]C#N' },
  { cas: '151059-43-7', s: 'PEAI', roles: ['additive'], aka: ['Phenethylammonium iodide'], smiles: '[NH3+]CCc1ccccc1.[I-]' },
  { cas: '36945-08-1', s: 'BAI', roles: ['additive'], aka: ['n-Butylammonium iodide'], smiles: 'CCCC[NH3+].[I-]' },
  { cas: '3978-81-2', s: 'tBP', roles: ['additive'], aka: ['4-tert-Butylpyridine'], smiles: 'CC(C)(C)c1ccncc1' },
  { cas: '90076-65-6', s: 'Li-TFSI', roles: ['additive'], aka: ['Lithium bis(trifluoromethanesulfonyl)imide', 'LiTFSI'], smiles: '[Li+].O=S(=O)([N-]S(=O)(=O)C(F)(F)F)C(F)(F)F' },
  { cas: '1447938-61-5', s: 'FK209', roles: ['additive'], aka: ['FK 209 Co(III) TFSI'] },
  // transport layers, self-assembled monolayers, contacts
  { cas: '207739-72-8', s: 'Spiro-OMeTAD', roles: ['htl'], aka: ['Spiro-MeOTAD'], smiles: 'COc1ccc(N(c2ccc(OC)cc2)c2ccc3c(c2)C2(c4cc(N(c5ccc(OC)cc5)c5ccc(OC)cc5)ccc4-3)c3cc(N(c4ccc(OC)cc4)c4ccc(OC)cc4)ccc3-c3ccc(N(c4ccc(OC)cc4)c4ccc(OC)cc4)cc32)cc1' },
  { cas: '1333317-99-9', s: 'PTAA', roles: ['htl'] },
  { cas: '472960-35-3', s: 'Poly-TPD', roles: ['htl'] },
  { cas: '104934-50-1', s: 'P3HT', roles: ['htl'] },
  { cas: '155090-83-8', s: 'PEDOT:PSS', roles: ['htl'] },
  { cas: '20999-38-6', s: '2PACz', roles: ['htl'], smiles: 'OP(=O)(O)CCn1c2ccccc2c2ccccc21' },
  { cas: '2377770-18-6', s: 'MeO-2PACz', roles: ['htl'], smiles: 'COc1ccc2c(c1)c1cc(OC)ccc1n2CCP(=O)(O)O' },
  { cas: '2747959-96-0', s: 'Me-4PACz', roles: ['htl'], smiles: 'Cc1ccc2c(c1)c1cc(C)ccc1n2CCCCP(=O)(O)O' },
  { cas: '2922526-56-3', s: 'MeO-4PACz', roles: ['htl'], smiles: 'COc1ccc2c(c1)c1cc(OC)ccc1n2CCCCP(=O)(O)O' },
  { cas: '2996161-30-7', s: 'Me-2PACz', roles: ['htl'], smiles: 'Cc1ccc2c(c1)c1cc(C)ccc1n2CCP(=O)(O)O' },
  { cas: '1313-99-1', s: 'NiO', roles: ['htl'], aka: ['Nickel oxide'] },
  { cas: '13478-00-7', s: 'Ni(NO3)2·6H2O', roles: ['htl'], aka: ['Nickel nitrate hexahydrate'] },
  { cas: '1313-27-5', s: 'MoO3', roles: ['htl', 'organic'], aka: ['Molybdenum oxide'] },
  { cas: '160848-22-6', s: 'PCBM', roles: ['etl'], aka: ['PC61BM', 'PC60BM'] },
  { cas: '609771-63-3', s: 'PC71BM', roles: ['etl'], aka: ['PC70BM'] },
  { cas: '1207461-57-1', s: 'ICBA', roles: ['etl'] },
  { cas: '99685-96-8', s: 'C60', roles: ['etl', 'organic'], aka: ['Fullerene', 'Fulereno'] },
  { cas: '115383-22-7', s: 'C70', roles: ['etl', 'organic'] },
  { cas: '4733-39-5', s: 'BCP', roles: ['etl', 'organic'], aka: ['Bathocuproine', 'Batocuproína'], smiles: 'Cc1cc(-c2ccccc2)c2ccc3c(-c4ccccc4)cc(C)nc3c2n1' },
  { cas: '18282-10-5', s: 'SnO2', roles: ['etl'], aka: ['Tin oxide'] },
  { cas: '13463-67-7', s: 'TiO2', roles: ['etl'], aka: ['Titanium dioxide'] },
  { cas: '1314-13-2', s: 'ZnO', roles: ['etl'], aka: ['Zinc oxide'] },
  { cas: '7789-24-4', s: 'LiF', roles: ['organic'], aka: ['Lithium fluoride'] },
  { cas: '50926-11-9', s: 'ITO', roles: ['other'], aka: ['Indium tin oxide'] },
  { cas: '7440-22-4', s: 'Ag', roles: ['metal'], aka: ['Silver', 'Prata'] },
  { cas: '7440-57-5', s: 'Au', roles: ['metal'], aka: ['Gold', 'Ouro'] },
  { cas: '7440-50-8', s: 'Cu', roles: ['metal'], aka: ['Copper', 'Cobre'] },
  { cas: '7429-90-5', s: 'Al', roles: ['metal'], aka: ['Aluminium', 'Aluminum', 'Alumínio'] },
];
const byCas = new Map(CHEM_REF.map((r) => [r.cas, r]));
/** The reference entry for a CAS number, if it is a common compound. */
export const chemRef = (cas: string) => byCas.get(normCas(cas ?? ''));

/** What duplicate detection reads of a substance. */
export type DupChem = { id: number; name: string; cas: string; f: string; s: string; aka: string[] };
export type DupPair = { a: number; b: number; why: 'cas' | 'name' | 'formula' };

const sameFormula = (x: string, y: string) => {
  if (!x || !y) return false;
  const a = composition(x),
    b = composition(y);
  if (!a || !b) return false;
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => Math.abs(a[k] - (b[k] ?? NaN)) < 1e-9);
};

/**
 * Pairs that may be one substance written twice (0.54): the same CAS number; a name that is the other's name, short name or
 * one of its other names; or the same formula (by its atoms) with no CAS numbers that disagree. Never merged by itself: people
 * merge them, or say they are not the same.
 */
export function duplicatePairs(list: DupChem[]): DupPair[] {
  const out: DupPair[] = [];
  const names = (c: DupChem) => new Set([c.name, c.s, ...c.aka].map(fold).filter(Boolean));
  const ns = list.map(names);
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const x = list[i],
        y = list[j],
        cx = normCas(x.cas),
        cy = normCas(y.cas);
      const [a, b] = x.id < y.id ? [x.id, y.id] : [y.id, x.id];
      if (cx && cx === cy) out.push({ a, b, why: 'cas' });
      else if (cx && cy)
        continue; // two CAS numbers that disagree: two substances
      else if ([...ns[i]].some((n) => ns[j].has(n))) out.push({ a, b, why: 'name' });
      else if (sameFormula(x.f, y.f)) out.push({ a, b, why: 'formula' });
    }
  return out;
}

/**
 * A substance's data with what the reference list knows added (0.54): the short name when it has none, its other names and
 * roles joined to the ones it has. Never removes or overwrites.
 */
export function withRef<T extends { s?: string; aka?: string[]; roles?: string[]; smiles?: string }>(
  d: T,
  r: ChemRef | undefined,
): T {
  if (!r) return d;
  const aka = [...(d.aka ?? [])];
  for (const n of r.aka ?? []) if (!aka.some((x) => fold(x) === fold(n))) aka.push(n);
  return {
    ...d,
    s: d.s || r.s,
    aka,
    ...(d.smiles || r.smiles ? { smiles: d.smiles || r.smiles } : {}),
    roles: [...new Set([...(d.roles ?? []), ...r.roles.filter((x) => x !== 'other')])],
  };
}

/** What a substance is known by, for finding the one a name means (0.55.4). */
export type Known = { name: string; s?: string; aka?: string[]; f?: string; cas?: string };

/**
 * The substance a name means (0.55.4). Recipes work out names such as PbI2, MAI or FAI from a composition, while the inventory
 * may hold "Lead(II) iodide" with PbI2 as its short name; matching on the name alone said "Not in the inventory" for a
 * substance in stock. In order: the same name; then, with case, accents and punctuation ignored, the name, the short name,
 * an other name; the CAS number (typed as the name, or the reference list's compound with that short name); the formula
 * as written; the same atoms (PbI2 and I2Pb). The last two count only when one substance alone matches.
 */
export function chemNamed<T>(list: T[], name: string, of: (x: T) => Known): T | undefined {
  if (!name) return undefined;
  const k = list.map(of),
    exact = k.findIndex((x) => x.name === name);
  if (exact >= 0) return list[exact];
  const fn = fold(name);
  if (!fn) return undefined;
  const first = (p: (x: Known) => boolean) => {
    const i = k.findIndex(p);
    return i >= 0 ? list[i] : undefined;
  };
  const only = (p: (x: Known) => boolean) => {
    const hits = list.filter((_, i) => p(k[i]));
    return hits.length === 1 ? hits[0] : undefined;
  };
  const cas = normCas(name),
    refCas = CHEM_REF.find((r) => fold(r.s) === fn)?.cas;
  return (
    first((x) => fold(x.name) === fn) ??
    first((x) => !!x.s && fold(x.s) === fn) ??
    first((x) => (x.aka ?? []).some((a) => fold(a) === fn)) ??
    (casValid(name) ? first((x) => !!x.cas && normCas(x.cas) === cas) : undefined) ??
    (refCas ? first((x) => !!x.cas && normCas(x.cas) === refCas) : undefined) ??
    only((x) => !!x.f && fold(x.f) === fn) ??
    only((x) => !!x.f && sameFormula(x.f, name))
  );
}
