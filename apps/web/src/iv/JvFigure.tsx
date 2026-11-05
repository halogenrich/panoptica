import { useEffect, useRef, useState } from 'react';
import { useFigureSettings } from '../lib/figure';
import { deviceInfo, fmt, type Curve, type Link } from './model';

/**
 * J–V figure in journal style, for viewing and export: 7 × 5, closed frame with inward ticks, V 0–1.2 V by 0.2,
 * J 0–30 mA/cm² by 5 (extended only if the data go beyond), forward solid and backward dashed in the same colour,
 * the device's layer order and architecture, the best scan of the pixel with PCE, FF, Voc, Jsc and Vmpp, and the group watermark.
 */
const FW = 700,
  FH = 500,
  L = 82,
  R = 22,
  T = 48,
  B = 66,
  PW = FW - L - R,
  PH = FH - T - B;
const INK = '#111',
  GRID = '#b8b8b8',
  LINE = '#d7263d',
  FONT = 'Inter, "Segoe UI", Helvetica, Arial, sans-serif';

/** Text with chemical subscripts (digits after letters or ")"), as SVG tspans. */
function Chem({ text, size }: { text: string; size: number }) {
  const parts = text.split(/((?<=[A-Za-z)\]])\d+(?:\.\d+)?)/);
  const sub = size * 0.68,
    dy = size * 0.3;
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <tspan key={i} fontSize={sub} dy={dy}>
            {p}
          </tspan>
        ) : (
          <tspan key={i} fontSize={size} dy={i > 0 && parts[i - 1] ? -dy : 0}>
            {p}
          </tspan>
        ),
      )}
    </>
  );
}

export function JvFigure({
  curves,
  best,
  title,
  link,
  svgRef,
  logo = true,
}: {
  curves: Curve[];
  best: Curve | undefined;
  title: string;
  link: Link;
  svgRef?: React.Ref<SVGSVGElement>;
  logo?: boolean;
}) {
  const fs = useFigureSettings(),
    wm = logo ? fs.watermark : '',
    grp = logo ? fs.group : '',
    [info, setInfo] = useState<{ arch: string; layers: string[] } | null>(null);
  useEffect(() => {
    let on = true;
    deviceInfo(link).then((d) => on && setInfo(d));
    return () => {
      on = false;
    };
  }, [link?.kind, link?.id]);
  const jmax = Math.max(0, ...curves.flatMap((c) => c.J.filter((j, i) => c.V[i] >= -0.05 && Number.isFinite(j))));
  const vmax = Math.max(0, ...curves.map((c) => (Number.isFinite(c.m.voc) ? c.m.voc : 0)));
  const X1 = Math.max(1.2, Math.ceil((vmax + 0.05) / 0.2) * 0.2),
    Y1 = Math.max(30, Math.ceil((jmax + 2) / 5) * 5);
  const X = (v: number) => L + (v / X1) * PW,
    Y = (j: number) => T + PH - (j / Y1) * PH;
  const xt = Array.from({ length: Math.round(X1 / 0.2) + 1 }, (_, i) => +(i * 0.2).toFixed(1)),
    yt = Array.from({ length: Y1 / 5 + 1 }, (_, i) => i * 5);
  const path = (c: Curve) =>
    c.V.map((v, i) => [v, c.J[i]] as const)
      .filter(([v, j]) => Number.isFinite(v) && Number.isFinite(j))
      .map(([v, j], i) => `${i ? 'L' : 'M'}${X(v).toFixed(1)},${Y(Math.max(-Y1, Math.min(Y1 * 2, j))).toFixed(1)}`)
      .join('');
  const stack = info?.layers.length ? info.layers.join('/') : '';
  const arch = info?.arch ? info.arch : '';
  const dirName = (c: Curve) => (c.dir === 'rev' ? 'Backward' : 'Forward');
  const clip = useRef(`f${Math.random().toString(36).slice(2)}`).current;
  const lines = best
    ? [
        `Scan: ${dirName(best)}${best.scan ? ` (scan ${best.scan})` : ''}`,
        `PCE: ${fmt(best.m.pce)}%`,
        `FF: ${fmt(best.m.ff)}%`,
        `Voc: ${fmt(best.m.voc, 3)} V`,
        `Jsc: ${fmt(best.m.jsc)} mA/cm²`,
        `Vmpp: ${fmt(best.m.vmp, 3)} V`,
      ]
    : ['No working scan'];
  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${FW} ${FH}`}
      width={FW}
      height={FH}
      className="jv-figure"
      xmlns="http://www.w3.org/2000/svg"
      fontFamily={FONT}
      role="img"
      aria-label={`${title}. ${lines.join(', ')}${stack ? `. Device ${arch} ${stack}` : ''}`}
    >
      <rect x={0} y={0} width={FW} height={FH} fill="#fff" />
      <defs>
        <clipPath id={clip}>
          <rect x={L} y={T} width={PW} height={PH} />
        </clipPath>
      </defs>
      <text x={L + PW / 2} y={30} fontSize={21} textAnchor="middle" fill={INK}>
        {title}
      </text>
      {xt.map((t) => (
        <line
          key={'gx' + t}
          x1={X(t)}
          x2={X(t)}
          y1={T}
          y2={T + PH}
          stroke={GRID}
          strokeDasharray="4 4"
          strokeWidth={0.8}
        />
      ))}
      {yt.map((t) => (
        <line
          key={'gy' + t}
          x1={L}
          x2={L + PW}
          y1={Y(t)}
          y2={Y(t)}
          stroke={GRID}
          strokeDasharray="4 4"
          strokeWidth={0.8}
        />
      ))}
      {/* group mark in the empty area under the curve, between the numbers and the Voc drop */}
      {wm && (
        <image
          href={wm}
          x={L + PW * 0.5 - 80}
          y={T + PH - (grp ? 96 : 78)}
          width={160}
          height={62}
          opacity={0.3}
          preserveAspectRatio="xMidYMax meet"
        />
      )}
      {grp && (
        <text x={L + PW * 0.5} y={T + PH - 16} fontSize={12.5} textAnchor="middle" fill={INK} opacity={0.5}>
          {grp}
        </text>
      )}
      <g clipPath={`url(#${clip})`}>
        {curves.map((c) => (
          <path
            key={c.id}
            d={path(c)}
            fill="none"
            stroke={LINE}
            strokeWidth={2.2}
            strokeDasharray={c.dir === 'rev' ? '8 5' : undefined}
            strokeLinejoin="round"
          />
        ))}
        {best && Number.isFinite(best.m.vmp) && (
          <circle cx={X(best.m.vmp)} cy={Y(best.m.jmp)} r={4.5} fill={LINE} stroke="#fff" strokeWidth={1.5} />
        )}
      </g>
      <rect x={L} y={T} width={PW} height={PH} fill="none" stroke={INK} strokeWidth={1.6} />
      {xt.map((t) => (
        <g key={'tx' + t}>
          <line x1={X(t)} x2={X(t)} y1={T + PH} y2={T + PH - 7} stroke={INK} strokeWidth={1.4} />
          <line x1={X(t)} x2={X(t)} y1={T} y2={T + 7} stroke={INK} strokeWidth={1.4} />
          <text x={X(t)} y={T + PH + 22} fontSize={16} textAnchor="middle" fill={INK}>
            {t.toFixed(1)}
          </text>
        </g>
      ))}
      {xt.slice(0, -1).map((t) => (
        <g key={'mx' + t}>
          <line x1={X(t + 0.1)} x2={X(t + 0.1)} y1={T + PH} y2={T + PH - 4} stroke={INK} />
          <line x1={X(t + 0.1)} x2={X(t + 0.1)} y1={T} y2={T + 4} stroke={INK} />
        </g>
      ))}
      {yt.map((t) => (
        <g key={'ty' + t}>
          <line x1={L} x2={L + 7} y1={Y(t)} y2={Y(t)} stroke={INK} strokeWidth={1.4} />
          <line x1={L + PW} x2={L + PW - 7} y1={Y(t)} y2={Y(t)} stroke={INK} strokeWidth={1.4} />
          <text x={L - 10} y={Y(t)} fontSize={16} textAnchor="end" dominantBaseline="central" fill={INK}>
            {t}
          </text>
        </g>
      ))}
      <text x={L + PW / 2} y={FH - 16} fontSize={19} textAnchor="middle" fill={INK}>
        Voltage (V)
      </text>
      <text transform={`translate(26 ${T + PH / 2}) rotate(-90)`} fontSize={19} textAnchor="middle" fill={INK}>
        J (mA/cm²)
      </text>
      {stack && (
        <text x={L + PW / 2} y={T + 24} fontSize={14} textAnchor="middle" fill={INK}>
          {arch && <tspan fontWeight={600}>{arch}: </tspan>}
          <Chem text={stack} size={14} />
        </text>
      )}
      <g transform={`translate(${L + PW - 150} ${T + (stack ? 44 : 22)})`} fontSize={13} fill={INK}>
        <line x1={0} x2={30} y1={0} y2={0} stroke={LINE} strokeWidth={2.2} />
        <text x={38} y={0} dominantBaseline="central">
          Forward
        </text>
        <line x1={0} x2={30} y1={20} y2={20} stroke={LINE} strokeWidth={2.2} strokeDasharray="8 5" />
        <text x={38} y={20} dominantBaseline="central">
          Backward
        </text>
      </g>
      <g fontSize={17} fill={INK}>
        {lines.map((l, i) => (
          <text key={i} x={L + 18} y={T + PH - 20 - (lines.length - 1 - i) * 24}>
            {l}
          </text>
        ))}
      </g>
    </svg>
  );
}

/** Downloads an SVG element as .svg, or as a white-background PNG at 3× for slides and papers. */
export async function exportSvg(svg: SVGSVGElement, name: string, as: 'svg' | 'png') {
  const xml = new XMLSerializer().serializeToString(svg),
    blob = new Blob([xml], { type: 'image/svg+xml' });
  const save = (b: Blob, ext: string) => {
    const a = document.createElement('a'),
      u = URL.createObjectURL(b);
    a.href = u;
    a.download = `${name}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 2000);
  };
  if (as === 'svg') return save(blob, 'svg');
  const img = new Image(),
    url = URL.createObjectURL(blob);
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('could not render the figure'));
    img.src = url;
  });
  const vb = svg.viewBox.baseVal,
    k = 3,
    c = document.createElement('canvas');
  c.width = (vb?.width || FW) * k;
  c.height = (vb?.height || FH) * k;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  c.toBlob((b) => b && save(b, 'png'), 'image/png');
}
