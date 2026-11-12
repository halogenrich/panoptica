import { fmtDate } from '../../lib/ui';
import type { Stat } from '../../modules/types';

/** Pieces the Overview and the modules' parts of it share: periods, number formats, number cards, folded details. */
export type Unit = 'week' | 'month';
export const sod = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const startOf = (d: Date, u: Unit) =>
  u === 'month'
    ? new Date(d.getFullYear(), d.getMonth(), 1)
    : (() => {
        const x = sod(d);
        x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
        return x;
      })();
export const endOf = (s: Date, u: Unit) =>
  u === 'month'
    ? new Date(s.getFullYear(), s.getMonth() + 1, 1)
    : new Date(s.getFullYear(), s.getMonth(), s.getDate() + 7);
export const periodName = (s: Date, u: Unit) => {
  if (u === 'month') return s.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const e = new Date(endOf(s, u).getTime() - 864e5);
  return `${s.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} – ${e.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`;
};
export const tick = (iso: string, u: Unit) =>
  new Date(iso).toLocaleDateString('en-GB', u === 'month' ? { month: 'long' } : { day: '2-digit', month: '2-digit' });
export const pct = (v: number | null | undefined, d = 1) =>
  v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(d)} %`;
export const hrs = (h: number) => (h >= 10 ? `${Math.round(h)} h` : `${(Math.round(h * 2) / 2).toString()} h`);
export const seen = (iso: string | null) => {
  if (!iso) return 'never';
  const m = (Date.now() - new Date(iso).getTime()) / 6e4;
  return m < 2
    ? 'online now'
    : m < 60
      ? `${Math.round(m)} min ago`
      : m < 1440
        ? `${Math.round(m / 60)} h ago`
        : fmtDate(iso);
};
/** A few key numbers as cards: a plain label, one big value, one line of context. */
export function Stats({ items }: { items: Stat[] }) {
  return (
    <div className="ov-stats">
      {items.map((x) => (
        <div key={x.label} className={'ov-stat' + (x.tone ? ' t-' + x.tone : '')}>
          <span className="ov-stat-k">{x.label}</span>
          <b className="ov-stat-v">{x.value}</b>
          {x.note && <span className="ov-stat-n">{x.note}</span>}
        </div>
      ))}
    </div>
  );
}
export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
/** Collapsible block for the details people only sometimes want. */
export const More = ({
  title,
  count,
  children,
  open,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
  open?: boolean;
}) => (
  <details className="ov-more" open={open}>
    <summary>
      <span>{title}</span>
      {count != null && <span className="ov-count">{count}</span>}
    </summary>
    <div className="ov-more-b">{children}</div>
  </details>
);
