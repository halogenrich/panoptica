import { useEffect, useState } from 'react';
import { STYLE, structureOf, wid, type Drawing, type Run } from './structureLayout';

/** Element colours (0.57): heteroatoms coloured as in ChemDraw's default, set per theme in styles.css (`--el-*`). */
const EL = new Set(['O', 'N', 'S', 'P', 'F', 'Cl', 'Br', 'I', 'B', 'Si', 'Se', 'Li', 'Na', 'K', 'Cs', 'Co']);

function runs(r: Run[], x: number, y: number, anchor: 'start' | 'end') {
  // sub- and superscripts move off the line and back; a run after one starts on the line again
  let at = 0;
  return (
    <text x={x} y={y} textAnchor={anchor} dominantBaseline="central">
      {r.map((s, i) => {
        const to = s.k === 'sub' ? 0.3 : s.k === 'sup' ? -0.42 : 0,
          dy = to - at;
        at = to;
        return (
          <tspan key={i} dy={dy ? `${dy}em` : undefined} fontSize={s.k ? '62%' : undefined}>
            {s.t}
          </tspan>
        );
      })}
    </text>
  );
}

/**
 * A structure drawn from its SMILES (0.57), ChemDraw style. `bond` is the bond length in pixels; the picture never grows past
 * its box (max-width 100 %). Shows nothing while OpenChemLib loads or when the SMILES cannot be read (`onRead` says which).
 */
export default function Structure({
  smiles,
  bond = 26,
  maxH,
  label,
  onRead,
  className,
}: {
  smiles: string;
  bond?: number;
  /** the tallest it may be, in pixels: a tall molecule is drawn with shorter bonds */
  maxH?: number;
  label?: string;
  onRead?: (ok: boolean) => void;
  className?: string;
}) {
  const [d, setD] = useState<Drawing | null>(null);
  useEffect(() => {
    let live = true;
    structureOf(smiles).then((x) => {
      if (!live) return;
      setD(x);
      onRead?.(!!x || !smiles.trim());
    });
    return () => {
      live = false;
    };
    // onRead is a callback for the caller, not something to redraw for
  }, [smiles]);
  const b = d && maxH ? Math.min(bond, maxH / d.h) : bond;
  return d ? <StructureSvg d={d} bond={b} label={label} className={className} /> : null;
}

/** The drawing itself, for a layout already made (also used to render one outside React's effects). */
export function StructureSvg({
  d,
  bond = 26,
  label,
  className,
}: {
  d: Drawing;
  bond?: number;
  label?: string;
  className?: string;
}) {
  const f = STYLE.font;
  return (
    <svg
      className={'mol2d' + (className ? ' ' + className : '')}
      viewBox={`0 0 ${d.w.toFixed(3)} ${d.h.toFixed(3)}`}
      width={Math.round(d.w * bond)}
      role="img"
      aria-label={label ? `Structure of ${label}` : 'Structure'}
    >
      <g stroke="currentColor" strokeWidth={STYLE.stroke} strokeLinecap="round" fill="none">
        {d.lines.map((l, i) => (
          <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
        ))}
      </g>
      <g fontSize={f} fontWeight={600}>
        {d.labels.map((l, i) => {
          const half = (wid([{ t: l.sym }]) / 2) * f;
          return (
            <g key={i} className={EL.has(l.el) ? `el el-${l.el}` : 'el'}>
              {l.pre.length > 0 && runs(l.pre, l.x - half, l.y, 'end')}
              <text x={l.x} y={l.y} textAnchor="middle" dominantBaseline="central">
                {l.sym}
              </text>
              {l.post.length > 0 && runs(l.post, l.x + half, l.y, 'start')}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
