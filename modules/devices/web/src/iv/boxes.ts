import { SERIES, hasValue, summarize, type Dir, type MetricKey, type StatRow } from './model';
import type { BoxGroup } from './charts';

/** Box-plot inputs from statistics rows: one group per batch (or custom group), one series per scan direction. */
export function groupsOf(rows: StatRow[]) {
  const g: { key: string; label: string; rows: StatRow[] }[] = [];
  for (const r of rows) {
    let x = g.find((y) => y.key === r.gkey);
    if (!x) g.push((x = { key: r.gkey, label: r.group, rows: [] }));
    x.rows.push(r);
  }
  return g;
}

/** Scan directions present, backward first. */
export const dirsOf = (rows: StatRow[]): Dir[] =>
  rows.some((r) => r.dir === 'rev') ? (rows.some((r) => r.dir === 'fwd') ? ['rev', 'fwd'] : ['rev']) : ['fwd'];

export function boxes(rows: StatRow[], dirs: Dir[], k: MetricKey): BoxGroup[] {
  return groupsOf(rows).map((g, i) => ({
    label: g.label,
    series: dirs.map((d) => {
      const rs = g.rows.filter((r) => r.dir === d && hasValue(r, k)),
        best = rs.reduce<StatRow | null>((b, r) => (!b || r.m.pce > b.m.pce ? r : b), null);
      return {
        label: dirs.length > 1 ? (d === 'rev' ? 'Backward' : 'Forward') : '',
        color: SERIES[i % SERIES.length],
        light: d === 'fwd' && dirs.length > 1,
        stats: summarize(rs, k),
        points: rs.map((r) => ({
          v: r.m[k] as number,
          best: r === best,
          tip: `substrate ${r.substrate} · pixel ${r.pixel}`,
        })),
      };
    }),
  }));
}
