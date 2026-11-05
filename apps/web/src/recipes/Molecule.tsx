import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Mol } from './molecules';

// CPK-like colours (fill, outline) and ball radii in Å for a ball-and-stick model
const EL: Record<string, [string, string, number]> = {
  C: ['#5d636b', '#2f3338', 0.34],
  H: ['#f4f5f7', '#9aa0a6', 0.2],
  N: ['#3d6fe0', '#1f3f8c', 0.34],
  O: ['#e5483f', '#8c2520', 0.33],
  S: ['#e8c23a', '#8a6f12', 0.4],
  P: ['#f08c2e', '#8a4d12', 0.4],
  F: ['#7fd36b', '#3c7a2f', 0.3],
};
const el = (e: string) => EL[e] ?? ['#c06bd6', '#6b2f7a', 0.36];

type Rot = { yaw: number; pitch: number };
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Ball-and-stick molecule drawn in SVG (no WebGL, so many can be on screen). Depth-sorted shaded balls and two-tone bonds.
 * `spin` turns slowly; `interactive` lets the user drag to rotate (horizontal drags only on touch, so the page still scrolls).
 */
export default function Molecule({
  mol,
  size = 120,
  spin = false,
  interactive = false,
  hydrogens = true,
  fit = false,
  label,
}: {
  mol: Mol;
  size?: number;
  spin?: boolean;
  interactive?: boolean;
  hydrogens?: boolean;
  fit?: boolean;
  label?: string;
}) {
  const uid = useId().replace(/:/g, ''),
    [rot, setRot] = useState<Rot>({ yaw: 0.55, pitch: -0.42 }),
    drag = useRef<{ x: number; y: number; r: Rot } | null>(null);
  const keep = useMemo(() => mol.atoms.map((a) => hydrogens || a[0] !== 'H'), [mol, hydrogens]);
  const R = useMemo(() => Math.max(...mol.atoms.map(([, x, y, z]) => Math.hypot(x, y, z))) + 0.6, [mol]);

  useEffect(() => {
    if (!spin || reduced()) return;
    let raf = 0,
      last = performance.now();
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (drag.current || document.hidden) {
        last = t;
        return;
      }
      const dt = Math.min(64, t - last);
      last = t;
      setRot((r) => ({ ...r, yaw: r.yaw + dt * 0.00035 }));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spin]);

  const cy = Math.cos(rot.yaw),
    sy = Math.sin(rot.yaw),
    cp = Math.cos(rot.pitch),
    sp = Math.sin(rot.pitch);
  const Q = mol.atoms.map(([, x, y, z]) => {
    // yaw about y, then pitch about x; mild perspective
    const x1 = x * cy + z * sy,
      z1 = -x * sy + z * cy,
      y1 = y * cp - z1 * sp,
      z2 = y * sp + z1 * cp,
      f = 1 + z2 / (R * 9);
    return { x: x1 * f, y: -y1 * f, z: z2, f };
  });
  // spinning views scale by the 3D radius (no size change while turning); still pictures fill the box with what is visible
  let k = size / (2 * R),
    ox = 0,
    oy = 0;
  if (fit) {
    const v = Q.filter((_, i) => keep[i]),
      x0 = Math.min(...v.map((q) => q.x)),
      x1 = Math.max(...v.map((q) => q.x)),
      y0 = Math.min(...v.map((q) => q.y)),
      y1 = Math.max(...v.map((q) => q.y));
    k = (size * 0.9) / (Math.max(x1 - x0, y1 - y0) + 0.8);
    ox = -(x0 + x1) / 2;
    oy = -(y0 + y1) / 2;
  }
  const P = Q.map((q) => ({ x: (q.x + ox) * k, y: (q.y + oy) * k, z: q.z, f: q.f }));
  type Item = { z: number; node: JSX.Element };
  const items: Item[] = [];
  mol.bonds.forEach(([i, j, o], n) => {
    if (!keep[i] || !keep[j]) return;
    const a = P[i],
      b = P[j],
      mx = (a.x + b.x) / 2,
      my = (a.y + b.y) / 2,
      w = ((o >= 2 ? 0.17 : o > 1 ? 0.15 : 0.13) * k * (a.f + b.f)) / 2;
    for (const [p, e, key] of [
      [a, mol.atoms[i][0], 'a'],
      [b, mol.atoms[j][0], 'b'],
    ] as const)
      items.push({
        z: (p.z + (a.z + b.z) / 2) / 2 - 0.01,
        node: (
          <line
            key={`b${n}${key}`}
            x1={p.x}
            y1={p.y}
            x2={mx}
            y2={my}
            stroke={el(e)[0]}
            strokeWidth={w}
            strokeLinecap="round"
          />
        ),
      });
  });
  P.forEach((p, i) => {
    if (!keep[i]) return;
    const e = mol.atoms[i][0],
      [, line, r] = el(e);
    items.push({
      z: p.z,
      node: (
        <circle
          key={'a' + i}
          cx={p.x}
          cy={p.y}
          r={r * k * p.f}
          fill={`url(#${uid}${e in EL ? e : 'X'})`}
          stroke={line}
          strokeOpacity={0.5}
          strokeWidth={Math.max(0.4, 0.02 * k)}
        />
      ),
    });
  });
  items.sort((a, b) => a.z - b.z);

  const down = (e: React.PointerEvent) => {
    if (!interactive) return;
    drag.current = { x: e.clientX, y: e.clientY, r: rot };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const touch = e.pointerType === 'touch';
    setRot({
      yaw: d.r.yaw + (e.clientX - d.x) * 0.012,
      pitch: touch ? d.r.pitch : Math.max(-1.5, Math.min(1.5, d.r.pitch + (e.clientY - d.y) * 0.012)),
    });
  };
  const up = () => {
    drag.current = null;
  };
  const els = [...new Set(mol.atoms.map((a) => (a[0] in EL ? a[0] : 'X')))];
  return (
    <svg
      className={'molecule' + (interactive ? ' interactive' : '')}
      width={size}
      height={size}
      viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`}
      role="img"
      aria-label={label ?? `${mol.name} (${mol.formula}) 3D structure`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <defs>
        {els.map((e) => {
          const [fill, dark] = e === 'X' ? el('?') : el(e);
          return (
            <radialGradient key={e} id={uid + e} cx="36%" cy="32%" r="72%">
              <stop offset="0%" stopColor="#fff" stopOpacity={0.9} />
              <stop offset="30%" stopColor={fill} />
              <stop offset="88%" stopColor={dark} />
            </radialGradient>
          );
        })}
      </defs>
      {items.map((i) => i.node)}
    </svg>
  );
}
