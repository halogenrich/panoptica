import { SUBSTRATES, type SubKey } from '@psc/devices';
import { StepList, SubstrateImg, type Step } from './parts';
import { DesignSvg } from '../designs/DesignSvg';
import { itoArea, subLayers, type SubD } from '../designs/substrate';
import { Section } from './shared';
import type { Ctx, Kind } from './types';
import { Picker, type PickOption } from '@web/views/Picker';
import { chemFor, chemOptions } from '@web/views/common';

// what is not a liquid stays a fixed list; what the substrates are sonicated in comes from the lab (0.58)
const SURF = ['N2 dry', 'UV-ozone', 'O2 plasma'];

/** Custom solutions marked as cleaning solutions (0.58): the lab's own soap solution, for example. */
const cleaningSolutions = (ctx: Ctx) =>
  ctx.all.filter((p) => p.segment === 's1' && p.data?.mode === 'Custom' && p.data?.cln).map((p) => p.name);

/**
 * What sonication can use (0.58): substances with the Cleaning role (in stock first), then cleaning solutions, then every
 * other substance (nothing hidden: a role never set does not keep a substance out).
 */
export function cleaningOptions(ctx: Ctx): PickOption[] {
  const subs = chemOptions(ctx.chems, ['cleaning']),
    sols = cleaningSolutions(ctx).filter((n) => !subs.some((o) => o.value === n));
  const cut = subs.findIndex((o) => o.group === 'Other substances');
  const at = cut < 0 ? subs.length : cut;
  return [
    ...subs.slice(0, at),
    ...sols.map((n) => ({ value: n, label: n, group: 'Cleaning solutions' })),
    ...subs.slice(at),
  ];
}

/**
 * A step's name linked to what it means (0.58): a cleaning solution by its name, else the inventory's substance (name, short
 * name, other names, formula, CAS), else the name as written. Steps saved before keep their names ("Isopropanol").
 */
const linked = (s: string, ctx: Ctx) =>
  cleaningSolutions(ctx).includes(s) ? undefined : ctx.chems.length ? chemFor(ctx.chems, s) : undefined;
/** The substance's name, for the picker to find the option a stored step means. */
const asOption = (s: string, ctx: Ctx) => linked(s, ctx)?.name ?? s;
/** How a step is written in outputs: the substance's short name when it has one, as everywhere since 0.54.1. */
export const stepName = (s: string, ctx: Ctx) => {
  const c = linked(s, ctx);
  return c ? c.s || c.name : s;
};
const sortSf = (l: Step[]) => [...l].sort((a, b) => +(b.s === 'N2 dry') - +(a.s === 'N2 dry')); // N2 dry always first
const defaults = () => ({
  subId: '',
  subName: '',
  design: null as SubD | null,
  sub: '' as SubKey | '', // earlier versions: a fixed substrate size instead of a design
  steps: [] as Step[],
  sf: [] as Step[],
});
type D = ReturnType<typeof defaults>;
const sum = (l: Step[]) => l.reduce((a, x) => a + x.m, 0);
const sub = (d: D): SubKey => (d.sub in SUBSTRATES ? (d.sub as SubKey) : '1.2 × 1.2 cm');
/** Saved before substrate designs existed (a fixed size), and not yet given a design. */
const legacy = (d: D) => !d.design && d.sub in SUBSTRATES;

/** Drawing of the chosen substrate design, or of the fixed size used by earlier versions. */
function Glass({ d, small }: { d: D; small?: boolean }) {
  if (!d.design && !legacy(d))
    return small ? (
      <div className="mat-art">
        <span>No substrate</span>
      </div>
    ) : null;
  if (d.design)
    return (
      <DesignSvg
        w={d.design.w}
        h={d.design.h}
        layers={subLayers(d.design)}
        marker={d.design.marker}
        maxW={small ? 150 : 360}
        maxH={small ? 92 : 240}
        legend={!small}
      />
    );
  const s = sub(d);
  return <SubstrateImg sub={s} k={small ? (s === '1.2 × 1.2 cm' ? 7 : 5) : 8} legend={!small} />;
}
const subLabel = (d: D) => (d.design ? d.subName : legacy(d) ? sub(d) : 'No substrate design');

function Editor({ d, set, ctx }: { d: D; set: (p: Partial<D>) => void; ctx: Ctx }) {
  const subs = ctx.designs.filter((x) => x.segment === 'sub');
  return (
    <>
      <Section title="Substrate">
        <Picker
          label="Substrate"
          empty={legacy(d) ? `Earlier version: ${sub(d)} (choose a design)` : 'Choose a substrate design'}
          value={d.subId}
          onChange={(subId) => {
            const x = subs.find((s) => String(s.id) === subId);
            set({ subId, subName: x?.name ?? '', design: x?.data ?? null });
          }}
          options={subs.map((s) => ({ value: String(s.id), label: s.name }))}
        />
      </Section>
      <StepList
        title="Sonication"
        list={d.steps}
        pick={cleaningOptions(ctx)}
        shown={(x) => asOption(x, ctx)}
        onChange={(steps) => set({ steps })}
      />
      <StepList
        title="Surface treatment"
        list={sortSf(d.sf)}
        options={SURF}
        onChange={(sf) => set({ sf: sortSf(sf) })}
      />
    </>
  );
}

function Output({ d, ctx }: { d: D; ctx: Ctx; blanks?: boolean }) {
  const s = sub(d),
    S = SUBSTRATES[s];
  return (
    <>
      <p className="headline">
        {subLabel(d)}{' '}
        <span className="mut">
          · sonication {sum(d.steps)} min · surface {sum(d.sf)} min
        </span>
      </p>
      <Glass d={d} />
      <p className="mut">
        {d.design
          ? `${d.design.w} × ${d.design.h} mm · ITO area ${itoArea(d.design).toFixed(1)} mm² · ${d.design.rs} Ω/sq`
          : legacy(d)
            ? `${S.note} · ITO area ${S.ito[2] * S.ito[3]} mm²`
            : 'Choose a substrate design (Designs › Substrates).'}
      </p>
      <div className="cols2">
        <div>
          <b>Sonication</b>
          <ol>
            {d.steps.map((x, i) => (
              <li key={i}>
                {stepName(x.s, ctx)}, {x.m} min
              </li>
            ))}
          </ol>
        </div>
        <div>
          <b>Surface treatment</b>
          <ol>
            {sortSf(d.sf).map((x, i) => (
              <li key={i}>
                {x.s}, {x.m} min
              </li>
            ))}
          </ol>
        </div>
      </div>
    </>
  );
}

export const substratePrep: Kind<D> = {
  segment: 's0',
  title: 'Substrate preparation',
  noun: 'substrate preparation',
  defaults,
  Editor,
  Output,
  Visual: ({ d }) => <Glass d={d} small />,
  summary: (d) => `${subLabel(d)} · ${d.steps.length} sonication steps · ${sum(d.steps) + sum(d.sf)} min`,
  describe: (d, ctx) => ({
    Substrate: subLabel(d),
    // one step per line, in order, as on the printed sheet
    Sonication: d.steps.map((x) => `${stepName(x.s, ctx)}, ${x.m} min`).join('\n'),
    'Surface treatment':
      sortSf(d.sf)
        .map((x) => `${x.s}, ${x.m} min`)
        .join('\n') || 'none',
  }),
  runFields: (d, ctx) => [
    ...d.steps.map((x, i) => ({
      key: 'son:' + i,
      label: `${stepName(x.s, ctx)} sonication`,
      expected: `${x.m} min`,
      unit: 'min',
    })),
    ...sortSf(d.sf).map((x, i) => ({ key: 'sf:' + i, label: x.s, expected: `${x.m} min`, unit: 'min' })),
    { key: 'n', label: 'Substrates cleaned' },
  ],
};
