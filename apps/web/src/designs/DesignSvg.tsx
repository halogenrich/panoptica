import type { Poly, Pt } from '@psc/core';

export type Marker = 'tl' | 'tr' | 'bl' | 'br' | 'none';
export interface Layer {
  polys: Poly[];
  fill: string;
  opacity?: number;
  stroke?: string;
  label?: string;
  dash?: boolean;
  evenodd?: boolean;
}

export const COLORS = { glass: 'var(--glass)', ito: '#4f86e8', metal: '#2ea043', scrape: '#e5484d', active: '#e8a33a' };

/** Drawing colours of the evaporated metals (fill, outline). Unknown metals are grey. */
const METAL_COLORS: Record<string, [string, string]> = {
  au: ['#d4af37', '#8a6d12'],
  ag: ['#c3c8cf', '#6e757d'],
  cu: ['#b87333', '#7a4a1e'],
  al: ['#b4bac1', '#666d75'],
};
export const metalColor = (met?: string) => METAL_COLORS[(met ?? '').toLowerCase()] ?? ['#b0b4ba', '#666b72'];

export const path = (ps: Poly[]) =>
  ps.map((p) => 'M' + p.map(([x, y]) => `${+x.toFixed(4)},${+y.toFixed(4)}`).join('L') + 'Z').join('');

/** Orientation mark: a small triangle in one glass corner. */
export function markerPoly(m: Marker, w: number, h: number): Poly | null {
  const s = Math.min(w, h) * 0.12;
  switch (m) {
    case 'tl':
      return [
        [0, 0],
        [s, 0],
        [0, s],
      ];
    case 'tr':
      return [
        [w, 0],
        [w - s, 0],
        [w, s],
      ];
    case 'bl':
      return [
        [0, h],
        [s, h],
        [0, h - s],
      ];
    case 'br':
      return [
        [w, h],
        [w - s, h],
        [w, h - s],
      ];
    default:
      return null;
  }
}

/** Static drawing of a glass substrate with layers, scaled to fit a box. */
export function DesignSvg({
  w,
  h,
  layers,
  marker = 'none',
  maxW = 320,
  maxH = 220,
  legend = true,
  dims = false,
  labels = [],
}: {
  w: number;
  h: number;
  layers: Layer[];
  marker?: Marker;
  maxW?: number;
  maxH?: number;
  legend?: boolean;
  dims?: boolean;
  labels?: { at: Pt; text: string }[];
}) {
  const pad = dims ? Math.max(w, h) * 0.1 : Math.max(w, h) * 0.02,
    k = Math.min(maxW / (w + 2 * pad), maxH / (h + 2 * pad)),
    mk = markerPoly(marker, w, h);
  const named = layers.filter((l) => l.label && l.polys.length);
  return (
    <figure className="design-svg">
      <svg
        width={(w + 2 * pad) * k}
        height={(h + 2 * pad) * k}
        viewBox={`${-pad} ${-pad} ${w + 2 * pad} ${h + 2 * pad}`}
        role="img"
        aria-label="Substrate drawing"
      >
        <rect
          x={0}
          y={0}
          width={w}
          height={h}
          fill={COLORS.glass}
          stroke="var(--mut)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        {layers.map((l, i) => (
          <path
            key={i}
            d={path(l.polys)}
            fill={l.fill}
            fillOpacity={l.opacity ?? 0.6}
            stroke={l.stroke ?? 'none'}
            strokeWidth={1}
            fillRule={l.evenodd ? 'evenodd' : undefined}
            strokeDasharray={l.dash ? '4 3' : undefined}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {mk && <path d={path([mk])} fill="var(--fg)" opacity={0.55} />}
        {labels.map((l, i) => (
          <text
            key={i}
            x={l.at[0]}
            y={l.at[1]}
            fontSize={Math.max(w, h) * 0.038}
            textAnchor="middle"
            dominantBaseline="central"
            className="svg-label"
          >
            {l.text}
          </text>
        ))}
        {dims && (
          <>
            <text x={w / 2} y={-pad * 0.3} fontSize={pad * 0.5} textAnchor="middle" fill="var(--mut)">
              {w} mm
            </text>
            <text
              x={-pad * 0.3}
              y={h / 2}
              fontSize={pad * 0.5}
              textAnchor="middle"
              fill="var(--mut)"
              transform={`rotate(-90 ${-pad * 0.3} ${h / 2})`}
            >
              {h} mm
            </text>
          </>
        )}
      </svg>
      {legend && named.length > 0 && (
        <figcaption className="legend">
          {[{ label: 'ITO-free glass', fill: COLORS.glass, opacity: 1 }, ...named].map((l) => (
            <span key={l.label}>
              <i style={{ background: l.fill, opacity: (l.opacity ?? 0.6) + 0.2 }} />
              {l.label}
            </span>
          ))}
        </figcaption>
      )}
    </figure>
  );
}
