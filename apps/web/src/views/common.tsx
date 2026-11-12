import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

export type Chemical = {
  id: number;
  name: string;
  role: string;
  f: string;
  M: number;
  d: number | null;
  pur: number;
  brand: string;
};
export const ROLES = ['salt', 'solvent', 'etl', 'htl', 'additive', 'organic', 'metal', 'other'];

export function useChems() {
  const [c, setC] = useState<Chemical[]>([]);
  useEffect(() => {
    api<Chemical[]>('/chemicals').then(setC);
  }, []);
  return c;
}

/**
 * Drag-to-reorder for a list: give each row `rowRef(i)` and its handle `handle(i)`. Works with mouse, touch and pen;
 * with the handle focused, the arrow keys move the row.
 */
export function useReorder<T>(list: T[], onChange: (l: T[]) => void, noun = 'step') {
  const [drag, setDrag] = useState<number | null>(null);
  const rows = useRef<(HTMLElement | null)[]>([]),
    cur = useRef<number | null>(null),
    latest = useRef(list);
  latest.current = list;
  const move = (from: number, to: number) => {
    const l = [...latest.current],
      [x] = l.splice(from, 1);
    l.splice(to, 0, x);
    latest.current = l;
    onChange(l);
  };
  const handle = (i: number) => ({
    className: 'drag-handle',
    role: 'button',
    tabIndex: 0,
    'aria-label': `Move ${noun} ${i + 1} (drag, or arrow keys)`,
    title: 'Drag to reorder',
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      cur.current = i;
      setDrag(i);
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const from = cur.current;
      if (from === null) return;
      const mids = rows.current.slice(0, latest.current.length).map((r) => {
        const b = r?.getBoundingClientRect();
        return b ? b.top + b.height / 2 : 0;
      });
      let to = mids.filter((m) => e.clientY > m).length;
      if (to > from) to -= 1; // index among the rows without the dragged one
      to = Math.max(0, Math.min(latest.current.length - 1, to));
      if (to !== from) {
        move(from, to);
        cur.current = to;
        setDrag(to);
      }
    },
    onPointerUp: () => {
      cur.current = null;
      setDrag(null);
    },
    onPointerCancel: () => {
      cur.current = null;
      setDrag(null);
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      const to = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : -1;
      if (to < 0 || to >= list.length) return;
      e.preventDefault();
      move(i, to);
      requestAnimationFrame(() => (rows.current[to]?.querySelector('.drag-handle') as HTMLElement | null)?.focus());
    },
  });
  const rowRef = (i: number) => (el: HTMLElement | null) => {
    rows.current[i] = el;
  };
  return { drag, handle, rowRef };
}

/** The handle of a reorderable row (from `useReorder().handle(i)`), shown only when there is something to reorder. */
export const DragHandle = ({
  h,
  show = true,
}: {
  h: ReturnType<ReturnType<typeof useReorder>['handle']>;
  show?: boolean;
}) =>
  show ? (
    <span {...h}>
      <Grip />
    </span>
  ) : (
    <span className="drag-space" aria-hidden />
  );
/** Remove a row of a list: the same small ✕ everywhere. */
export const RemoveRow = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button type="button" className="iconbtn rm" aria-label={label} title="Remove" onClick={onClick}>
    ✕
  </button>
);
export const Grip = () => (
  <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
    {[3, 8, 13].flatMap((y) => [2.5, 7.5].map((x) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.4" />))}
  </svg>
);

export function Num({ v, on, w }: { v: number; on: (n: number) => void; w?: number }) {
  const [txt, setTxt] = useState(String(v ?? '')),
    last = useRef(v);
  useEffect(() => {
    if (v !== last.current) {
      last.current = v;
      setTxt(String(v ?? ''));
    }
  }, [v]);
  return (
    <input
      inputMode="decimal"
      value={txt}
      style={w ? { width: w } : undefined}
      onChange={(e) => {
        const t = e.target.value.replace(',', '.');
        setTxt(t);
        const n = parseFloat(t);
        if (isFinite(n)) {
          last.current = n;
          on(n);
        } else if (t === '') {
          last.current = 0;
          on(0);
        }
      }}
    />
  );
}
export const Check = ({ v, on }: { v: boolean; on: (b: boolean) => void }) => (
  <input type="checkbox" checked={v} onChange={(e) => on(e.target.checked)} />
);
