import { SHAPE_LABEL, explode, outline, polyArea, polys, shapeIssues, type Shape } from '@psc/core';
import { Grip, Num, useReorder } from '../views/common';

type F = [string, string]; // [property, label]
const FIELDS: Record<Shape['kind'], F[]> = {
  rect: [['x', 'X'], ['y', 'Y'], ['w', 'Width'], ['h', 'Height']],
  para: [['x', 'X'], ['y', 'Y'], ['w', 'Width'], ['h', 'Height'], ['skew', 'Skew']],
  trap: [['x', 'X'], ['y', 'Y'], ['wb', 'Bottom width'], ['wt', 'Top width'], ['off', 'Top offset'], ['h', 'Height']],
  quad: [],
};
const r2 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Exact numbers for each shape: position and size in mm, optional repeat array, and problems. Drag the handle to reorder.
 * With `pixels`, the shapes are pixels: numbered P1, P2… in list order (array copies row by row), and an array can be split
 * into separate pixels.
 */
export default function ShapeTable({ shapes, w, h, selected, onSelect, onChange, extra, pixels }: {
  shapes: Shape[]; w: number; h: number; selected: string | null; onSelect: (id: string) => void; onChange: (s: Shape[]) => void;
  extra?: (s: Shape) => React.ReactNode; pixels?: boolean;
}) {
  const up = (s: Shape) => onChange(shapes.map((x) => (x.id === s.id ? s : x)));
  const { drag, handle, rowRef } = useReorder(shapes, onChange);
  if (!shapes.length) return <p className="mut small">No shapes yet. Pick a shape in the toolbar and drag on the glass.</p>;
  let next = 1;
  return (
    <div className="shape-list">
      {shapes.map((s, n) => {
        const issues = shapeIssues(s, w, h), area = polyArea(outline(s)), copies = polys(s).length;
        const p0 = next; next += copies;
        const name = pixels ? (copies > 1 ? `P${p0}–P${p0 + copies - 1}` : `P${p0}`) : `${n + 1}.`;
        const split = () => {
          if (!window.confirm(`Turn this array into ${copies} separate pixels (${name})? Each can then be moved and reordered on its own.`)) return;
          onChange(shapes.flatMap((x) => (x.id === s.id ? explode(x) : [x])));
        };
        return (
          <div key={s.id} ref={rowRef(n)} className={'shape-item' + (s.id === selected ? ' on' : '') + (drag === n ? ' dragging' : '')} onClick={() => onSelect(s.id)}>
            <div className="shape-head">
              {shapes.length > 1 && <span {...handle(n)} onClick={(e) => e.stopPropagation()}><Grip /></span>}
              <b>{name} {SHAPE_LABEL[s.kind]}</b>
              <span className="mut small">{r2(area)} mm²{copies > 1 ? ` × ${copies}` : ''}</span>
              <div className="grow" />
              <button className="link" onClick={(e) => { e.stopPropagation(); onChange(shapes.filter((x) => x.id !== s.id)); }}>Remove</button>
            </div>
            <div className="fields">
              {s.kind === 'quad'
                ? s.pts.map((p, i) => (
                  <label key={i}><span>Corner {i + 1}</span><span className="pair">
                    <Num v={r2(p[0])} on={(x) => up({ ...s, pts: s.pts.map((q, j) => (j === i ? [x, q[1]] : q)) as typeof s.pts })} />
                    <Num v={r2(p[1])} on={(y) => up({ ...s, pts: s.pts.map((q, j) => (j === i ? [q[0], y] : q)) as typeof s.pts })} />
                  </span></label>))
                : FIELDS[s.kind].map(([k, l]) => (
                  <label key={k}><span>{l}</span><Num v={r2((s as any)[k])} on={(val) => up({ ...s, [k]: val } as Shape)} /></label>))}
            </div>
            <label className="inline small" onClick={(e) => e.stopPropagation()}>
              <input type="checkbox" checked={!!s.repeat} onChange={(e) => up({ ...s, repeat: e.target.checked ? { nx: 2, ny: 1, px: 3, py: 3 } : undefined })} /> Repeat as array
            </label>
            {s.repeat && (
              <div className="fields">
                <label><span>Columns</span><Num v={s.repeat.nx} on={(nx) => up({ ...s, repeat: { ...s.repeat!, nx: Math.max(1, Math.round(nx)) } })} /></label>
                <label><span>Rows</span><Num v={s.repeat.ny} on={(ny) => up({ ...s, repeat: { ...s.repeat!, ny: Math.max(1, Math.round(ny)) } })} /></label>
                <label><span>Pitch x</span><Num v={s.repeat.px} on={(px) => up({ ...s, repeat: { ...s.repeat!, px } })} /></label>
                <label><span>Pitch y</span><Num v={s.repeat.py} on={(py) => up({ ...s, repeat: { ...s.repeat!, py } })} /></label>
              </div>
            )}
            {pixels && copies > 1 && <button className="link small" onClick={(e) => { e.stopPropagation(); split(); }}>Confirm array as {copies} separate pixels</button>}
            {extra?.(s)}
            {issues.length > 0 && <p className="err small">This shape {issues.join(' and ')}.</p>}
          </div>
        );
      })}
    </div>
  );
}
