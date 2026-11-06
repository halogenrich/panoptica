import { api } from '../api';
import { KINDS } from '../recipes';
import { norm, type Ctx } from '../recipes/types';
import { SEG, type Slot } from '../stacks/model';
import { describeChanges } from '@psc/core';
import { fmtDate } from '../lib/ui';
import { xlsx, downloadBytes, type Sheet } from '../lib/xlsx';
import { useFigureSettings, useLogoChoice } from '../lib/figure';
import { BoxFigure, TITLES, useOutliers } from '../iv/BoxFigure';
import { METRICS, fmt, statRows, summarize, type IvSetFull, type MetricKey, type StatRow, type Dir } from '../iv/model';
import { boxes, dirsOf, groupsOf } from '../iv/boxes';
import type { Batch, BRun } from './Batches';
import type { Booking } from './Calendar';
import { layerState } from '../lib/stepRuns';
import { fmtRun, parseSci } from '../lib/RunInputs';

const STATUS: Record<string, string> = { planned: 'Planned', running: 'Running', done: 'Done' };
export const slotPresets = (s: Slot) =>
  s.m === 'Spin'
    ? [
        { id: s.a, seg: 's1' },
        { id: s.b, seg: 's2' },
      ].filter((x) => x.id)
    : SEG[s.m] && s.a
      ? [{ id: s.a, seg: SEG[s.m]! }]
      : [];

/** J–V measurements linked to this batch, with only the samples that belong to it. */
export async function batchMeasurements(batchId: number): Promise<IvSetFull[]> {
  const list = await api<{ id: number; linkedSamples: string[] }[]>(`/batches/${batchId}/iv`).catch(() => []);
  const full = await Promise.all(
    list.map((x) =>
      api<IvSetFull>('/iv/' + x.id)
        .then((s) => ({ ...s, curves: s.curves.filter((c) => x.linkedSamples.includes(c.sample)) }))
        .catch(() => null),
    ),
  );
  return full.filter((s): s is IvSetFull => !!s && s.curves.length > 0);
}

/** Printable batch report (save as PDF from the print dialog): stack, recipes, checklist, notes, run data and J–V results. */
export function BatchReport({
  b,
  ctx,
  runs,
  sets,
  books = [],
}: {
  b: Batch;
  ctx: Ctx;
  runs: BRun[];
  sets: IvSetFull[];
  books?: Booking[];
}) {
  const fs = useFigureSettings(),
    [logo] = useLogoChoice(),
    [outl] = useOutliers(); // as last chosen with "Show outliers" in the statistics
  const st = b.snapshot.stack,
    rec = b.record ?? {},
    dataOf = (id: string | number) => ctx.all.find((p) => String(p.id) === String(id));
  const rows = statRows(sets, 'both'),
    dirs: Dir[] = dirsOf(rows);
  const champ = rows.reduce<StatRow | null>((x, r) => (!x || r.m.pce > x.m.pce ? r : x), null);
  return (
    <div className="report">
      <header className="report-head">
        <h1>
          Batch {b.code}
          {b.name ? ` · ${b.name}` : ''}
        </h1>
        <p>
          {STATUS[b.status]} · {st.arch} · started {fmtDate(b.created_at)} by {b.owner} · report of{' '}
          {new Date().toLocaleString('en-GB')}
        </p>
        <p className="mut">Stack (bottom → top): {st.sl.map((s) => s.n).join(' / ')}</p>
      </header>

      <h2>Layers</h2>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Layer</th>
            <th>Method</th>
            <th>Recipe</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>
          {st.sl.map((s, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>{s.n}</td>
              <td>{s.m}</td>
              <td>
                {s.m === 'Manual'
                  ? s.t
                  : slotPresets(s)
                      .map((p) => dataOf(p.id)?.name ?? '—')
                      .join(' + ')}
              </td>
              <td>{layerState(b, books, i).text}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {!!b.variants?.list.length && (
        <>
          <h2>Variants</h2>
          <table>
            <thead>
              <tr>
                <th>Variant</th>
                <th>Substrates</th>
                <th>What changes from the default device</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Default device</td>
                <td>{b.variants.control || '—'}</td>
                <td>—</td>
              </tr>
              {b.variants.list.map((v) => (
                <tr key={v.id}>
                  <td>{v.name}</td>
                  <td>{v.substrates || '—'}</td>
                  <td>{describeChanges(v, st.sl).join('; ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2>Recipes</h2>
      {st.sl.flatMap((s, i) =>
        slotPresets(s).map((p) => {
          const r = dataOf(p.id),
            k = KINDS[p.seg];
          if (!r || !k) return null;
          const facts = k.describe(norm(k, r.data), ctx);
          return (
            <section key={`${i}-${p.id}`} className="report-block">
              <h3>
                {i + 1}. {s.n} · {r.name}
              </h3>
              <table className="kv">
                <tbody>
                  {Object.entries(facts).map(([a, v]) => (
                    <tr key={a}>
                      <th>{a}</th>
                      <td>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        }),
      )}

      {variantRecipes(b).map((x, j) => {
        const k = KINDS[x.seg];
        return k ? (
          <section key={'v' + j} className="report-block">
            <h3>
              Variant {x.variant} · {x.layer} · {x.name}
            </h3>
            <table className="kv">
              <tbody>
                {Object.entries(k.describe(norm(k, x.data), ctx)).map(([a, v]) => (
                  <tr key={a}>
                    <th>{a}</th>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null;
      })}

      {rec.notes && (
        <>
          <h2>Batch notes</h2>
          <p className="pre">{rec.notes}</p>
        </>
      )}

      <h2>Run data</h2>
      {runs.length === 0 ? (
        <p className="mut">No run data recorded.</p>
      ) : (
        runs.map((r) => {
          const k = KINDS[r.segment],
            d = k ? norm(k, dataOf(r.preset_id)?.data ?? {}) : null,
            fields = k && d ? k.runFields(d, ctx) : [];
          return (
            <section key={r.id} className="report-block">
              <h3>
                {r.preset} · {r.author} · {fmtDate(r.created_at)}
              </h3>
              <table>
                <thead>
                  <tr>
                    <th>Value</th>
                    <th>Recipe</th>
                    <th>Actual</th>
                  </tr>
                </thead>
                <tbody>
                  {fields
                    .filter((f) => r.values[f.key])
                    .map((f) => (
                      <tr key={f.key}>
                        <td>{f.label}</td>
                        <td>{f.expected}</td>
                        <td>
                          <b>{fmtRun(f, r.values[f.key])}</b>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {r.deviation && (
                <p>
                  <b>Deviation:</b> {r.deviation}
                </p>
              )}
              {r.notes && (
                <p>
                  <b>Notes:</b> {r.notes}
                </p>
              )}
            </section>
          );
        })
      )}

      <h2>J–V results</h2>
      {rows.length === 0 ? (
        <p className="mut">No J–V measurements linked to this batch.</p>
      ) : (
        <>
          <p>
            {sets.map((s) => s.name).join(', ')} · {rows.length} curves from working pixels
            {champ ? (
              <>
                {' '}
                · champion <b>{fmt(champ.m.pce)} %</b> (Voc {fmt(champ.m.voc, 3)} V, Jsc {fmt(champ.m.jsc)} mA/cm², FF{' '}
                {fmt(champ.m.ff, 1)} %; substrate {champ.substrate}, pixel {champ.pixel},{' '}
                {champ.dir === 'rev' ? 'backward' : 'forward'})
              </>
            ) : null}
          </p>
          <table>
            <thead>
              <tr>
                <th>Group</th>
                <th>Scan</th>
                <th>n</th>
                {METRICS.map((m) => (
                  <th key={m.key}>
                    {m.label} ({m.unit}) mean ± sd · best
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groupsOf(rows).flatMap((g) =>
                dirs.map((d) => {
                  const rs = g.rows.filter((r) => r.dir === d);
                  return (
                    <tr key={g.key + d}>
                      <td>{g.label}</td>
                      <td>{d === 'rev' ? 'backward' : 'forward'}</td>
                      <td>{rs.length}</td>
                      {METRICS.map((m) => {
                        const s = summarize(rs, m.key);
                        return (
                          <td key={m.key}>
                            {s ? `${fmt(s.mean, m.digits)} ± ${fmt(s.sd, m.digits)} · ${fmt(s.max, m.digits)}` : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
          <div className="report-fig">
            <BoxFigure
              panels={(['jsc', 'ff', 'voc', 'pce'] as MetricKey[]).map((k) => {
                const m = METRICS.find((x) => x.key === k)!;
                return { key: k, title: TITLES[k], groups: boxes(rows, dirs, k), unit: m.unit, digits: m.digits };
              })}
              logo={logo && (fs.watermark || fs.group) ? fs : undefined}
              outliers={outl}
            />
          </div>
        </>
      )}
    </div>
  );
}

/** The same content as a spreadsheet: one sheet each for the batch, layers, recipes, run data, J–V pixels and statistics. */
/** Recipes a variant uses instead of (or on top of) the batch's own, frozen with the variant. */
function variantRecipes(b: Batch) {
  const sl = b.snapshot.stack.sl,
    out: { variant: string; layer: string; name: string; seg: string; data: unknown }[] = [];
  for (const v of b.variants?.list ?? [])
    for (const c of v.changes) {
      if (c.t === 'recipe' && c.name !== undefined) {
        const s = sl[c.slot];
        const seg = c.which === 'b' ? 's2' : (SEG[s?.m as keyof typeof SEG] ?? '');
        if (seg) out.push({ variant: v.name, layer: s.n, name: c.name, seg, data: c.data });
      }
      if (c.t === 'layer')
        for (const [f, seg] of [
          [c.ra, c.m === 'Spin' ? 's1' : (SEG[c.m as keyof typeof SEG] ?? '')],
          [c.rb, 's2'],
        ] as const)
          if (f && seg) out.push({ variant: v.name, layer: c.n, name: f.name, seg, data: f.data });
    }
  return out;
}

export function batchSpreadsheet(b: Batch, ctx: Ctx, runs: BRun[], sets: IvSetFull[], books: Booking[] = []) {
  downloadBytes(`batch-${b.code.replace(/[^\w.-]+/g, '_')}.xlsx`, xlsx(batchSheets(b, ctx, runs, sets, books)));
}
/** The batch record as tables (the spreadsheet's sheets; the data package writes them as CSV files). */
export function batchSheets(b: Batch, ctx: Ctx, runs: BRun[], sets: IvSetFull[], books: Booking[] = []): Sheet[] {
  const st = b.snapshot.stack,
    rec = b.record ?? {},
    dataOf = (id: string | number) => ctx.all.find((p) => String(p.id) === String(id));
  const sheets: Sheet[] = [];
  sheets.push({
    name: 'Batch',
    rows: [
      ['Field', 'Value'],
      ['Code', b.code],
      ['Description', b.name],
      ['Status', STATUS[b.status]],
      ['Architecture', st.arch],
      ['Owner', b.owner],
      ['Started', b.created_at],
      ['Stack (bottom to top)', st.sl.map((s) => s.n).join(' / ')],
      ['Notes', rec.notes ?? ''],
      ['Exported', new Date().toLocaleString('en-GB')],
    ],
  });
  sheets.push({
    name: 'Layers',
    rows: [
      ['#', 'Layer', 'Method', 'Recipe', 'Thickness for 3D (nm)', 'State'],
      ...st.sl.map((s, i) => [
        i + 1,
        s.n,
        s.m,
        s.m === 'Manual'
          ? s.t
          : slotPresets(s)
              .map((p) => dataOf(p.id)?.name ?? '')
              .join(' + '),
        s.th ?? '',
        layerState(b, books, i).text,
      ]),
    ],
  });
  if (b.variants?.list.length)
    sheets.push({
      name: 'Variants',
      rows: [
        ['Variant', 'Substrates', 'What changes from the default device'],
        ['Default device', b.variants.control, ''],
        ...b.variants.list.map((v) => [v.name, v.substrates, describeChanges(v, st.sl).join('; ')]),
      ],
    });
  sheets.push({
    name: 'Recipes',
    rows: [
      ['Layer', 'Recipe', 'Field', 'Value'],
      ...variantRecipes(b).flatMap((x) => {
        const k = KINDS[x.seg];
        return k
          ? Object.entries(k.describe(norm(k, x.data), ctx)).map(([a, v]) => [
              `Variant ${x.variant}, ${x.layer}`,
              x.name,
              a,
              v,
            ])
          : [];
      }),
      ...st.sl.flatMap((s, i) =>
        slotPresets(s).flatMap((p) => {
          const r = dataOf(p.id),
            k = KINDS[p.seg];
          if (!r || !k) return [];
          return Object.entries(k.describe(norm(k, r.data), ctx)).map(([a, v]) => [`${i + 1}. ${s.n}`, r.name, a, v]);
        }),
      ),
    ],
  });
  sheets.push({
    name: 'Run data',
    rows: [
      ['Recipe', 'Author', 'Date', 'Value', 'Recipe value', 'Actual', 'Unit', 'Deviation', 'Notes'],
      ...runs.flatMap((r) => {
        const k = KINDS[r.segment],
          d = k ? norm(k, dataOf(r.preset_id)?.data ?? {}) : null,
          fields = k && d ? k.runFields(d, ctx) : [];
        const num = (v: string) => {
          const p = parseSci(v.replace(',', '.'));
          return p && /^-?[\d.,]+(e-?\d+)?$/i.test(v.trim()) ? p[0] * 10 ** p[1] : v;
        };
        const lines = fields
          .filter((f) => r.values[f.key])
          .map((f) => [
            r.preset ?? '',
            r.author,
            r.created_at,
            f.label,
            f.expected ?? '',
            num(r.values[f.key]),
            f.unit ?? '',
            '',
            '',
          ]);
        return lines.length
          ? lines.map((l, j) => (j === 0 ? [...l.slice(0, 7), r.deviation, r.notes] : l))
          : [[r.preset ?? '', r.author, r.created_at, '', '', '', '', r.deviation, r.notes]];
      }),
    ],
  });
  const rows = statRows(sets, 'both');
  sheets.push({
    name: 'J-V pixels',
    rows: [
      [
        'Group',
        'Measurement',
        'Sample',
        'Substrate',
        'Pixel',
        'Scan',
        'Direction',
        'PCE (%)',
        'Voc (V)',
        'Jsc (mA/cm2)',
        'FF (%)',
        'Vmp (V)',
        'Jmp (mA/cm2)',
        'Rs (Ohm cm2)',
        'Rsh (Ohm cm2)',
      ],
      ...rows.map((r) =>
        [
          r.group,
          r.set,
          r.sample,
          r.substrate,
          r.pixel,
          r.scan,
          r.dir === 'rev' ? 'backward' : 'forward',
          r.m.pce,
          r.m.voc,
          r.m.jsc,
          r.m.ff,
          r.m.vmp,
          r.m.jmp,
          r.m.rs,
          r.m.rsh,
        ].map((v) => (typeof v === 'number' && !Number.isFinite(v) ? '' : v)),
      ),
    ],
  });
  sheets.push({
    name: 'Statistics',
    rows: [
      ['Group', 'Direction', 'Quantity', 'Unit', 'n', 'Mean', 'SD', 'Median', 'Q1', 'Q3', 'Min', 'Max'],
      ...groupsOf(rows).flatMap((g) =>
        (['rev', 'fwd'] as Dir[]).flatMap((d) => {
          const rs = g.rows.filter((r) => r.dir === d);
          return rs.length
            ? METRICS.map((m) => {
                const s = summarize(rs, m.key)!;
                return [
                  g.label,
                  d === 'rev' ? 'backward' : 'forward',
                  m.label,
                  m.unit,
                  s.n,
                  s.mean,
                  s.sd,
                  s.median,
                  s.q1,
                  s.q3,
                  s.min,
                  s.max,
                ];
              })
            : [];
        }),
      ),
    ],
  });
  return sheets;
}
