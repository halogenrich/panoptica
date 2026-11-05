import { useMemo, useState } from 'react';
import {
  DEFAULT_PLATE,
  MASK_LABEL,
  allPolys,
  analyzeMask,
  maskDxf,
  maskStl,
  maskSvg,
  regionArea,
  suggestScrape,
  union,
  type MaskD,
  type MaskKind,
  type Shape,
} from '@psc/core';
import { Check, Num } from '../views/common';
import { Badge } from '../lib/ui';
import { Section } from '../recipes/shared';
import type { Ctx, Kind } from '../recipes/types';
import { COLORS, DesignSvg, type Layer, type Marker } from './DesignSvg';
import ShapeEditor from './ShapeEditor';
import ShapeTable from './ShapeTable';
import { useHistory } from './useHistory';
import type { SubD } from './substrate';

const defaults = (): MaskD => ({
  subId: '',
  subName: '',
  sub: { w: 12, h: 12, ito: [] },
  active: [],
  conn: [],
  scrape: [],
  plate: { ...DEFAULT_PLATE },
  notes: '',
});
const norm = (d: MaskD): MaskD => ({ ...defaults(), ...d, plate: { ...DEFAULT_PLATE, ...(d.plate ?? {}) } });
const fmt = (v: number, n = 2) => (Math.round(v * 10 ** n) / 10 ** n).toString();
const marker = (d: MaskD) => ((d.sub as Partial<SubD>).marker ?? 'none') as Marker;

/** Drawing layers for a mask: ITO, scrape, all metal, and the intended active areas outlined. */
export function maskLayers(d: MaskD, faint = false): Layer[] {
  return [
    { polys: allPolys(d.sub.ito), fill: COLORS.ito, opacity: faint ? 0.35 : 0.5, label: 'ITO' },
    { polys: allPolys(d.scrape), fill: COLORS.scrape, opacity: 0.45, label: 'Scrape area' },
    { polys: [...allPolys(d.active), ...allPolys(d.conn)], fill: COLORS.metal, opacity: 0.75, label: 'Metal' },
    { polys: allPolys(d.active), fill: COLORS.active, opacity: 0.9, stroke: '#8a5300', label: 'Active area' },
  ];
}

const STEPS = ['Substrate', 'Active areas', 'Connections', 'Scrape area', 'Review and export'];
const HELP: Record<number, string> = {
  1: 'Draw the pixels: the areas meant to be active (metal over the full stack). Use "Repeat as array" for rows of identical pixels, then "Confirm array" to make them separate pixels. Pixel numbers follow the list order: drag to reorder so P1, P2… match the pixel numbers of the J–V system.',
  2: 'Draw the metal that is not meant to be active: strips from each pixel to a pad on ITO-free glass, and the counter electrode that contacts the exposed ITO.',
  3: 'Mark where the layers are scraped off to expose ITO. Pixel metal must not reach it; the counter electrode should.',
};
type Layerkey = 'active' | 'conn' | 'scrape';
const STEP_LAYER: Record<number, { key: Layerkey; color: string }> = {
  1: { key: 'active', color: COLORS.active },
  2: { key: 'conn', color: COLORS.metal },
  3: { key: 'scrape', color: COLORS.scrape },
};

function background(d: MaskD, key: Layerkey): Layer[] {
  const ito = { polys: allPolys(d.sub.ito), fill: COLORS.ito, opacity: 0.45 };
  if (key === 'active')
    return [
      ito,
      { polys: allPolys(d.scrape), fill: COLORS.scrape, opacity: 0.25 },
      { polys: allPolys(d.conn), fill: COLORS.metal, opacity: 0.35 },
    ];
  if (key === 'conn')
    return [
      ito,
      { polys: allPolys(d.scrape), fill: COLORS.scrape, opacity: 0.25 },
      { polys: allPolys(d.active), fill: COLORS.active, opacity: 0.55 },
    ];
  return [ito, { polys: [...allPolys(d.active), ...allPolys(d.conn)], fill: COLORS.metal, opacity: 0.4 }];
}

function Issues({ list }: { list: { level: string; text: string }[] }) {
  if (!list.length) return <p className="ok small">No problems found.</p>;
  return (
    <ul className="issues">
      {list.map((i, n) => (
        <li key={n} className={i.level}>
          {i.text}
        </li>
      ))}
    </ul>
  );
}

const download = (name: string, text: string, type: string) => {
  const a = document.createElement('a'),
    url = URL.createObjectURL(new Blob([text], { type }));
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};
const slug = (s: string) =>
  s
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'mask';

/** Download buttons for each mask (aperture, evaporation, scrape stencil) in STL, SVG and DXF. */
export function ExportPanel({ d }: { d: MaskD }) {
  const kinds: MaskKind[] = ['aperture', 'evaporation', ...(d.scrape.length ? ['scrape' as MaskKind] : [])];
  const base = slug(d.subName) + (d.plate.mirror ? '-mirrored' : '');
  return (
    <div className="exports">
      {kinds.map((k) => (
        <div key={k} className="export-row">
          <span>{MASK_LABEL[k]}</span>
          <span className="inline">
            <button className="link" onClick={() => download(`${base}-${k}.stl`, maskStl(d, k).text, 'model/stl')}>
              STL
            </button>
            <button className="link" onClick={() => download(`${base}-${k}.svg`, maskSvg(d, k), 'image/svg+xml')}>
              SVG
            </button>
            <button className="link" onClick={() => download(`${base}-${k}.dxf`, maskDxf(d, k), 'application/dxf')}>
              DXF
            </button>
          </span>
        </div>
      ))}
      <p className="mut small">
        Plate {fmt(d.sub.w + 2 * d.plate.margin)} × {fmt(d.sub.h + 2 * d.plate.margin)} mm, {d.plate.t} mm thick
        {d.plate.pocket ? `, ${d.plate.pocketDepth} mm substrate pocket` : ''}
        {d.plate.mirror ? ', mirrored for face-down mounting' : ''}. In Tinkercad, import STL or SVG in millimetres.
      </p>
    </div>
  );
}

function PlateForm({ d, apply }: { d: MaskD; apply: (p: Partial<MaskD['plate']>) => void }) {
  const p = d.plate;
  return (
    <>
      <label className="row">
        <span>Plate thickness (mm)</span>
        <Num v={p.t} on={(t) => apply({ t })} />
      </label>
      <label className="row">
        <span>Border around the glass (mm)</span>
        <Num v={p.margin} on={(margin) => apply({ margin })} />
      </label>
      <label className="row">
        <span>Minimum feature (mm)</span>
        <Num v={p.minFeature} on={(minFeature) => apply({ minFeature })} />
      </label>
      <label className="inline">
        <Check v={p.pocket} on={(pocket) => apply({ pocket })} /> Substrate pocket on the underside
      </label>
      {p.pocket && (
        <>
          <label className="row">
            <span>Pocket depth (mm)</span>
            <Num v={p.pocketDepth} on={(pocketDepth) => apply({ pocketDepth })} />
          </label>
          <label className="row">
            <span>Clearance around the glass (mm)</span>
            <Num v={p.clearance} on={(clearance) => apply({ clearance })} />
          </label>
        </>
      )}
      <label className="inline">
        <Check v={p.mirror} on={(mirror) => apply({ mirror })} /> Mirror for substrates mounted face down
      </label>
    </>
  );
}

function PixelTable({
  a,
  d,
  set,
}: {
  a: ReturnType<typeof analyzeMask>;
  d?: MaskD;
  set?: (useActual: boolean) => void;
}) {
  if (!a.pixels.length) return null;
  const useActual = d?.useActual !== false,
    extra = a.pixels.some((p) => p.parasitic > 0.005);
  return (
    <>
      <table className="tight px-areas">
        <thead>
          <tr>
            <th>Pixel</th>
            <th>Drawn</th>
            <th>Recalculated device area</th>
            <th>Pad off ITO</th>
          </tr>
        </thead>
        <tbody>
          {a.pixels.map((p) => (
            <tr key={p.n}>
              <td>
                P{p.n}
                {p.short && (
                  <>
                    {' '}
                    <Badge tone="warn">short</Badge>
                  </>
                )}
              </td>
              <td className={useActual ? '' : 'used'}>{fmt(p.intended, 3)} mm²</td>
              <td className={useActual ? 'used' : ''}>
                {fmt(p.actual, 3)} mm²{p.parasitic > 0.005 && <span className="err"> (+{fmt(p.parasitic, 3)})</span>}
              </td>
              <td>{p.pad > 0.05 ? `${fmt(p.pad)} mm²` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {set && (
        <label className="accept-row small">
          <Check v={useActual} on={set} />
          <span>
            Accept the recalculated area (metal over unscraped ITO{extra ? ', including connection metal' : ''});
            unchecked uses the drawn area
          </span>
        </label>
      )}
    </>
  );
}

function Editor({ d: raw, set, ctx }: { d: MaskD; set: (p: Partial<MaskD>) => void; ctx: Ctx }) {
  const d = norm(raw);
  const [step, setStep] = useState(d.subId ? 1 : 0),
    [sel, setSel] = useState<string | null>(null);
  const hist = useHistory<MaskD>(d, (v) => set(v));
  const a = useMemo(() => analyzeMask(d), [raw]);
  const subs = ctx.designs.filter((x) => x.segment === 'sub');
  const go = (n: number) => {
    setSel(null);
    setStep(Math.max(0, Math.min(4, n)));
  };
  const L = STEP_LAYER[step];
  const pick = (id: number) => {
    const s = subs.find((x) => x.id === id)!,
      data = s.data as SubD;
    hist.apply({
      ...d,
      subId: String(s.id),
      subName: s.name,
      sub: { w: data.w, h: data.h, ito: data.ito, rs: data.rs, marker: data.marker } as MaskD['sub'],
    });
  };
  const nav = (
    <div className="steps">
      {STEPS.map((t, i) => (
        <button
          key={t}
          className={'step' + (i === step ? ' on' : '') + (i < step ? ' done' : '')}
          disabled={i > 0 && !d.subId}
          onClick={() => go(i)}
        >
          <span>{i + 1}</span>
          {t}
        </button>
      ))}
      <div className="grow" />
      <button className="link" disabled={step === 0} onClick={() => go(step - 1)}>
        Back
      </button>
      <button className="btn" disabled={step === 4 || !d.subId} onClick={() => go(step + 1)}>
        Next
      </button>
    </div>
  );
  const allIssues = [
    ...a.issues,
    ...a.fab.evaporation.map((i) => ({ ...i, text: 'Evaporation mask: ' + i.text })),
    ...a.fab.aperture.map((i) => ({ ...i, text: 'Aperture mask: ' + i.text })),
  ];
  const errs = allIssues.filter((i) => i.level === 'error').length,
    warns = allIssues.filter((i) => i.level === 'warn').length;
  const status = (
    <span className="small mut">
      {a.pixels.length} pixel{a.pixels.length === 1 ? '' : 's'} ·{' '}
      {errs ? (
        <span className="err">
          {errs} error{errs > 1 ? 's' : ''}
        </span>
      ) : (
        'no errors'
      )}
      {warns ? ` · ${warns} warning${warns > 1 ? 's' : ''}` : ''}
    </span>
  );

  return (
    <div className="wizard">
      {nav}
      {step === 0 && (
        <div className="pick-grid">
          {subs.length === 0 && (
            <p className="mut">No substrate designs yet. Create one under Designs › Substrates first.</p>
          )}
          {subs.map((s) => (
            <button
              key={s.id}
              className={'pcard' + (String(s.id) === d.subId ? ' picked' : '')}
              onClick={() => pick(s.id)}
            >
              <div className="pcard-art">
                <DesignSvg
                  w={s.data.w}
                  h={s.data.h}
                  layers={[{ polys: allPolys(s.data.ito), fill: COLORS.ito, opacity: 0.6 }]}
                  marker={s.data.marker}
                  maxW={150}
                  maxH={92}
                  legend={false}
                />
              </div>
              <div className="pcard-body">
                <div className="pcard-name">{s.name}</div>
                <div className="pcard-sum">
                  {s.data.w} × {s.data.h} mm
                </div>
              </div>
            </button>
          ))}
          {d.subId && d.active.length + d.conn.length + d.scrape.length > 0 && (
            <p className="notice">Changing the substrate keeps the shapes already drawn; check that they still fit.</p>
          )}
        </div>
      )}
      {L && (
        <div className="designer">
          <ShapeEditor
            w={d.sub.w}
            h={d.sub.h}
            marker={marker(d)}
            background={background(d, L.key)}
            shapes={d[L.key]}
            color={L.color}
            onChange={(s, commit) => hist.apply({ ...d, [L.key]: s }, commit)}
            sel={sel}
            setSel={setSel}
            undo={hist.undo}
            redo={hist.redo}
            canUndo={hist.canUndo}
            canRedo={hist.canRedo}
            labels={L.key === 'active' ? a.pixels.map((p) => ({ at: p.at, text: 'P' + p.n })) : []}
          />
          <aside className="designer-side">
            <Section title={STEPS[step]}>
              <p className="small mut">{HELP[step]}</p>
              {step === 3 && (
                <button
                  className="link add"
                  onClick={() => hist.apply({ ...d, scrape: [...d.scrape, ...suggestScrape(d)] })}
                >
                  Suggest scrape area under the counter electrode
                </button>
              )}
              <ShapeTable
                shapes={d[L.key]}
                w={d.sub.w}
                h={d.sub.h}
                selected={sel}
                onSelect={setSel}
                onChange={(s) => hist.apply({ ...d, [L.key]: s })}
                pixels={L.key === 'active'}
              />
            </Section>
            <Section title="Live check">
              {status}
              <PixelTable a={a} d={d} set={(useActual) => hist.apply({ ...d, useActual })} />
              <Issues list={a.issues.filter((i) => i.level !== 'info')} />
            </Section>
          </aside>
        </div>
      )}
      {step === 4 && (
        <div className="designer">
          <div className="review-main">
            <DesignSvg
              w={d.sub.w}
              h={d.sub.h}
              layers={maskLayers(d)}
              marker={marker(d)}
              maxW={720}
              maxH={520}
              dims
              labels={a.pixels.map((p) => ({ at: p.at, text: 'P' + p.n }))}
            />
            <PixelTable a={a} d={d} set={(useActual) => hist.apply({ ...d, useActual })} />
          </div>
          <aside className="designer-side">
            <Section title="Checks">
              {status}
              <Issues list={allIssues.filter((i) => i.level !== 'info')} />
            </Section>
            <Section title="Mask plate">
              <PlateForm d={d} apply={(p) => hist.apply({ ...d, plate: { ...d.plate, ...p } })} />
            </Section>
            <Section title="Export">
              <ExportPanel d={d} />
            </Section>
            <Section title="Notes">
              <textarea
                value={d.notes}
                onChange={(e) => set({ notes: e.target.value })}
                placeholder="Mask maker, material, quotation…"
              />
            </Section>
          </aside>
        </div>
      )}
    </div>
  );
}

function Output({ d: raw }: { d: MaskD; ctx: Ctx; blanks?: boolean }) {
  const d = norm(raw),
    a = analyzeMask(d);
  const errs = [...a.issues, ...a.fab.evaporation, ...a.fab.aperture].filter((i) => i.level !== 'info');
  return (
    <>
      <p className="headline">
        {d.subName || 'No substrate'}{' '}
        <span className="mut">
          · {a.pixels.length} pixels · {fmt(a.activeTotal)} mm² active in total
        </span>
      </p>
      <DesignSvg
        w={d.sub.w}
        h={d.sub.h}
        layers={maskLayers(d)}
        marker={marker(d)}
        maxW={560}
        maxH={380}
        dims
        labels={a.pixels.map((p) => ({ at: p.at, text: 'P' + p.n }))}
      />
      <PixelTable a={a} d={d} />
      <p className="mut small">Pixel area used: {d.useActual === false ? 'drawn area' : 'recalculated device area'}.</p>
      <Issues list={errs} />
      <h3 style={{ marginTop: 14 }}>Export</h3>
      <ExportPanel d={d} />
      {d.notes && <p className="mut">{d.notes}</p>}
    </>
  );
}

export const mask: Kind<MaskD> = {
  segment: 'mask',
  title: 'Metal masks',
  noun: 'mask layout',
  defaults,
  Editor,
  Output,
  wideEditor: true,
  Visual: ({ d }) => {
    const m = norm(d);
    return (
      <DesignSvg
        w={m.sub.w}
        h={m.sub.h}
        layers={maskLayers(m, true)}
        marker={marker(m)}
        maxW={150}
        maxH={92}
        legend={false}
      />
    );
  },
  summary: (d) => {
    const a = analyzeMask(norm(d));
    return `${d.subName || 'No substrate'} · ${a.pixels.length} pixels · ${fmt(a.pixels[0]?.area ?? 0)} mm² each`;
  },
  describe: (d) => {
    const m = norm(d),
      a = analyzeMask(m);
    return {
      Substrate: m.subName || '—',
      Pixels: String(a.pixels.length),
      [m.useActual === false ? 'Pixel area (drawn)' : 'Device area per pixel']:
        a.pixels.map((p) => `P${p.n} ${fmt(p.area, 3)}`).join(', ') || '—',
      'Metal area': `${fmt(a.metalArea)} mm²`,
      'Scrape area': `${fmt(regionArea(union(allPolys(m.scrape))))} mm²`,
      Plate: `${m.plate.t} mm${m.plate.pocket ? ', pocket' : ''}${m.plate.mirror ? ', mirrored' : ''}`,
    };
  },
  runFields: (d) => [
    { key: 'maker', label: 'Mask maker / material' },
    {
      key: 'area',
      label: 'Measured pixel area',
      expected: `${fmt(analyzeMask(norm(d)).pixels[0]?.area ?? 0, 3)} mm²`,
      unit: 'mm²',
    },
  ],
};

export type { Shape };
