import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useRefresh } from '../lib/trash';
import { Picker, type PickOption } from './Picker';
import { chemNamed } from '@psc/core';

/** A container of a substance that is not empty (0.44). */
export type Bottle = {
  id: number;
  supplier: string;
  lot: string;
  purity: number | null;
  amount: number | null;
  unit: string;
  status: string;
  /** marked as the one recipes use */
  use: boolean;
  place: string;
};
/**
 * A substance (0.44): made from the containers; its identity, roles, hazard pictograms and controls. `bottle` is the container
 * recipes use (marked, or the newest not empty); `role`, `pur` and `brand` are what older recipe code reads: the first role, and
 * that container's purity and supplier.
 */
export type Chemical = {
  id: number;
  name: string;
  cas: string;
  /** short name, shown wherever it is set (0.54) */
  s: string;
  /** other names search finds (0.54) */
  aka: string[];
  f: string;
  /** the structure as SMILES (0.57) */
  smiles: string;
  M: number;
  d: number | null;
  mp: number | null;
  bp: number | null;
  nD: number | null;
  roles: string[];
  ghs: string[];
  pf: boolean;
  army: boolean;
  notes: string;
  bottles: Bottle[];
  bottle: Bottle | null;
  role: string;
  pur: number;
  brand: string;
};
export const ROLES = ['salt', 'solvent', 'etl', 'htl', 'additive', 'organic', 'metal', 'other'];
/** How a role is written in lists and filters. */
export const ROLE_LABEL: Record<string, string> = {
  salt: 'Salt',
  solvent: 'Solvent',
  etl: 'ETL',
  htl: 'HTL',
  additive: 'Additive',
  organic: 'Organic',
  metal: 'Metal',
  other: 'Other',
};
/** A bottle in a few words: "Sigma-Aldrich, lot X, 99.99 %". */
export const bottleText = (b: Bottle) =>
  [b.supplier || 'No supplier', b.lot && `lot ${b.lot}`, b.purity != null && `${b.purity} %`]
    .filter(Boolean)
    .join(', ');

/** Plural headings of roles, for the groups of a substance picker. */
const ROLE_GROUP: Record<string, string> = {
  salt: 'Salts',
  solvent: 'Solvents',
  etl: 'ETL',
  htl: 'HTL',
  additive: 'Additives',
  organic: 'Organic',
  metal: 'Metals',
  other: 'Other',
};
/** How a substance is shown where space is short (0.54): its short name when it has one. */
export const chemShort = (chems: Chemical[], name: string) => chemFor(chems, name)?.s || name;
/** The substance a name means (0.55.4): a recipe's PbI2 finds "Lead(II) iodide" by its short name, other names or formula. */
export const chemFor = (chems: Chemical[], name: string) => chemNamed(chems, name, (c) => c);

/**
 * The choices of a substance picker (0.54): with `roles`, the substances with one of them first, under their heading, then
 * every other one under "Other substances" (nothing is hidden, so a solvent whose role was never set can still be picked); in
 * stock before not in stock within each group.
 */
export function chemOptions(chems: Chemical[], roles?: string[]): PickOption[] {
  const one = (c: Chemical, group?: string): PickOption => ({
    value: c.name,
    label: c.name,
    short: c.s || undefined,
    other: [...c.aka, c.f, c.cas].filter(Boolean),
    hint: c.bottles.length ? undefined : 'Not in stock',
    group,
  });
  const stock = (l: Chemical[]) => [...l.filter((c) => c.bottles.length), ...l.filter((c) => !c.bottles.length)];
  if (!roles?.length) return stock(chems).map((c) => one(c));
  const has = (c: Chemical) => c.roles.some((r) => roles.includes(r));
  const head =
    roles.length === 1 ? (ROLE_GROUP[roles[0]] ?? roles[0]) : roles.map((r) => ROLE_GROUP[r] ?? r).join(', ');
  return [
    ...stock(chems.filter(has)).map((c) => one(c, head)),
    ...stock(chems.filter((c) => !has(c))).map((c) => one(c, 'Other substances')),
  ];
}

/**
 * A substance picker (0.54): type a name, short name, other name, formula or CAS number. `free`: a name not in the inventory
 * can be used (recipes may name a compound borrowed or still to be bought).
 */
export function ChemPicker({
  chems,
  value,
  onChange,
  roles,
  free = true,
  label,
  className,
  empty,
  disabled,
}: {
  chems: Chemical[];
  value: string;
  onChange: (name: string) => void;
  roles?: string[];
  free?: boolean;
  label: string;
  className?: string;
  empty?: string;
  disabled?: boolean;
}) {
  const options = useMemo(() => chemOptions(chems, roles), [chems, roles?.join()]);
  // a name the recipe has that is not (or no longer) in the inventory is still shown as it is
  return (
    <Picker
      value={value}
      options={options}
      onChange={onChange}
      free={free}
      label={label}
      className={className}
      empty={empty}
      disabled={disabled}
      placeholder="Name, short name, formula or CAS"
    />
  );
}

/** The substances, read again when the inventory changes (a container added, the bottle recipes use changed). */
export function useChems() {
  const [c, setC] = useState<Chemical[]>([]);
  const load = () => {
    api<Chemical[]>('/chemicals')
      .then(setC)
      .catch(() => {});
  };
  useEffect(load, []);
  useRefresh(load, ['inventory']);
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

/** A small dialog over the page; closes on Escape or a click outside. */
export function Dialog({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'dialog' + (wide ? ' wide' : '')} role="dialog" aria-label={title}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <button className="iconbtn" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
