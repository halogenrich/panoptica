import {
  SUBSTRATES,
  allPolys,
  analyzeMask,
  union,
  convertRate,
  depositionSeconds,
  metalStages,
  pattern,
  type MaskD,
  type RateUnit,
  type SubKey,
} from '@psc/core';
import { COLORS, DesignSvg, metalColor, type Layer } from '../designs/DesignSvg';
import { Num, SubstrateImg, mmss } from '../views/common';
import { Bl, Formula, Section, T, withBlank } from './shared';
import type { Ctx, Kind } from './types';
import Molecule from './Molecule';
import { moleculeFor } from './molecules';

// ---------------- organic evaporation ----------------
const orgDefaults = () => ({ mat: 'C60', th: 30, rate: 0.3, u: 'A/s' as RateUnit, T: 0, P: 1, Pe: -6, pu: 'mbar' });
type O = ReturnType<typeof orgDefaults>;
const ru = (u: RateUnit) => u.replace('A', 'Å');

function OrgEditor({ d, set, ctx }: { d: O; set: (p: Partial<O>) => void; ctx: Ctx }) {
  const mats = ctx.chems.filter((c) => c.role === 'organic').map((c) => c.name);
  return (
    <Section title="Layer">
      <label className="row">
        <span>Material</span>
        <select value={d.mat} onChange={(e) => set({ mat: e.target.value })}>
          {(mats.includes(d.mat) ? mats : [d.mat, ...mats]).map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </label>
      <label className="row">
        <span>Thickness (nm)</span>
        <Num v={d.th} on={(th) => set({ th })} />
      </label>
      <div className="row">
        <span>Rate</span>
        <span className="inline">
          <Num v={d.rate} on={(rate) => set({ rate })} />
          <select
            value={d.u}
            onChange={(e) => {
              const u = e.target.value as RateUnit;
              set({ u, rate: convertRate(d.rate, d.u, u) });
            }}
          >
            <option value="A/s">Å/s</option>
            <option value="A/min">Å/min</option>
          </select>
        </span>
      </div>
      <label className="row">
        <span>Expected temperature (°C)</span>
        <Num v={d.T} on={(T) => set({ T })} />
      </label>
      <div className="row">
        <span>Expected pressure</span>
        <span className="inline">
          <Num v={d.P} on={(P) => set({ P })} w={72} /> × 10 <Num v={d.Pe} on={(Pe) => set({ Pe })} w={64} />
          <select value={d.pu} onChange={(e) => set({ pu: e.target.value })}>
            <option>mbar</option>
            <option>Torr</option>
            <option>Pa</option>
          </select>
        </span>
      </div>
    </Section>
  );
}

function OrgOutput({ d, blanks }: { d: O; ctx: Ctx; blanks?: boolean }) {
  const mol = moleculeFor(d.mat);
  return (
    <>
      <p className="headline">
        {d.mat}{' '}
        <span className="mut">
          · {d.th} nm at {d.rate} {ru(d.u)}
        </span>
      </p>
      {mol && !blanks && (
        <figure className="mol-figure">
          <Molecule mol={mol} size={220} spin interactive />
          <figcaption>
            <b>{mol.name}</b>
            <span className="mut">
              <Formula f={mol.formula} /> · {mol.M} g/mol
            </span>
            <span className="mut small">Drag to rotate</span>
          </figcaption>
        </figure>
      )}
      <T
        h={['Thickness', 'Rate', 'Expected T', 'Expected P', 'Estimated time']}
        rows={[
          [
            `${d.th} nm`,
            `${d.rate} ${ru(d.u)}`,
            `${d.T} °C`,
            <>
              {d.P} × 10<sup>{d.Pe}</sup> {d.pu}
            </>,
            mmss(depositionSeconds(d.th, d.rate, d.u)),
          ],
        ]}
      />
      {blanks && (
        <T
          h={['Measured T (°C)', 'Measured P', 'Measured rate']}
          rows={[
            [
              <Bl k="Tm" />,
              <>
                <Bl k="Pm" /> × 10 <Bl k="Pme" /> {d.pu}
              </>,
              <Bl k="Rm" />,
            ],
          ]}
        />
      )}
    </>
  );
}

export const organic: Kind<O> = {
  segment: 's3',
  title: 'Organic evaporation',
  noun: 'organic layer',
  defaults: orgDefaults,
  Editor: OrgEditor,
  Output: OrgOutput,
  noFactsArt: true,
  Visual: ({ d }) => {
    const mol = moleculeFor(d.mat);
    return mol ? (
      <Molecule mol={mol} size={108} hydrogens={false} fit />
    ) : (
      <div className="mat-art">
        <span>{d.mat}</span>
        <small>{d.th} nm</small>
      </div>
    );
  },
  summary: (d) => `${d.th} nm · ${d.rate} ${ru(d.u)} · ${mmss(depositionSeconds(d.th, d.rate, d.u))}`,
  describe: (d) => ({
    Material: d.mat,
    Thickness: `${d.th} nm`,
    Rate: `${d.rate} ${ru(d.u)}`,
    'Expected T': `${d.T} °C`,
    'Expected P': `${d.P}e${d.Pe} ${d.pu}`,
  }),
  runFields: (d) => [
    { key: 'Tm', label: 'Temperature at rate', expected: `${d.T} °C`, unit: '°C' },
    { key: 'Pm', label: 'Pressure', expected: `${d.P}e${d.Pe} ${d.pu}`, unit: d.pu },
    { key: 'Rm', label: 'Rate', expected: `${d.rate} ${ru(d.u)}`, unit: ru(d.u) },
    { key: 'thm', label: 'Final thickness', expected: `${d.th} nm`, unit: 'nm' },
  ],
};

// ---------------- metal evaporation ----------------
const metDefaults = () => ({
  met: 'Ag',
  p0: 10,
  st: [
    { until: 5, rate: 0.1 },
    { until: 15, rate: 0.2 },
    { until: 100, rate: 1 },
  ] as { until: number; rate: number }[],
  subId: '',
  maskId: '',
  maskName: '',
  mask: null as MaskD | null, // current: substrate design + mask layout (snapshot of the layout)
  sub: '1.2 × 1.2 cm' as SubKey,
  pat: '', // earlier versions: fixed size + placeholder pattern
});
type M = ReturnType<typeof metDefaults>;
const sub = (d: M): SubKey => (d.sub in SUBSTRATES ? d.sub : '1.2 × 1.2 cm');
const legacy = (d: M) => !d.mask;

function MetEditor({ d, set, ctx }: { d: M; set: (p: Partial<M>) => void; ctx: Ctx }) {
  const metals = ctx.chems.filter((c) => c.role === 'metal').map((c) => c.name),
    m = metalStages(d.st);
  const subs = ctx.designs.filter((x) => x.segment === 'sub'),
    masks = ctx.designs.filter((x) => x.segment === 'mask' && x.data.subId === d.subId);
  const up = (i: number, p: Partial<M['st'][0]>) => set({ st: d.st.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  return (
    <>
      <Section title="Substrate and mask">
        <label className="row">
          <span>Substrate</span>
          <select
            value={d.subId}
            onChange={(e) => set({ subId: e.target.value, maskId: '', maskName: '', mask: null })}
          >
            <option value="">Choose a substrate design…</option>
            {subs.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="row">
          <span>Mask layout</span>
          <select
            value={d.maskId}
            disabled={!d.subId}
            onChange={(e) => {
              const x = masks.find((k) => String(k.id) === e.target.value);
              set({ maskId: e.target.value, maskName: x?.name ?? '', mask: x?.data ?? null });
            }}
          >
            <option value="">
              {d.subId ? (masks.length ? 'Choose a mask layout…' : 'No mask layouts for this substrate') : '—'}
            </option>
            {masks.map((k) => (
              <option key={k.id} value={String(k.id)}>
                {k.name}
              </option>
            ))}
          </select>
        </label>
        {legacy(d) && (
          <p className="mut small">
            {d.subId
              ? 'Only mask layouts drawn for this substrate are listed. Create them under Designs › Metal masks.'
              : `Saved with an earlier version: ${sub(d)}, ${pattern(sub(d), d.pat).name}. Choose a substrate design and mask layout to replace it.`}
          </p>
        )}
      </Section>
      <Section title="Metal">
        <label className="row">
          <span>Metal</span>
          <select value={d.met} onChange={(e) => set({ met: e.target.value })}>
            {(metals.includes(d.met) ? metals : [d.met, ...metals]).map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label className="row">
          <span>Starting power (%)</span>
          <Num v={d.p0} on={(p0) => set({ p0 })} />
        </label>
      </Section>
      <Section title="Rate until thickness">
        {!m.ordered && <p className="err">Thicknesses must increase from stage to stage.</p>}
        <table className="tight">
          <thead>
            <tr>
              <th>Stage</th>
              <th>Until (nm)</th>
              <th>Rate (Å/s)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {d.st.map((x, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>
                  <Num v={x.until} on={(until) => up(i, { until })} />
                </td>
                <td>
                  <Num v={x.rate} on={(rate) => up(i, { rate })} />
                </td>
                <td>
                  <button
                    className="iconbtn rm"
                    aria-label={`Remove stage ${i + 1}`}
                    title="Remove"
                    onClick={() => set({ st: d.st.filter((_, j) => j !== i) })}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="link add" onClick={() => set({ st: [...d.st, { until: m.final + 10, rate: 1 }] })}>
          Add stage
        </button>
      </Section>
    </>
  );
}

/** Metal-evaporation drawings: ITO, the scrape zone, and all metal in the metal's colour (pixels and counter electrode alike). */
function evapLayers(mk: NonNullable<M['mask']>, met: string, withMetal: boolean, faint = false): Layer[] {
  const [fill, stroke] = metalColor(met);
  return [
    { polys: allPolys(mk.sub.ito), fill: COLORS.ito, opacity: faint ? 0.35 : 0.5, label: 'ITO' },
    { polys: allPolys(mk.scrape), fill: COLORS.scrape, opacity: withMetal ? 0.35 : 0.55, label: 'Scrape (expose ITO)' },
    ...(withMetal
      ? [
          {
            polys: union([...allPolys(mk.active), ...allPolys(mk.conn)]).flat(),
            fill,
            opacity: 1,
            stroke,
            evenodd: true,
            label: met,
          },
        ]
      : []),
  ];
}

/** Pattern drawing: scrape zone on ITO, then the metal over ITO and scrape zone. Falls back to the earlier placeholder pattern. */
function Pattern({ d, small }: { d: M; small?: boolean }) {
  if (d.mask) {
    const mk = d.mask,
      a = analyzeMask(mk),
      box = { w: mk.sub.w, h: mk.sub.h, maxW: 300, maxH: 240 };
    if (small)
      return (
        <DesignSvg
          w={mk.sub.w}
          h={mk.sub.h}
          layers={evapLayers(mk, d.met, true, true)}
          maxW={150}
          maxH={92}
          legend={false}
        />
      );
    return (
      <>
        <div className="pattern-pair">
          {mk.scrape.length > 0 && (
            <div>
              <div className="pane-label">1 · Scrape the layers off the ITO</div>
              <DesignSvg {...box} layers={evapLayers(mk, d.met, false)} />
            </div>
          )}
          <div>
            <div className="pane-label">
              {mk.scrape.length ? '2 · ' : ''}
              {d.met} through the mask
            </div>
            <DesignSvg
              {...box}
              layers={evapLayers(mk, d.met, true)}
              labels={a.pixels.map((p) => ({ at: p.at, text: 'P' + p.n }))}
            />
          </div>
        </div>
        <p>
          {d.maskName} on {mk.subName} · {a.pixels.length} pixels ·{' '}
          {a.pixels.map((p) => `P${p.n} ${p.area.toFixed(2)}`).join(', ')} mm².
          {mk.scrape.length ? ' Scrape the layers in the red zone before loading the substrates.' : ''}
        </p>
      </>
    );
  }
  const s = sub(d),
    g = pattern(s, d.pat),
    mc = metalColor(d.met);
  if (small) return <SubstrateImg sub={s} metal={g.metal} k={s === '1.2 × 1.2 cm' ? 7 : 5} legend={false} mc={mc} />;
  return (
    <>
      <div className="pattern-pair">
        <div>
          <div className="pane-label">1 · Scrape the layers off the ITO</div>
          <SubstrateImg sub={s} scrape={g.scrape} k={9} />
        </div>
        <div>
          <div className="pane-label">2 · {d.met} through the mask</div>
          <SubstrateImg sub={s} metal={g.metal} scrape={g.scrape} k={9} so={0.25} mc={mc} />
        </div>
      </div>
      <p>
        {g.name} · {g.metal.length} pixels · {g.areas[0].toFixed(1)} mm² each. Scrape the layers in the red zone before
        loading the substrates.
      </p>
    </>
  );
}

function MetOutput({ d, blanks }: { d: M; ctx: Ctx; blanks?: boolean }) {
  const m = metalStages(d.st);
  const t0 = withBlank(
    blanks,
    ['Stage', 'Thickness', 'Controller (kÅ)', 'Rate (Å/s)', 'Time'],
    m.rows.map((r, i) => [i + 1, `${r.from} → ${r.until} nm`, r.kA.toFixed(3), r.rate, mmss(r.seconds)]),
    'Power (%)',
    m.rows.map((_, i) => 'pw:' + i),
  );
  const t = withBlank(
    blanks,
    t0.h,
    t0.rows,
    'Pressure (mbar)',
    m.rows.map((_, i) => 'P:' + i),
  );
  return (
    <>
      <p className="headline">
        {d.met} · {m.final} nm{' '}
        <span className="mut">
          · {(m.final / 100).toFixed(3)} kÅ on controller · start at {d.p0} % · {mmss(m.total)}
        </span>
      </p>
      {!m.ordered && <p className="err">Thicknesses must increase from stage to stage.</p>}
      <T h={t.h} rows={t.rows} />
      {blanks && (
        <p className="tv-line">
          T.V = <Bl k="tv" /> %
        </p>
      )}
      <Pattern d={d} />
    </>
  );
}

export const metal: Kind<M> = {
  segment: 's4',
  title: 'Metal evaporation',
  noun: 'metal contact',
  defaults: metDefaults,
  Editor: MetEditor,
  Output: MetOutput,
  Visual: ({ d }) => <Pattern d={d} small />,
  summary: (d) => {
    const m = metalStages(d.st);
    return `${d.met} · ${m.final} nm · ${d.st.length} stages · ${mmss(m.total)}`;
  },
  describe: (d) => ({
    Metal: d.met,
    Substrate: d.mask ? d.mask.subName : sub(d),
    'Mask layout': d.mask ? d.maskName : pattern(sub(d), d.pat).name,
    Stages: d.st.map((x) => `${x.rate} Å/s to ${x.until} nm`).join(', '),
    'Start power': `${d.p0} %`,
  }),
  runStages: (d) =>
    metalStages(d.st).rows.map((r, i) => ({
      label: `${i + 1} · ${r.rate} Å/s`,
      expected: `${r.from} → ${r.until} nm`,
    })),
  runFields: (d) => [
    ...d.st.flatMap((x, i) => [
      { key: 'pw:' + i, label: `Power, stage ${i + 1} (${x.rate} Å/s)`, unit: '%', stage: i, col: 'Power' },
      {
        key: 'P:' + i,
        label: `Pressure at ${x.rate} Å/s`,
        unit: 'mbar',
        input: 'sci' as const,
        stage: i,
        col: 'Pressure',
      },
    ]),
    { key: 'tv', label: 'Sensor life (T.V)', unit: '%', input: 'pct' as const },
    { key: 'thm', label: 'Final thickness', expected: `${metalStages(d.st).final} nm`, unit: 'nm' },
    { key: 'P', label: 'Base pressure', unit: 'mbar', input: 'sci' as const },
  ],
};
