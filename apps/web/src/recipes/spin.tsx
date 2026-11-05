import { useEffect, useRef, useState } from 'react';
import { spinPlan, type Dispense, type SpinStep } from '@psc/core';
import { Check, Num } from '../views/common';
import { Section, T } from './shared';
import type { Ctx, Kind } from './types';

const st = (t: number, rpm: number, final = false): SpinStep => ({ t, rpm, n2: false, final });
const defaults = () => ({ steps: [st(1, 1000), st(9, 1000), st(1, 5000), st(39, 5000, true)], dp: [] as Dispense[], an: true, aT: 100, aM: 10, ox: false, oa: 'dry air', oh: 12, N: 4, ov: 20 });
type D = ReturnType<typeof defaults>;
const maxRpm = (d: D) => Math.max(0, ...d.steps.map((s) => s.rpm));


const nice = (v: number) => { const p = 10 ** Math.floor(Math.log10(v || 1)), m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; };

/** rpm over time for the editor: ramps (step time = time to reach the rpm), N2 steps shaded, dispenses marked, final step labelled. */
function SpinChart({ d }: { d: D }) {
  // drawn at the real width, so labels keep their size on a phone
  const box = useRef<HTMLElement>(null), [W, setW] = useState(560);
  useEffect(() => { const el = box.current; if (!el) return; const ro = new ResizeObserver(() => setW(Math.max(260, el.clientWidth))); ro.observe(el); return () => ro.disconnect(); }, []);
  const total = d.steps.reduce((a, s) => a + s.t, 0), yStep = nice((maxRpm(d) || 1000) / (W < 400 ? 3 : 5)), top = Math.ceil(((maxRpm(d) || 1000) * 1.12) / yStep) * yStep;
  const nDrops = d.dp.filter((x) => x.src).length, T = nDrops ? 14 + 14 * Math.min(nDrops, 2) : 12;
  const H = W < 400 ? 190 : 200, L = 38, B = 24, Rr = 8, w = W - L - Rr, h = H - T - B;
  if (!total) return <figure className="spin-chart" ref={box}><p className="mut small">Add a step with a time to see the spin curve.</p></figure>;
  const X = (t: number) => L + (t / total) * w, Y = (r: number) => T + h - (r / top) * h;
  let t = 0, prev = 0;
  const pts = [`${X(0)},${Y(0)}`], segs: { t0: number; t1: number; rpm: number; n2: boolean; final: boolean }[] = [];
  for (const s of d.steps) { segs.push({ t0: t, t1: t + s.t, rpm: s.rpm, n2: s.n2, final: s.final }); t += s.t; prev = s.rpm; pts.push(`${X(t)},${Y(prev)}`); }
  const xStep = nice(total / (W < 400 ? 4 : 6));
  const xt = Array.from({ length: Math.floor(total / xStep) + 1 }, (_, i) => i * xStep), yt = Array.from({ length: Math.floor(top / yStep) + 1 }, (_, i) => i * yStep);
  const marks = d.dp.filter((x) => x.src).map((x) => ({ t: x.when === 'before' ? 0 : Math.max(0, Math.min(total, total - x.at)), v: x.v, src: x.src.replace(/^(Preset|Solvent): /, ''), before: x.when === 'before' }));
  // one label per speed level: centred on the hold when there is one, else at the end of the ramp
  const plateaus: { x: number; rpm: number; final: boolean; anchor: 'middle' | 'end' }[] = [];
  for (let i = 0; i < segs.length;) {
    let j = i; while (j + 1 < segs.length && segs[j + 1].rpm === segs[i].rpm) j++;
    const g = segs.slice(i, j + 1), hold0 = g.length > 1 ? g[0].t1 : g[0].t0, held = g.length > 1 || (i > 0 && segs[i - 1].rpm === g[0].rpm);
    if (g[0].rpm > 0) plateaus.push({ x: held ? (X(hold0) + X(g[g.length - 1].t1)) / 2 : X(g[0].t1), rpm: g[0].rpm, final: g.some((x) => x.final), anchor: held ? 'middle' : 'end' });
    i = j + 1;
  }
  return (
    <figure className="spin-chart" ref={box}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`Spin curve: ${d.steps.map((s) => `${s.t} s to ${s.rpm} rpm`).join(', ')}`}>
        {segs.filter((sg) => sg.n2).map((sg, i) => <rect key={'n' + i} x={X(sg.t0)} y={T} width={X(sg.t1) - X(sg.t0)} height={h} className="sc-n2" />)}
        {yt.map((v) => <g key={'y' + v}><line x1={L} x2={W - Rr} y1={Y(v)} y2={Y(v)} className="sc-grid" /><text x={L - 6} y={Y(v)} className="sc-tick" textAnchor="end" dominantBaseline="middle">{v >= 1000 ? `${v / 1000}k` : v}</text></g>)}
        {xt.map((v) => <text key={'x' + v} x={X(v)} y={H - 8} className="sc-tick" textAnchor="middle">{v} s</text>)}
        <polygon points={`${pts.join(' ')} ${X(total)},${Y(0)}`} className="sc-area" />
        <polyline points={pts.join(' ')} className="sc-line" />
        {plateaus.map((p, i) => <text key={'p' + i} x={p.x} y={Y(p.rpm) - 7} className="sc-val" textAnchor={p.anchor}>{p.rpm} rpm{p.final ? ' · final' : ''}</text>)}
        {marks.map((m, i) => (
          <g key={'m' + i} className="sc-drop">
            <line x1={X(m.t)} x2={X(m.t)} y1={6 + (i % 2) * 14} y2={T + h} />
            <path d={`M${X(m.t)} ${T + h - 13} c-4 5 -5 7 -5 9 a5 5 0 0 0 10 0 c0 -2 -1 -4 -5 -9z`} />
            <text x={X(m.t) + (m.t > total * 0.6 ? -6 : 6)} y={12 + (i % 2) * 14} textAnchor={m.t > total * 0.6 ? 'end' : 'start'}>{m.v} µL {m.src}{m.before ? ' (before)' : ''}</text>
          </g>
        ))}
      </svg>
      <figcaption className="legend">
        <span><i className="sc-key-line" />rpm</span>{marks.length > 0 && <span><i className="sc-key-drop" />dispense</span>}{segs.some((sg) => sg.n2) && <span><i className="sc-key-n2" />N₂ on</span>}
        <span className="mut">total {total} s</span>
      </figcaption>
    </figure>
  );
}

function Editor({ d, set, ctx }: { d: D; set: (p: Partial<D>) => void; ctx: Ctx }) {
  const src = ['', ...ctx.solutions.map((n) => 'Preset: ' + n), ...ctx.chems.filter((c) => c.role === 'solvent').map((c) => 'Solvent: ' + c.name)];
  const upS = (i: number, p: Partial<SpinStep>) => set({ steps: d.steps.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const upD = (i: number, p: Partial<Dispense>) => set({ dp: d.dp.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  return (
    <>
      <Section title="Spin steps">
        <SpinChart d={d} />
        <p className="mut small">Step time is the time the spinner takes to reach the rpm.</p>
        <table className="tight"><thead><tr><th>#</th><th>Time (s)</th><th>rpm</th><th>N2</th><th>Final</th><th /></tr></thead>
          <tbody>{d.steps.map((x, i) => <tr key={i}><td>{i + 1}</td><td><Num v={x.t} on={(t) => upS(i, { t })} /></td><td><Num v={x.rpm} on={(rpm) => upS(i, { rpm })} /></td>
            <td><Check v={x.n2} on={(n2) => upS(i, { n2 })} /></td><td><Check v={x.final} on={(final) => upS(i, { final })} /></td>
            <td><button className="iconbtn rm" aria-label={`Remove step ${i + 1}`} title="Remove" onClick={() => set({ steps: d.steps.filter((_, j) => j !== i) })}>✕</button></td></tr>)}</tbody></table>
        <button className="link add" onClick={() => set({ steps: [...d.steps, st(1, 1000)] })}>Add step</button>
      </Section>
      <Section title="Dispenses">
        {d.dp.map((x, i) => (
          <div className="disp" key={i}>
            <select value={x.src} onChange={(e) => upD(i, { src: e.target.value })}>{src.map((o) => <option key={o} value={o}>{o || 'Choose solution or solvent…'}</option>)}</select>
            <div className="inline">
              <Num v={x.v} on={(v) => upD(i, { v })} w={80} /> µL
              <label className="inline"><Check v={x.filter} on={(filter) => upD(i, { filter })} /> 0.22 µm filter</label>
              <select value={x.when} onChange={(e) => upD(i, { when: e.target.value as Dispense['when'] })}><option value="before">Before spin</option><option value="remaining">At remaining time</option></select>
              {x.when === 'remaining' && <><Num v={x.at} on={(at) => upD(i, { at })} w={72} /> s remaining</>}
              <div className="grow" /><button className="link" onClick={() => set({ dp: d.dp.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          </div>
        ))}
        <button className="link add" onClick={() => set({ dp: [...d.dp, { src: '', v: 50, filter: false, when: 'remaining', at: 10 }] })}>Add dispense</button>
      </Section>
      <Section title="After coating">
        <label className="inline"><Check v={d.an} on={(an) => set({ an })} /> Needs annealing? {d.an && <><Num v={d.aT} on={(aT) => set({ aT })} w={72} /> °C · <Num v={d.aM} on={(aM) => set({ aM })} w={72} /> min</>}</label>
        <label className="inline"><Check v={d.ox} on={(ox) => set({ ox })} /> Needs post-coating oxidation / activation? <span className="mut small">(e.g. doped spiro-OMeTAD)</span></label>
        {d.ox && <div className="inline"><input value={d.oa} onChange={(e) => set({ oa: e.target.value })} /> <Num v={d.oh} on={(oh) => set({ oh })} w={72} /> h</div>}
      </Section>
      <Section title="Amount">
        <div className="inline">Substrates <Num v={d.N} on={(N) => set({ N })} w={72} /> overage <Num v={d.ov} on={(ov) => set({ ov })} w={72} /> %</div>
      </Section>
    </>
  );
}

function Output({ d }: { d: D; ctx: Ctx; blanks?: boolean }) {
  const r = spinPlan(d.steps, d.dp, d.N, d.ov);
  return (
    <>
      <p className="headline">{r.total} s <span className="mut">· {d.steps.length} steps · up to {maxRpm(d)} rpm</span></p>
      {!r.finalOk && <p className="err">Flag exactly one final step.</p>}
      <T h={['#', 'Time', 'rpm', 'N2', '', 'Remaining (s)']} rows={r.rows.map((x, i) => [i + 1, `${x.t} s`, x.rpm, x.n2 ? 'on' : 'off', x.final ? 'final' : '', `${x.from} → ${x.to}`])} />
      {r.events.length > 0 && <ol>{r.events.map((e, i) => <li key={i}>{e.when === 'before' ? 'Before spin' : `At ${e.at} s remaining`}: {e.v} µL {e.src.replace(/^(Preset|Solvent): /, '')}{e.filter ? ', 0.22 µm filtered' : ''}{e.over && <span className="err"> · exceeds total time</span>}</li>)}</ol>}
      {Object.keys(r.vol).length > 0 && <p>Volume needed for {d.N} substrates (+{d.ov} %): {Object.entries(r.vol).map(([k, v]) => `${k.replace(/^(Preset|Solvent): /, '')} ${v.toFixed(2)} mL`).join(' · ')}</p>}
      {d.an && <p>Annealing: <b>{d.aT} °C, {d.aM} min</b></p>}
      {d.ox && <p>Post-coating activation: <b>{d.oa}, {d.oh} h</b></p>}
    </>
  );
}

/** rpm profile over time with dispense markers. */
function Visual({ d }: { d: D; ctx: Ctx }) {
  const total = d.steps.reduce((a, s) => a + s.t, 0) || 1, top = maxRpm(d) || 1, W = 150, H = 70;
  let t = 0, rpm = 0;
  const pts = ['0,' + H];
  for (const s of d.steps) { t += s.t; rpm = s.rpm; pts.push(`${(t / total) * W},${H - (rpm / top) * (H - 6)}`); }
  // dispenses before the spin sit at t = 0, the others at their time (clamped to the program)
  const marks = d.dp.filter((x) => x.src).map((x) => (x.when === 'before' ? 0 : Math.max(0, Math.min(W, ((total - x.at) / total) * W))));
  return (
    <svg viewBox={`-4 -4 ${W + 8} ${H + 8}`} width="150" height="76" aria-hidden>
      <polyline points={pts.join(' ')} fill="none" stroke="var(--ac)" strokeWidth="2.2" strokeLinejoin="round" />
      <line x1="0" y1={H} x2={W} y2={H} stroke="var(--sep)" />
      {marks.map((x, i) => <circle key={i} cx={x} cy={H} r="4" fill="#e3a64a" />)}
    </svg>
  );
}

export const spin: Kind<D> = {
  segment: 's2', title: 'Spin coating', noun: 'spin program', defaults, Editor, Output, Visual,
  // solvents dispensed straight from the bottle (antisolvent, washing); solutions are counted in their own recipe
  uses: (d) => Object.entries(spinPlan(d.steps, d.dp, d.N, d.ov).vol).filter(([k]) => k.startsWith('Solvent: ')).map(([k, mL]) => ({ name: k.slice(9), ul: mL * 1000 })),
  summary: (d) => `${d.steps.length} steps · ${d.steps.reduce((a, s) => a + s.t, 0)} s · ${maxRpm(d)} rpm${d.an ? ` · ${d.aT} °C` : ''}`,
  describe: (d) => ({
    Steps: d.steps.map((s) => `${s.t}s/${s.rpm}`).join(', '), 'Total time': `${d.steps.reduce((a, s) => a + s.t, 0)} s`,
    Dispenses: d.dp.filter((x) => x.src).map((x) => `${x.v} µL ${x.src.replace(/^(Preset|Solvent): /, '')} ${x.when === 'before' ? 'before' : `@${x.at} s`}`).join(', ') || 'none',
    Annealing: d.an ? `${d.aT} °C, ${d.aM} min` : 'none', ...(d.ox ? { Activation: `${d.oa}, ${d.oh} h` } : {}),
  }),
  runFields: (d) => [
    ...d.dp.filter((x) => x.src).map((x, i) => ({ key: 'dp:' + i, label: `${x.src.replace(/^(Preset|Solvent): /, '')} dispensed`, expected: `${x.v} µL${x.when === 'remaining' ? ` @ ${x.at} s` : ''}`, unit: 'µL' })),
    ...(d.an ? [{ key: 'aT', label: 'Annealing temperature', expected: `${d.aT} °C`, unit: '°C' }, { key: 'aM', label: 'Annealing time', expected: `${d.aM} min`, unit: 'min' }] : []),
    { key: 'o2', label: 'Glovebox O2', unit: 'ppm' }, { key: 'h2o', label: 'Glovebox H2O', unit: 'ppm' }, { key: 'n', label: 'Substrates coated', expected: String(d.N) },
  ],
};
