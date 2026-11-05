import { SUBSTRATES, type SubKey } from '@psc/core';
import { StepList, SubstrateImg, type Step } from '../views/common';
import { DesignSvg } from '../designs/DesignSvg';
import { itoArea, subLayers, type SubD } from '../designs/substrate';
import { Section } from './shared';
import type { Ctx, Kind } from './types';

const SOLV = ['Soap', 'Ultrapure Water', 'Acetone', 'Isopropanol'], SURF = ['N2 dry', 'UV-ozone', 'O2 plasma'];
const sortSf = (l: Step[]) => [...l].sort((a, b) => +(b.s === 'N2 dry') - +(a.s === 'N2 dry')); // N2 dry always first
const defaults = () => ({ subId: '', subName: '', design: null as SubD | null, sub: '1.2 × 1.2 cm' as SubKey, steps: SOLV.map((s) => ({ s, m: 10 })) as Step[], sf: [{ s: 'N2 dry', m: 1 }] as Step[] });
type D = ReturnType<typeof defaults>;
const sum = (l: Step[]) => l.reduce((a, x) => a + x.m, 0);
const sub = (d: D): SubKey => (d.sub in SUBSTRATES ? d.sub : '1.2 × 1.2 cm');

/** Drawing of the chosen substrate design, or of the fixed size used by earlier versions. */
function Glass({ d, small }: { d: D; small?: boolean }) {
  if (d.design) return <DesignSvg w={d.design.w} h={d.design.h} layers={subLayers(d.design)} marker={d.design.marker} maxW={small ? 150 : 360} maxH={small ? 92 : 240} legend={!small} />;
  const s = sub(d);
  return <SubstrateImg sub={s} k={small ? (s === '1.2 × 1.2 cm' ? 7 : 5) : 8} legend={!small} />;
}
const subLabel = (d: D) => (d.design ? d.subName : sub(d));

function Editor({ d, set, ctx }: { d: D; set: (p: Partial<D>) => void; ctx: Ctx }) {
  const subs = ctx.designs.filter((x) => x.segment === 'sub');
  return (
    <>
      <Section title="Substrate">
        <select value={d.subId} onChange={(e) => { const x = subs.find((s) => String(s.id) === e.target.value); set({ subId: e.target.value, subName: x?.name ?? '', design: x?.data ?? null }); }}>
          <option value="">{d.design ? '—' : `Earlier version: ${sub(d)} (choose a design)`}</option>{subs.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}</select>
      </Section>
      <StepList title="Sonication" list={d.steps} options={SOLV} onChange={(steps) => set({ steps })} />
      <StepList title="Surface treatment" list={sortSf(d.sf)} options={SURF} onChange={(sf) => set({ sf: sortSf(sf) })} />
    </>
  );
}

function Output({ d }: { d: D; ctx: Ctx; blanks?: boolean }) {
  const s = sub(d), S = SUBSTRATES[s];
  return (
    <>
      <p className="headline">{subLabel(d)} <span className="mut">· sonication {sum(d.steps)} min · surface {sum(d.sf)} min</span></p>
      <Glass d={d} />
      <p className="mut">{d.design ? `${d.design.w} × ${d.design.h} mm · ITO area ${itoArea(d.design).toFixed(1)} mm² · ${d.design.rs} Ω/sq` : `${S.note} · ITO area ${S.ito[2] * S.ito[3]} mm²`}</p>
      <div className="cols2">
        <div><b>Sonication</b><ol>{d.steps.map((x, i) => <li key={i}>{x.s}, {x.m} min</li>)}</ol></div>
        <div><b>Surface treatment</b><ol>{sortSf(d.sf).map((x, i) => <li key={i}>{x.s}, {x.m} min</li>)}</ol></div>
      </div>
    </>
  );
}

export const substratePrep: Kind<D> = {
  segment: 's0', title: 'Substrate prep', noun: 'substrate prep', defaults, Editor, Output,
  Visual: ({ d }) => <Glass d={d} small />,
  summary: (d) => `${subLabel(d)} · ${d.steps.length} sonication steps · ${sum(d.steps) + sum(d.sf)} min`,
  describe: (d) => ({ Substrate: subLabel(d), Sonication: d.steps.map((x) => `${x.s} ${x.m} min`).join(', '), 'Surface treatment': sortSf(d.sf).map((x) => `${x.s} ${x.m} min`).join(', ') || 'none' }),
  runFields: (d) => [
    ...d.steps.map((x, i) => ({ key: 'son:' + i, label: `${x.s} sonication`, expected: `${x.m} min`, unit: 'min' })),
    ...sortSf(d.sf).map((x, i) => ({ key: 'sf:' + i, label: x.s, expected: `${x.m} min`, unit: 'min' })),
    { key: 'n', label: 'Substrates cleaned' },
  ],
};
