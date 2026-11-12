import { useEffect, useRef, useState } from 'react';
import { useFigureSettings } from '../../lib/figure';
import { exportSvg } from '../../lib/exportSvg';
import ExportMenu, { pngSvg, type ExportRow } from '../../lib/ExportMenu';

// ------------------------------------------------------------------ slides (16:9, for presenting)
export const SW = 1920,
  SH = 1080,
  SF = 'Inter, "Segoe UI", Helvetica, Arial, sans-serif',
  INK = '#15171a',
  MUT = '#5f6570',
  BLUE = '#2a78d6',
  ORANGE = '#eb6834',
  RULE = '#e3e5e8';
export function SlideFrame({
  title,
  sub,
  children,
  svgRef,
  compact,
  logoTop,
}: {
  title: string;
  sub: string;
  children: React.ReactNode;
  svgRef: React.Ref<SVGSVGElement>;
  /** smaller title, for slides with several figures */
  compact?: boolean;
  /** the logo in the top right corner, next to the title, leaving the bottom to the content (never the lab name: logo only) */
  logoTop?: boolean;
}) {
  const fs = useFigureSettings();
  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${SW} ${SH}`}
      width={SW}
      height={SH}
      xmlns="http://www.w3.org/2000/svg"
      fontFamily={SF}
    >
      <rect width={SW} height={SH} fill="#fff" />
      <text x={110} y={compact ? 112 : 150} fontSize={compact ? 52 : 64} fontWeight={700} fill={INK}>
        {title}
      </text>
      <text x={110} y={compact ? 162 : 210} fontSize={compact ? 28 : 32} fill={MUT}>
        {sub}
      </text>
      {children}
      {fs.watermark && (
        <image
          href={fs.watermark}
          x={SW - 330}
          y={logoTop ? 60 : SH - 130}
          width={220}
          height={logoTop ? 72 : 80}
          preserveAspectRatio={logoTop ? 'xMaxYMid meet' : 'xMaxYMax meet'}
          opacity={0.85}
        />
      )}
    </svg>
  );
}
export function SlideNumbers({ items, y }: { items: [string, string][]; y: number }) {
  const w = (SW - 220) / items.length;
  return (
    <g>
      {items.map(([k, v], i) => (
        <g key={k} transform={`translate(${110 + i * w} ${y})`}>
          <text fontSize={28} fill={MUT}>
            {k}
          </text>
          <text y={74} fontSize={64} fontWeight={600} fill={INK}>
            {v}
          </text>
        </g>
      ))}
    </g>
  );
}
/** Renders a slide off screen, exports it, then removes it. */
export function useSlide() {
  const [node, setNode] = useState<{ el: React.ReactNode; name: string; as: 'png' | 'svg' } | null>(null),
    ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (node && ref.current) {
      const r = ref.current;
      setTimeout(() => exportSvg(r, node.name, node.as).finally(() => setNode(null)), 60);
    }
  }, [node]);
  const holder = node ? (
    <div className="slide-holder" aria-hidden>
      {node.el}
    </div>
  ) : null;
  return {
    ref,
    holder,
    make: (el: React.ReactNode, name: string, as: 'png' | 'svg' = 'png') => setNode({ el, name, as }),
  };
}
/** "Export" with the slide formats inside (the shared export menu), so it does not compete with the content. */
export function SlideButtons({
  onMake,
  extra,
}: {
  onMake: (as: 'png' | 'svg') => void;
  extra?: [string, (as: 'png' | 'svg') => void];
}) {
  return (
    <ExportMenu
      sections={[
        [
          'Slide (16:9)',
          [
            [extra ? 'Summary' : 'This page', pngSvg(onMake)],
            ...(extra ? [[extra[0], pngSvg(extra[1])] as ExportRow] : []),
          ],
        ],
      ]}
    />
  );
}
