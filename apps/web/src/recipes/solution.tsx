import { useEffect, useRef, useState } from 'react';
import { SPACERS, layeredAmounts, nFromAmounts, solutionPlan, type Additive, type Basis, type Comp } from '@psc/core';
import { Check, DragHandle, Num, RemoveRow, useReorder } from '../views/common';
import { Seg } from '../lib/ui';
import { Formula, Section, T, fix, withBlank } from './shared';
import type { Ctx, Kind } from './types';

type Mode = 'Perovskite' | 'ETL' | 'HTL' | 'Custom';
/** 3D perovskite, or layered: Ruddlesden–Popper (monovalent spacer), Dion–Jacobson (divalent spacer), alternating cations in the interlayer (GA). */
type Dim = '3D' | 'RP' | 'DJ';
const spacers = (dim: Dim) => SPACERS.filter((x) => x.z === (dim === 'DJ' ? 2 : 1));
const spacerOf = (d: { dim: Dim; L: string }) => spacers(d.dim).find((x) => x.ion === d.L) ?? spacers(d.dim)[0];
const comp = (d: {
  A: Record<string, number>;
  X: Record<string, number>;
  dim: Dim;
  L: string;
  n: number;
  s?: number;
}): Comp =>
  d.dim === '3D'
    ? { A: d.A, X: d.X }
    : { A: d.A, X: d.X, L: { ion: spacerOf(d).ion, z: d.dim === 'DJ' ? 2 : 1 }, n: Math.max(1, d.n || 1), s: d.s };
const defaults = () => ({
  mode: 'Perovskite' as Mode,
  A: { FA: 1 } as Record<string, number>,
  X: { I: 1 } as Record<string, number>,
  M: 1,
  V: 1,
  meth: 'solvent' as 'solvent' | 'density',
  rho: 4.1,
  dim: '3D' as Dim,
  L: 'PEA',
  n: 2,
  s: undefined as number | undefined,
  prep: 'one' as 'one' | 'stocks',
  stocks: {} as Record<string, { c?: number; v?: number }>,
  sol: '',
  c: 20,
  u: 'mg/mL' as 'mg/mL' | 'mM',
  sv: [
    { n: 'DMF', p: 4 },
    { n: 'DMSO', p: 1 },
  ],
  ad: [] as Additive[],
  stir: true,
  sm: 30,
  heat: false,
  hT: 60,
  hm: 30,
  cool: true,
});
type D = ReturnType<typeof defaults>;
const BASES: Basis[] = ['mol%', 'wt%', 'mg/mL', 'µL/mL', 'µL stock/mL'];

const solutes = (d: D, ctx: Ctx) => {
  const by = (...r: string[]) => ctx.chems.filter((c) => r.includes(c.role)).map((c) => c.name);
  return d.mode === 'ETL' ? by('etl', 'organic') : d.mode === 'HTL' ? by('htl') : ctx.chems.map((c) => c.name);
};
const solute = (d: D, ctx: Ctx) => {
  const l = solutes(d, ctx);
  return l.includes(d.sol) ? d.sol : d.sol || l[0] || '';
};
const plan = (d: D, ctx: Ctx, act: Record<string, string> = {}) =>
  solutionPlan(
    {
      mode: d.mode,
      comp: comp(d),
      M: d.M,
      V: d.V,
      sol: solute(d, ctx),
      c: d.c,
      u: d.u,
      sv: d.sv,
      ad: d.ad,
      act,
      meth: d.meth,
      rho: d.rho,
      prep: d.prep,
      stocks: d.stocks,
    },
    ctx.cl,
  );
const prep = (d: D) =>
  [
    d.stir ? `stir ${d.sm} min` : 'no stirring',
    d.heat ? `heat ${d.hT} °C for ${d.hm} min${d.cool ? ', cool down before use' : ', use warm'}` : 'no heating',
  ].join(' · ');
const solvents = (d: D) => d.sv.map((s) => `${s.n} ${s.p}`).join(' : ');
const headline = (d: D, ctx: Ctx) =>
  d.mode === 'Perovskite' ? plan(d, ctx).target : `${solute(d, ctx)} ${d.c} ${d.u}`;

const A_IONS = ['Cs', 'FA', 'MA'],
  X_IONS = ['I', 'Br', 'Cl'];
const sum = (s: Record<string, number>) => Object.values(s).reduce((a, v) => a + (v || 0), 0);

/** Subscript typed in place inside the formula. Keeps the text while typing ("0.", "0.0"). */
function SubIn({ v, on, label }: { v: number; on: (n: number) => void; label: string }) {
  const [txt, setTxt] = useState(String(v)),
    last = useRef(v);
  useEffect(() => {
    if (v !== last.current) {
      last.current = v;
      setTxt(String(v));
    }
  }, [v]);
  return (
    <input
      className="fx-sub"
      inputMode="decimal"
      aria-label={label}
      value={txt}
      style={{ width: `${Math.max(2.2, txt.length + 0.9)}ch` }}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        const t = e.target.value.replace(',', '.');
        setTxt(t);
        const n = parseFloat(t);
        if (isFinite(n)) {
          last.current = n;
          on(n);
        } else if (t === '') {
          last.current = 0;
          on(0);
        }
      }}
    />
  );
}

type CompD = Pick<D, 'A' | 'X' | 'dim' | 'L' | 'n' | 's'>;
const r2 = (v: number) => String(+v.toFixed(2));
/** Dimensionality by n (Ossila, What are 2D perovskites): 1 = 2D, below 5 quasi-2D, 5 and up often called quasi-3D. */
const dimName = (n: number) => (n <= 1.0001 ? 'pure 2D' : n < 5 ? 'quasi-2D' : 'quasi-3D');

/**
 * The perovskite formula itself is the editor: ion chips choose the sites, subscripts are typed into the formula.
 * Layered perovskites: (L)2A(n−1)PbnX(3n+1) (Ruddlesden–Popper) or (L)A(n−1)PbnX(3n+1) (Dion–Jacobson); n is the subscript of Pb.
 */
function Composition({ d, set }: { d: CompD; set: (p: Partial<CompD>) => void }) {
  const { A, X } = d;
  const toggle = (site: 'A' | 'X', k: string) => {
    const s = site === 'A' ? A : X,
      n = { ...s };
    if (k in n) {
      if (Object.keys(n).length > 1) delete n[k];
      else return;
    } else n[k] = 0;
    if (Object.keys(n).length === 1) n[Object.keys(n)[0]] = 1; // a single ion fills the site
    set({ [site]: n });
  };
  const a = A_IONS.filter((k) => k in A),
    x = X_IONS.filter((k) => k in X),
    sa = sum(A),
    sx = sum(X);
  const norm = (s: Record<string, number>) => {
    const t = sum(s) || 1;
    return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, +(v / t).toFixed(4)]));
  };
  const off = (v: number) => Math.abs(v - 1) > 0.0005;
  const two = d.dim !== '3D',
    n = Math.max(1, d.n || 1),
    sp = spacerOf(d),
    showA = true;
  // as written: spacer s, A-site a, Pb and halide amounts (the usual form has s = 2 for RP, 1 for DJ)
  const c2 = two ? comp(d) : null,
    m = c2 ? layeredAmounts(c2) : null;
  const aCount = m ? m.a : 1,
    xCount = m ? m.x : 3,
    rd = (v: number) => +v.toFixed(3);
  const Lz = c2?.L;
  const setS = (sNew: number) => {
    if (Lz && sNew > 0) set({ s: sNew, n: nFromAmounts(Lz, sNew, m!.a) });
  };
  const setA = (aNew: number) => {
    if (Lz && aNew >= 0) set({ n: nFromAmounts(Lz, m!.s, aNew) });
  };
  const setPb = (pb: number) => {
    if (m && pb > 0) set({ n: pb / m.k });
  };
  return (
    <>
      <div className="site-pick">
        <div>
          <span className="site-label">Structure</span>
          <Seg
            small
            value={d.dim}
            on={(dim) => set({ dim, L: spacers(dim)[0]?.ion ?? d.L, s: undefined })}
            opts={[
              ['3D', '3D'],
              ['RP', 'Ruddlesden–Popper'],
              ['DJ', 'Dion–Jacobson'],
            ]}
          />
        </div>
      </div>
      <div className="site-pick">
        {two && (
          <div>
            <span className="site-label">{`Spacer (${d.dim === 'DJ' ? 'divalent' : 'monovalent'})`}</span>
            <div className="chips spacer-chips">
              {spacers(d.dim).map((k) => (
                <button
                  key={k.ion}
                  title={k.name}
                  className={'chip' + (sp.ion === k.ion ? ' on' : '')}
                  aria-pressed={sp.ion === k.ion}
                  onClick={() => set({ L: k.ion })}
                >
                  {k.ion}
                </button>
              ))}
            </div>
          </div>
        )}
        {showA && (
          <div>
            <span className="site-label">A-site</span>
            <div className="chips">
              {A_IONS.map((k) => (
                <button
                  key={k}
                  className={'chip' + (k in A ? ' on' : '')}
                  aria-pressed={k in A}
                  onClick={() => toggle('A', k)}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>
        )}
        <div>
          <span className="site-label">X-site</span>
          <div className="chips">
            {X_IONS.map((k) => (
              <button
                key={k}
                className={'chip' + (k in X ? ' on' : '')}
                aria-pressed={k in X}
                onClick={() => toggle('X', k)}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="fx" role="group" aria-label="Perovskite formula: type the fraction of each ion in its subscript">
        {two && m && (
          <span className="fx-term">
            ({sp.ion})<SubIn v={rd(m.s)} label={`${sp.ion} amount (spacer)`} on={setS} />
          </span>
        )}
        {showA &&
          (a.length > 1 || two ? (
            <span className={'fx-term' + (two && aCount < 1e-9 ? ' fx-zero' : '')}>
              {a.length > 1 || a[0].length > 1 ? '(' : ''}
              {a.map((k) => (
                <span key={k} className="fx-term">
                  {k}
                  {a.length > 1 && (
                    <SubIn v={A[k]} label={`${k} fraction on the A-site`} on={(v) => set({ A: { ...A, [k]: v } })} />
                  )}
                </span>
              ))}
              {a.length > 1 || a[0].length > 1 ? ')' : ''}
              {two && <SubIn v={rd(aCount)} label="A-cation amount" on={setA} />}
            </span>
          ) : (
            <span className="fx-term">{a[0]}</span>
          ))}
        <span className="fx-term">Pb{two && m && <SubIn v={rd(m.pb)} label="n, Pb amount" on={setPb} />}</span>
        {x.length > 1 ? (
          <span className="fx-term">
            (
            <>
              {x.map((k) => (
                <span key={k} className="fx-term">
                  {k}
                  <SubIn v={X[k]} label={`${k} fraction on the X-site`} on={(v) => set({ X: { ...X, [k]: v } })} />
                </span>
              ))}
            </>
            )<sub className="fx-fixed">{r2(xCount)}</sub>
          </span>
        ) : (
          <span className="fx-term">
            {x[0]}
            <sub className="fx-fixed">{r2(xCount)}</sub>
          </span>
        )}
      </div>
      {two && m && (
        <p className="small mut">
          {d.dim === 'RP'
            ? 'Ruddlesden–Popper (L)₂Aₙ₋₁PbₙX₃ₙ₊₁: two monovalent spacers per layer.'
            : 'Dion–Jacobson (L)Aₙ₋₁PbₙX₃ₙ₊₁: one divalent spacer per layer.'}{' '}
          Type the {sp.ion} and A-cation amounts (or Pb): their ratio sets n, and Pb and the halide follow.{' '}
          <b>n = {r2(n)}</b>, {dimName(n)} · {sp.ion} : A = {r2(m.s)} : {r2(m.a)} ({r2((100 * m.s) / (m.s + m.a || 1))}{' '}
          % {sp.ion} among the organic cations). Per Pb:{' '}
          {d.dim === 'RP' ? `${r2(2 / n)} ${sp.ion}X` : `${r2(1 / n)} ${sp.ion}X₂`}, {r2((n - 1) / n)} AX, 1 PbX₂.
          {Math.abs(m.s - m.s0) > 1e-9 && (
            <>
              {' '}
              <button className="link" onClick={() => set({ s: undefined })}>
                Write with {m.s0} {sp.ion}
              </button>
            </>
          )}
        </p>
      )}
      {two && n >= 5 && (
        <p className="small warn-text">
          Quasi-2D films with larger n can split into lower-n phases (for example n = 5 into n = 2 and 3) in humid air.
        </p>
      )}
      {two && x.length > 1 && (
        <p className="small warn-text">
          Mixed-halide 2D perovskites can undergo halide degradation; 2D bromides are reported to be less stable than
          MAPbBr₃, 2D iodides more stable than MAPbI₃.
        </p>
      )}
      {((showA && a.length > 1) || x.length > 1) && (
        <div className="fx-sums">
          {showA && a.length > 1 && (
            <span className={off(sa) ? 'warn-text' : 'ok'}>
              A-site {+sa.toFixed(4)}
              {off(sa) ? (
                <>
                  {' '}
                  · scaled to 1 in the calculation{' '}
                  <button className="link" onClick={() => set({ A: norm(A) })}>
                    Make it 1
                  </button>
                </>
              ) : (
                ' ✓'
              )}
            </span>
          )}
          {x.length > 1 && (
            <span className={off(sx) ? 'warn-text' : 'ok'}>
              X-site {+sx.toFixed(4)}
              {off(sx) ? (
                <>
                  {' '}
                  · scaled to 1 in the calculation{' '}
                  <button className="link" onClick={() => set({ X: norm(X) })}>
                    Make it 1
                  </button>
                </>
              ) : (
                ' ✓'
              )}
            </span>
          )}
        </div>
      )}
    </>
  );
}

/** Separate stock solutions: concentration and volume to prepare per salt (empty = automatic). */
function StockEditor({ d, set, ctx }: { d: D; set: (p: Partial<D>) => void; ctx: Ctx }) {
  const r = plan(d, ctx),
    list = r.stocks?.list ?? [];
  const up = (salt: string, p: { c?: number; v?: number }) =>
    set({ stocks: { ...d.stocks, [salt]: { ...d.stocks[salt], ...p } } });
  const field = (val: number | undefined, auto: number, on: (v: number | undefined) => void, label: string) => (
    <input
      inputMode="decimal"
      aria-label={label}
      placeholder={`auto ${+auto.toPrecision(3)}`}
      value={val ?? ''}
      style={{ width: 96, textAlign: 'right' }}
      onChange={(e) => {
        const t = e.target.value.replace(',', '.'),
          v = parseFloat(t);
        on(t === '' || !isFinite(v) ? undefined : v);
      }}
    />
  );
  return (
    <>
      <table className="tight">
        <thead>
          <tr>
            <th>Salt</th>
            <th>Stock (mol/L)</th>
            <th>Prepare (mL)</th>
          </tr>
        </thead>
        <tbody>
          {list.map((x) => (
            <tr key={x.s}>
              <td>{x.s}</td>
              <td>{field(d.stocks[x.s]?.c, x.c, (c) => up(x.s, { c }), `${x.s} stock concentration`)}</td>
              <td>{field(d.stocks[x.s]?.v, x.need / 1000, (v) => up(x.s, { v }), `${x.s} stock volume to prepare`)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small mut">
        Each salt is dissolved on its own in the solvent mixture below, then the stocks are mixed and topped up with
        solvent to {d.V} mL. Empty fields: all stocks at {r2(d.M * r.rows.reduce((t, x) => t + x.mol, 0))} M (they then
        add up to the final volume) and just the volume needed.
      </p>
      {r.stocks?.over && (
        <p className="err small">The stocks add up to more than {d.V} mL: use more concentrated stocks.</p>
      )}
      {list.some((x) => x.short) && (
        <p className="err small">Some stocks are prepared in less volume than is needed for the mix.</p>
      )}
    </>
  );
}

function Editor({ d, set, ctx }: { d: D; set: (p: Partial<D>) => void; ctx: Ctx }) {
  const names = (...r: string[]) => ctx.chems.filter((c) => r.includes(c.role)).map((c) => c.name);
  const sol = solute(d, ctx),
    list = solutes(d, ctx);
  const upAd = (i: number, p: Partial<Additive>) => set({ ad: d.ad.map((a, j) => (j === i ? { ...a, ...p } : a)) });
  const upSv = (i: number, p: Partial<{ n: string; p: number }>) =>
    set({ sv: d.sv.map((a, j) => (j === i ? { ...a, ...p } : a)) });
  const spiro = () =>
    set({
      mode: 'HTL',
      sol: 'Spiro-OMeTAD',
      c: 72.3,
      u: 'mg/mL',
      V: 1,
      sv: [{ n: 'CB', p: 1 }],
      ad: [
        { n: 'LiTFSI', b: 'µL stock/mL', v: 17.5, sc: 520 },
        { n: 'tBP', b: 'µL/mL', v: 28.8 },
        { n: 'FK209', b: 'µL stock/mL', v: 29, sc: 300 },
      ],
      stir: true,
      sm: 30,
      heat: false,
      cool: false,
    });
  const rSv = useReorder(d.sv, (sv) => set({ sv }), 'solvent'),
    rAd = useReorder(d.ad, (ad) => set({ ad }), 'additive');
  // perovskite: the additives right after how the precursor solution is prepared; other solutions: after the solvents
  const additives = (
    <>
      <Section title="Additives">
        {d.ad.map((a, i) => (
          <div className={'row wrap' + (rAd.drag === i ? ' dragging' : '')} key={i} ref={rAd.rowRef(i)}>
            <span className="inline">
              <DragHandle h={rAd.handle(i)} show={d.ad.length > 1} />
              <select value={a.n} onChange={(e) => upAd(i, { n: e.target.value })}>
                {ctx.chems.map((c) => (
                  <option key={c.id}>{c.name}</option>
                ))}
              </select>
            </span>
            <span className="inline">
              <Num v={a.v} on={(v) => upAd(i, { v })} />
              <select value={a.b} onChange={(e) => upAd(i, { b: e.target.value as Basis })}>
                {BASES.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
              {a.b === 'µL stock/mL' && (
                <>
                  <Num v={a.sc ?? 0} on={(sc) => upAd(i, { sc })} /> mg/mL stock
                </>
              )}
              <RemoveRow
                label={`Remove additive ${i + 1}`}
                onClick={() => set({ ad: d.ad.filter((_, j) => j !== i) })}
              />
            </span>
          </div>
        ))}
        <button
          className="link add"
          onClick={() => set({ ad: [...d.ad, { n: names('additive')[0] ?? 'MACl', b: 'mol%', v: 0 }] })}
        >
          Add additive
        </button>
      </Section>
    </>
  );
  return (
    <>
      <Section title="Type">
        <div className="chips">
          {(['Perovskite', 'ETL', 'HTL', 'Custom'] as Mode[]).map((m) => (
            <button key={m} className={'chip' + (d.mode === m ? ' on' : '')} onClick={() => set({ mode: m, sol: '' })}>
              {m}
            </button>
          ))}
        </div>
      </Section>
      {d.mode === 'Perovskite' ? (
        <>
          <Section title="Composition">
            <Composition d={d} set={set} />
          </Section>
          <Section title="Preparation of the precursor solution">
            <Seg
              small
              value={d.prep}
              on={(prep) => set({ prep })}
              opts={[
                ['one', 'All in one vial'],
                ['stocks', 'Separate stock solutions'],
              ]}
            />
            <p className="small mut">
              {d.prep === 'stocks'
                ? 'One stock solution per precursor salt, mixed by volume.'
                : 'All salts weighed into one vial and dissolved together.'}
            </p>
          </Section>
          {additives}
          <Section title="Concentration">
            {d.prep === 'one' && (
              <Seg
                small
                value={d.meth}
                on={(meth) => set({ meth })}
                opts={[
                  ['solvent', 'Volume of solvent'],
                  ['density', 'Density method'],
                ]}
              />
            )}
            {d.prep === 'one' && (
              <p className="small mut">
                {d.meth === 'density'
                  ? 'The volume is the final solution. The dissolved perovskite takes up its mass ÷ density, so less solvent is added.'
                  : 'The salts are dissolved in this volume of solvent (molarity per litre of solvent).'}
              </p>
            )}
            {d.prep === 'one' ? (
              <>
                <label className="row">
                  <span>Molarity (mol Pb / L of {d.meth === 'density' ? 'solution' : 'solvent'})</span>
                  <Num v={d.M} on={(M) => set({ M })} />
                </label>
                <label className="row">
                  <span>{d.meth === 'density' ? 'Final volume (mL)' : 'Solvent volume (mL)'}</span>
                  <Num v={d.V} on={(V) => set({ V })} />
                </label>
              </>
            ) : (
              <>
                <label className="row">
                  <span>Molarity of the mixed solution (mol Pb / L)</span>
                  <Num v={d.M} on={(M) => set({ M })} />
                </label>
                <label className="row">
                  <span>Final volume (mL)</span>
                  <Num v={d.V} on={(V) => set({ V })} />
                </label>
                <StockEditor d={d} set={set} ctx={ctx} />
              </>
            )}
            {d.prep === 'one' && d.meth === 'density' && (
              <label className="row">
                <span>
                  Perovskite density (g/cm³)
                  <br />
                  <small className="mut">lead-iodide perovskites ≈ 4.1–4.2</small>
                </span>
                <Num v={d.rho} on={(rho) => set({ rho })} />
              </label>
            )}
          </Section>
        </>
      ) : (
        <Section title="Solute">
          <select value={sol} onChange={(e) => set({ sol: e.target.value })}>
            {list.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
          <div className="row">
            <span>Concentration</span>
            <span className="inline">
              <Num v={d.c} on={(c) => set({ c })} />
              <select value={d.u} onChange={(e) => set({ u: e.target.value as D['u'] })}>
                <option>mg/mL</option>
                <option>mM</option>
              </select>
            </span>
          </div>
          <label className="row">
            <span>Volume (mL)</span>
            <Num v={d.V} on={(V) => set({ V })} />
          </label>
          {d.mode === 'HTL' && sol === 'Spiro-OMeTAD' && (
            <button className="link" onClick={spiro}>
              Load typical doped spiro-OMeTAD recipe
            </button>
          )}
        </Section>
      )}
      <Section title="Solvents (volume parts)">
        {d.sv.map((v, i) => (
          <div className={'row' + (rSv.drag === i ? ' dragging' : '')} key={i} ref={rSv.rowRef(i)}>
            <span className="inline">
              <DragHandle h={rSv.handle(i)} show={d.sv.length > 1} />
              <select value={v.n} onChange={(e) => upSv(i, { n: e.target.value })}>
                {names('solvent').map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </span>
            <span className="inline">
              <Num v={v.p} on={(p) => upSv(i, { p })} />
              <RemoveRow
                label={`Remove solvent ${i + 1}`}
                onClick={() => set({ sv: d.sv.filter((_, j) => j !== i) })}
              />
            </span>
          </div>
        ))}
        <button className="link add" onClick={() => set({ sv: [...d.sv, { n: names('solvent')[0] ?? 'DMF', p: 1 }] })}>
          Add solvent
        </button>
      </Section>
      {d.mode !== 'Perovskite' && additives}
      <Section title="Preparation">
        <label className="inline">
          <Check v={d.stir} on={(stir) => set({ stir })} /> Stirring{' '}
          {d.stir && (
            <>
              <Num v={d.sm} on={(sm) => set({ sm })} w={72} /> min
            </>
          )}
        </label>
        <label className="inline">
          <Check v={d.heat} on={(heat) => set({ heat })} /> Heating{' '}
          {d.heat && (
            <>
              <Num v={d.hT} on={(hT) => set({ hT })} w={72} /> °C for <Num v={d.hm} on={(hm) => set({ hm })} w={72} />{' '}
              min
            </>
          )}
        </label>
        {d.heat && (
          <label className="inline">
            <Check v={d.cool} on={(cool) => set({ cool })} /> Wait until cooled before use
          </label>
        )}
      </Section>
    </>
  );
}

function Output({ d, ctx, blanks }: { d: D; ctx: Ctx; blanks?: boolean }) {
  const r = plan(d, ctx);
  const rows = [
    ...r.rows.map((a) => [
      <>
        {a.s}
        {!a.ok && <span className="err"> · not in chemical table</span>}
        {a.bundled.length > 0 && <small className="mut"> (+{a.bundled.join(', ')} additive)</small>}
      </>,
      a.mmol.toFixed(3),
      <>
        {a.mg.toFixed(2)} mg{a.mg < 1 && <span className="err"> · under 1 mg</span>}
      </>,
    ]),
    ...r.extra.map((a) => [
      <>
        {a.n}{' '}
        <small className="mut">
          (additive, {a.v} {a.b}
          {a.b === 'µL stock/mL' ? `, stock ${a.sc ?? 0} mg/mL` : ''})
        </small>
      </>,
      a.ul ? '' : a.mmol.toFixed(3),
      a.ul ? `${a.ul.toFixed(1)} µL${a.stockMg ? ` (${a.stockMg.toFixed(2)} mg)` : ''}` : `${a.m.toFixed(2)} mg`,
    ]),
  ];
  const t = withBlank(blanks, ['Compound', `mmol in ${d.V} mL`, 'Amount'], rows, 'Weighed', [
    ...r.rows.map((a) => 'w:' + a.s),
    ...r.extra.map((a) => 'w:add:' + a.n),
  ]);
  const st = r.stocks;
  if (st) {
    // separate stock solutions, then the mix
    const ratio = solvents(d).replace(/ /g, ' ');
    const sRows = st.list.map((x) => {
      const row = r.rows.find((y) => y.s === x.s)!;
      return [
        <>
          {x.s}
          {!row.ok && <span className="err"> · not in chemical table</span>}
        </>,
        `${r2(x.c)} M`,
        `${+x.make.toFixed(3)} mL`,
        <>
          {x.mg.toFixed(2)} mg{x.mg < 1 && <span className="err"> · under 1 mg</span>}
        </>,
      ];
    });
    const s1 = withBlank(
      blanks,
      ['Stock solution', 'Concentration', `Prepare (${ratio})`, 'Weigh'],
      sRows,
      'Weighed',
      st.list.map((x) => 'w:' + x.s),
    );
    const mRows = [
      ...st.list.map((x) => [
        <>
          {x.s} stock{x.short && <span className="err"> · prepare more</span>}
        </>,
        r.rows.find((y) => y.s === x.s)!.mmol.toFixed(3),
        `${x.need.toFixed(1)} µL`,
      ]),
      ...r.solv
        .filter((v) => v.ul > 0.05)
        .map((v) => [
          <>
            {v.n} <small className="mut">(to make up {d.V} mL)</small>
          </>,
          '',
          `${v.ul.toFixed(1)} µL`,
        ]),
      ...r.extra.map((a) => [
        <>
          {a.n}{' '}
          <small className="mut">
            (additive, {a.v} {a.b}
            {a.b === 'µL stock/mL' ? `, stock ${a.sc ?? 0} mg/mL` : ''})
          </small>
        </>,
        a.ul ? '' : a.mmol.toFixed(3),
        a.ul ? `${a.ul.toFixed(1)} µL${a.stockMg ? ` (${a.stockMg.toFixed(2)} mg)` : ''}` : `${a.m.toFixed(2)} mg`,
      ]),
    ];
    const s2 = withBlank(blanks, ['Into the final vial', `mmol in ${d.V} mL`, 'Amount'], mRows, 'Added', [
      ...st.list.map((x) => 'v:stock:' + x.s),
      ...r.solv.filter((v) => v.ul > 0.05).map((v) => 'v:' + v.n),
      ...r.extra.map((a) => 'w:add:' + a.n),
    ]);
    return (
      <>
        <p className="headline">
          <Formula f={headline(d, ctx)} />{' '}
          <span className="mut">
            · {d.M} M · {d.V} mL · separate stock solutions
          </span>
        </p>
        {r.ct.length > 0 && (
          <T
            h={['Ion', 'Total / Pb', 'From salts']}
            rows={r.ct.map((c) => [
              c.ion,
              c.total.toFixed(3),
              c.from.map((f) => `${f[0]} ${f[1].toFixed(3)}`).join(' + '),
            ])}
          />
        )}
        <h4 className="out-sub">1 · Stock solutions</h4>
        <T h={s1.h} rows={s1.rows} />
        <h4 className="out-sub">2 · Mix</h4>
        <T h={s2.h} rows={s2.rows} />
        {st.over && (
          <p className="err">
            The stocks add up to {st.stockUl.toFixed(0)} µL, more than {d.V} mL: use more concentrated stocks.
          </p>
        )}
        <p className="mut">Preparation: {prep(d)} (the mixed solution)</p>
      </>
    );
  }
  return (
    <>
      <p className="headline">
        {d.mode === 'Perovskite' ? <Formula f={headline(d, ctx)} /> : headline(d, ctx)}{' '}
        <span className="mut">
          · {d.mode === 'Perovskite' ? `${d.M} M · ` : ''}
          {d.V} mL
        </span>
      </p>
      {r.ct.length > 0 && (
        <T
          h={['Ion', 'Total / Pb', 'From salts']}
          rows={r.ct.map((c) => [
            c.ion,
            c.total.toFixed(3),
            c.from.map((f) => `${f[0]} ${f[1].toFixed(3)}`).join(' + '),
          ])}
        />
      )}
      <T h={t.h} rows={t.rows} />
      <T h={['Solvent', 'Volume (µL)']} rows={r.solv.map((v) => [v.n, v.ul.toFixed(0)])} />
      {r.density && (
        <p className="mut">
          Density method: {(r.density.solidMg / 1000).toFixed(3)} g of solids at {r.density.rho} g/cm³ take up{' '}
          {r.density.solidUl.toFixed(0)} µL{r.extra.some((a) => a.ul) ? ', liquid additives are counted too' : ''}; add{' '}
          {r.density.solventUl.toFixed(0)} µL of solvent for {d.V} mL of solution.
        </p>
      )}
      <p className="mut">Preparation: {prep(d)}</p>
    </>
  );
}

const COLORS: Record<Mode, string> = { Perovskite: '#e8c547', HTL: '#e3a64a', ETL: '#9c7b5b', Custom: '#8fb8e8' };
function Visual({ d }: { d: D; ctx: Ctx }) {
  const level = Math.max(0.12, Math.min(d.V / 4, 1)),
    top = 30 + (1 - level) * 66; // 4 mL vial
  return (
    <svg viewBox="0 0 80 110" width="64" height="88" aria-hidden>
      <rect x="27" y="4" width="26" height="14" rx="3" fill="var(--fg)" opacity=".75" />
      <path d={`M24 ${top} H56 V96 a8 8 0 0 1 -8 8 H32 a8 8 0 0 1 -8 -8 Z`} fill={COLORS[d.mode]} opacity=".85" />
      <path d="M24 18 H56 V96 a8 8 0 0 1 -8 8 H32 a8 8 0 0 1 -8 -8 Z" fill="none" stroke="var(--mut)" strokeWidth="2" />
      <rect x="30" y="24" width="4" height="60" rx="2" fill="#fff" opacity=".35" />
    </svg>
  );
}

export const solution: Kind<D> = {
  segment: 's1',
  title: 'Solutions',
  noun: 'solution',
  defaults,
  Editor,
  Output,
  Visual,
  // planned amounts: salts (or the stock solutions as prepared), additives and solvents
  uses: (d, ctx) => {
    const r = plan(d, ctx),
      out: { name: string; mg?: number; ul?: number }[] = [];
    if (r.stocks) for (const x of r.stocks.list) out.push({ name: x.s, mg: x.mg });
    else for (const x of r.rows) out.push({ name: x.s, mg: x.mg });
    for (const a of r.extra)
      out.push(
        a.b === 'µL stock/mL' ? { name: a.n, mg: a.stockMg } : a.ul ? { name: a.n, ul: a.ul } : { name: a.n, mg: a.m },
      );
    const stockUl = r.stocks ? r.stocks.list.reduce((t, x) => t + x.make * 1000, 0) : 0,
      sp = d.sv.reduce((t, x) => t + x.p, 0) || 1;
    for (const v of r.solv)
      out.push({ name: v.n, ul: v.ul + (stockUl * (d.sv.find((x) => x.n === v.n)?.p ?? 0)) / sp });
    return out.filter((u) => u.name && ((u.mg ?? 0) > 0 || (u.ul ?? 0) > 0));
  },
  summary: (d, ctx) => `${headline(d, ctx)} · ${d.mode === 'Perovskite' ? d.M + ' M · ' : ''}${d.V} mL`,
  describe: (d, ctx) => ({
    Type: d.mode,
    [d.mode === 'Perovskite' ? 'Formula' : 'Solute']: headline(d, ctx),
    ...(d.mode === 'Perovskite'
      ? {
          Structure:
            d.dim === '3D'
              ? '3D'
              : `${d.dim === 'RP' ? 'Ruddlesden–Popper' : 'Dion–Jacobson'} layered, ${spacerOf(d).ion}, n = ${d.n} (${dimName(Math.max(1, d.n || 1))})`,
          Molarity: `${d.M} M`,
          Method:
            d.prep === 'stocks'
              ? 'separate stock solutions, mixed'
              : d.meth === 'density'
                ? `density method (${d.rho} g/cm³), final volume`
                : 'volume of solvent',
        }
      : {}),
    Volume: `${d.V} mL`,
    Solvents: solvents(d),
    Additives: d.ad.length ? d.ad.map((a) => `${a.n} ${a.v} ${a.b}`).join(', ') : 'none',
    Preparation: prep(d),
  }),
  runFields: (d, ctx) => {
    const r = plan(d, ctx);
    if (r.stocks)
      return [
        ...r.stocks.list.map((x) => ({
          key: 'w:' + x.s,
          label: `${x.s} weighed for the ${r2(x.c)} M stock (${+x.make.toFixed(3)} mL)`,
          expected: `${fix(x.mg)} mg`,
          unit: 'mg',
        })),
        ...r.stocks.list.map((x) => ({
          key: 'v:stock:' + x.s,
          label: `${x.s} stock added`,
          expected: `${fix(x.need, 1)} µL`,
          unit: 'µL',
        })),
        ...r.solv
          .filter((v) => v.ul > 0.05)
          .map((v) => ({
            key: 'v:' + v.n,
            label: `${v.n} to make up the volume`,
            expected: `${fix(v.ul, 1)} µL`,
            unit: 'µL',
          })),
        ...r.extra.map((a) => ({
          key: 'w:add:' + a.n,
          label: `${a.n} added`,
          expected: a.ul ? `${fix(a.ul, 1)} µL` : `${fix(a.m)} mg`,
          unit: a.ul ? 'µL' : 'mg',
        })),
        ...(d.heat ? [{ key: 'heat', label: 'Heating', expected: `${d.hT} °C, ${d.hm} min` }] : []),
      ];
    return [
      ...r.rows.map((a) => ({ key: 'w:' + a.s, label: `${a.s} weighed`, expected: `${fix(a.mg)} mg`, unit: 'mg' })),
      ...r.extra.map((a) => ({
        key: 'w:add:' + a.n,
        label: `${a.n} added`,
        expected: a.ul ? `${fix(a.ul, 1)} µL` : `${fix(a.m)} mg`,
        unit: a.ul ? 'µL' : 'mg',
      })),
      ...r.solv.map((v) => ({ key: 'v:' + v.n, label: `${v.n} volume`, expected: `${fix(v.ul, 0)} µL`, unit: 'µL' })),
      ...(d.heat ? [{ key: 'heat', label: 'Heating', expected: `${d.hT} °C, ${d.hm} min` }] : []),
    ];
  },
  runResult: (d, values, ctx) => {
    if (d.mode !== 'Perovskite') return null;
    const act = Object.fromEntries(
      Object.entries(values)
        .filter(([k, v]) => k.startsWith('w:') && !k.startsWith('w:add:') && v !== '')
        .map(([k, v]) => [k.slice(2), v]),
    );
    if (!Object.keys(act).length) return null;
    const r = plan(d, ctx, act);
    return (
      <p>
        From the weighed masses:{' '}
        <b>
          <Formula f={r.actual} />
        </b>{' '}
        · {r.actualM.toFixed(3)} M
      </p>
    );
  },
};
