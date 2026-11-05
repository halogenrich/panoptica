import { useState } from 'react';
import { SHAPE_LABEL, allPolys, shapeIssues, stripResistance, unionArea, type Shape } from '@psc/core';
import { Num } from '../views/common';
import { Section } from '../recipes/shared';
import type { Kind } from '../recipes/types';
import ShapeEditor from './ShapeEditor';
import { COLORS, DesignSvg, type Marker } from './DesignSvg';
import ShapeTable from './ShapeTable';
import { useHistory } from './useHistory';

const defaults = () => ({
  w: 25,
  h: 25,
  ito: [] as Shape[],
  rs: 15,
  t: 150,
  supplier: '',
  marker: 'tl' as Marker,
  notes: '',
});
export type SubD = ReturnType<typeof defaults>;

const MARKERS: [Marker, string][] = [
  ['tl', 'Top left'],
  ['tr', 'Top right'],
  ['bl', 'Bottom left'],
  ['br', 'Bottom right'],
  ['none', 'None'],
];
const fmt = (v: number, d = 2) => (Math.round(v * 10 ** d) / 10 ** d).toString();
export const itoArea = (d: SubD) => unionArea(allPolys(d.ito));
export const subLayers = (d: SubD) => [{ polys: allPolys(d.ito), fill: COLORS.ito, opacity: 0.6, label: 'ITO' }];

/** Canvas with the ITO layer + side panel with glass, film, exact numbers and results. */
function Editor({ d, set }: { d: SubD; set: (p: Partial<SubD>) => void }) {
  const [sel, setSel] = useState<string | null>(null);
  const hist = useHistory<SubD>(d, (v) => set(v));
  const shapes = (ito: Shape[], commit = true) => hist.apply({ ...d, ito }, commit);
  const area = itoArea(d),
    glass = d.w * d.h,
    problems = d.ito.flatMap((s, i) => shapeIssues(s, d.w, d.h).map((p) => `Shape ${i + 1} ${p}`));
  return (
    <div className="designer">
      <ShapeEditor
        w={d.w}
        h={d.h}
        marker={d.marker}
        shapes={d.ito}
        color={COLORS.ito}
        onChange={shapes}
        sel={sel}
        setSel={setSel}
        undo={hist.undo}
        redo={hist.redo}
        canUndo={hist.canUndo}
        canRedo={hist.canRedo}
      />
      <aside className="designer-side">
        <Section title="Glass">
          <label className="row">
            <span>Width (mm)</span>
            <Num v={d.w} on={(w) => hist.apply({ ...d, w: Math.max(1, w) })} />
          </label>
          <label className="row">
            <span>Height (mm)</span>
            <Num v={d.h} on={(h) => hist.apply({ ...d, h: Math.max(1, h) })} />
          </label>
          <label className="row">
            <span>Orientation mark</span>
            <select value={d.marker} onChange={(e) => hist.apply({ ...d, marker: e.target.value as Marker })}>
              {MARKERS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </Section>
        <Section title="ITO film">
          <label className="row">
            <span>Sheet resistance (Ω/sq)</span>
            <Num v={d.rs} on={(rs) => hist.apply({ ...d, rs })} />
          </label>
          <label className="row">
            <span>Thickness (nm)</span>
            <Num v={d.t} on={(t) => hist.apply({ ...d, t })} />
          </label>
          <label className="row">
            <span>Supplier</span>
            <input value={d.supplier} onChange={(e) => set({ supplier: e.target.value })} style={{ width: 160 }} />
          </label>
        </Section>
        <Section title={`ITO areas (${d.ito.length})`}>
          <ShapeTable shapes={d.ito} w={d.w} h={d.h} selected={sel} onSelect={setSel} onChange={(s) => shapes(s)} />
        </Section>
        <Section title="Results">
          <div className="kv">
            <span>ITO area</span>
            <b>{fmt(area)} mm²</b>
          </div>
          <div className="kv">
            <span>ITO-free glass</span>
            <b>
              {fmt(glass - area)} mm² ({fmt((1 - area / glass) * 100, 1)} %)
            </b>
          </div>
          {d.ito
            .filter((s) => !s.repeat)
            .map((s) => {
              const r = stripResistance(s, d.rs);
              return (
                <div className="kv" key={s.id}>
                  <span>
                    Shape {d.ito.indexOf(s) + 1}, end to end ({r.axis === 'x' ? 'horizontal' : 'vertical'})
                  </span>
                  <b>
                    {fmt(r.ohm, 1)} Ω <span className="mut">({fmt(r.squares, 2)} sq)</span>
                  </b>
                </div>
              );
            })}
          {problems.length > 0 && <p className="err small">{problems.join('. ')}.</p>}
        </Section>
        <Section title="Notes">
          <textarea
            value={d.notes}
            onChange={(e) => set({ notes: e.target.value })}
            placeholder="Cleaning remarks, batch, where it is stored…"
          />
        </Section>
      </aside>
    </div>
  );
}

function Output({ d }: { d: SubD }) {
  const area = itoArea(d);
  return (
    <>
      <p className="headline">
        {d.w} × {d.h} mm{' '}
        <span className="mut">
          · ITO {fmt(area)} mm² · {d.rs} Ω/sq
        </span>
      </p>
      <DesignSvg w={d.w} h={d.h} layers={subLayers(d)} marker={d.marker} maxW={560} maxH={380} dims />
      <table>
        <thead>
          <tr>
            <th>Shape</th>
            <th>Area</th>
            <th>End-to-end resistance</th>
          </tr>
        </thead>
        <tbody>
          {d.ito.map((s, i) => {
            const r = stripResistance(s, d.rs);
            return (
              <tr key={s.id}>
                <td>
                  {i + 1}. {SHAPE_LABEL[s.kind]}
                  {s.repeat ? ` × ${s.repeat.nx * s.repeat.ny}` : ''}
                </td>
                <td>{fmt(unionArea(allPolys([s])))} mm²</td>
                <td>{s.repeat ? '—' : `${fmt(r.ohm, 1)} Ω`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {d.notes && <p className="mut">{d.notes}</p>}
    </>
  );
}

export const substrate: Kind<SubD> = {
  segment: 'sub',
  title: 'Substrates',
  noun: 'substrate',
  defaults,
  Editor,
  Output,
  wideEditor: true,
  Visual: ({ d }) => (
    <DesignSvg w={d.w} h={d.h} layers={subLayers(d)} marker={d.marker} maxW={150} maxH={92} legend={false} />
  ),
  summary: (d) => `${d.w} × ${d.h} mm · ITO ${fmt(itoArea(d), 1)} mm² · ${d.rs} Ω/sq`,
  describe: (d) => ({
    Glass: `${d.w} × ${d.h} mm`,
    'ITO area': `${fmt(itoArea(d))} mm²`,
    'ITO shapes': d.ito.map((s) => SHAPE_LABEL[s.kind]).join(', ') || 'none',
    'Sheet resistance': `${d.rs} Ω/sq`,
    Thickness: `${d.t} nm`,
    ...(d.supplier ? { Supplier: d.supplier } : {}),
    'Orientation mark': MARKERS.find((m) => m[0] === d.marker)?.[1] ?? '',
  }),
  runFields: (d) => [
    { key: 'rs', label: 'Measured sheet resistance', expected: `${d.rs} Ω/sq`, unit: 'Ω/sq' },
    { key: 'lot', label: 'Lot / box' },
    { key: 'n', label: 'Pieces used' },
  ],
};
