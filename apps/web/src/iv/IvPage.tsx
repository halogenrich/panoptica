import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { trashed, useRefresh } from '../lib/trash';
import { Badge, Empty, Seg, fmtDate } from '../lib/ui';
import { type BoxGroup } from './charts';
import { BoxPanel, OutlierToggle, TITLES, combinePanels, lighter, useOutliers } from './BoxFigure';
import { useFigureSettings, useLogoChoice } from '../lib/figure';
import { exportSvg } from './JvFigure';
import ImportIv from './Import';
import { Check } from '../views/common';
import {
  METRICS,
  SERIES,
  hasValue,
  SYSTEM,
  clearGeomCache,
  counts,
  download,
  fmt,
  statRows,
  summarize,
  toCsv,
  type Curve,
  type Dir,
  type IvSet,
  type IvSetFull,
  type Link,
  type MetricKey,
  type StatRow,
} from './model';
import { SampleMaps } from './SubstrateMap';
import { CompareCtx, ComparePanel, useCompare } from './Compare';
import Stability from './Stability';
import { DeviceTable, devKey } from './Devices';

const fdate = (d: string) =>
  d
    ? new Date(d + 'T12:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : 'no date';

export default function IvPage({ openId, onOpen }: { openId: number | null; onOpen: (id: number | null) => void }) {
  useState(() => clearGeomCache()); // once per visit: masks may have been reordered since
  return openId ? <Detail id={openId} onBack={() => onOpen(null)} /> : <List onOpen={onOpen} />;
}

function List({ onOpen }: { onOpen: (id: number) => void }) {
  const [rows, setRows] = useState<IvSet[] | null>(null),
    [tab, setTab] = useState<'list' | 'stats'>('list'),
    [imp, setImp] = useState(false),
    [q, setQ] = useState('');
  const load = () =>
    api<IvSet[]>('/iv')
      .then(setRows)
      .catch(() => setRows([]));
  useEffect(() => {
    load();
  }, []);
  useRefresh(load, ['iv']);
  const shown = (rows ?? []).filter((r) =>
    (
      r.name +
      ' ' +
      r.samples.join(' ') +
      ' ' +
      Object.values(r.links)
        .map((l) => l?.label ?? '')
        .join(' ')
    )
      .toLowerCase()
      .includes(q.toLowerCase()),
  );
  return (
    <>
      <div className="lib-bar">
        <Seg
          value={tab}
          on={setTab}
          small
          opts={[
            ['list', 'Measurements'],
            ['stats', 'Statistics'],
          ]}
        />
        {tab === 'list' && (
          <input
            className="lib-search"
            type="search"
            placeholder="Search measurements"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        )}
        <div className="grow" />
        <button className="btn" onClick={() => setImp(true)}>
          Import measurements
        </button>
      </div>
      {tab === 'stats' ? (
        <Stats sets={(rows ?? []).filter((r) => !r.stabilityOf)} />
      ) : rows === null ? (
        <div className="cards">
          {[0, 1, 2].map((i) => (
            <div key={i} className="pcard skeleton" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <Empty
          title={rows.length ? 'Nothing matches' : 'No electric measurements yet'}
          text={
            rows.length
              ? 'Change the search text.'
              : 'Use Import measurements and drop the folder the J–V system saved (or a .zip of it).'
          }
        />
      ) : (
        <div className="cards">
          {shown.map((r) => (
            <button key={r.id} className="pcard" onClick={() => onOpen(r.id)}>
              <div className="pcard-art iv-art">
                <span>
                  {r.best ? r.best.toFixed(1) : '—'}
                  <small>%</small>
                </span>
                <small>best PCE</small>
              </div>
              <div className="pcard-body">
                <div className="pcard-name">{r.name}</div>
                <div className="pcard-sum">
                  {r.samples.map((s) => r.links[s]?.label ?? s.replace(/_/g, ' ')).join(' · ')}
                </div>
                <div className="pcard-meta">
                  <span>{r.substrates} substrates</span>
                  <span>{r.working} working curves</span>
                  {r.stabilityOf ? (
                    <Badge tone="warn">Stability follow-up</Badge>
                  ) : r.followUps ? (
                    <Badge tone="ac">Stability series</Badge>
                  ) : null}
                  {r.visibility === 'shared' && <Badge>Shared</Badge>}
                  <span>{fdate(r.date)}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      {imp && (
        <ImportIv
          onClose={() => setImp(false)}
          onDone={(ids) => {
            setImp(false);
            load();
            if (ids.length === 1) onOpen(ids[0]);
          }}
        />
      )}
    </>
  );
}

function LinkSelect({ value, onChange, disabled }: { value: Link; onChange: (l: Link) => void; disabled?: boolean }) {
  const [t, setT] = useState<{ batches: any[]; stacks: any[] } | null>(null);
  useEffect(() => {
    Promise.all([api<any[]>('/batches'), api<any[]>('/presets?segment=stk')])
      .then(([b, s]) => setT({ batches: b, stacks: s }))
      .catch(() => setT({ batches: [], stacks: [] }));
  }, []);
  return (
    <select
      className="link-select"
      aria-label="Linked batch or stack"
      disabled={disabled || !t}
      value={value ? `${value.kind}:${value.id}` : ''}
      onChange={(e) => {
        const [k, id] = e.target.value.split(':');
        onChange(k ? { kind: k as 'batch' | 'stack', id: +id } : null);
      }}
    >
      <option value="">Not linked to a batch or stack</option>
      {t && t.batches.length > 0 && (
        <optgroup label="Batches">
          {t.batches.map((b) => (
            <option key={'b' + b.id} value={`batch:${b.id}`}>
              {b.code}
              {b.name ? ` · ${b.name}` : ''}
            </option>
          ))}
        </optgroup>
      )}
      {t && t.stacks.length > 0 && (
        <optgroup label="Stacks">
          {t.stacks.map((s) => (
            <option key={'s' + s.id} value={`stack:${s.id}`}>
              {s.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

function Detail({ id, onBack }: { id: number; onBack: () => void }) {
  const [s, setS] = useState<IvSetFull | null>(null),
    [msg, setMsg] = useState(''),
    [tab, setTab] = useState<'cells' | 'stats' | 'stability'>('cells');
  const cmp = useCompare(),
    [others, setOthers] = useState<IvSet[]>([]);
  useEffect(() => {
    api<IvSet[]>('/iv')
      .then(setOthers)
      .catch(() => {});
  }, [id]);
  const hasRev = !!s?.curves.some((c) => c.dir === 'rev'),
    [dir, setDir] = useState<Dir>('rev');
  const load = () =>
    api<IvSetFull>('/iv/' + id)
      .then((x) => {
        setS(x);
        if (!x.curves.some((c) => c.dir === 'rev')) setDir('fwd');
      })
      .catch((e) => setMsg(e.message));
  useEffect(() => {
    load();
  }, [id]);
  if (!s) return <p className="mut">{msg || 'Loading…'}</p>;
  const patch = (p: object) =>
    api('/iv/' + id, 'PATCH', p)
      .then(load)
      .catch((e) => setMsg(e.message));
  const onCurve = (c: Curve) => setS({ ...s, curves: s.curves.map((x) => (x.id === c.id ? c : x)) });
  return (
    <div className="batch iv">
      <div className="batch-head">
        <button className="link" onClick={onBack}>
          ‹ Measurements
        </button>
        <input
          className="batch-name iv-name"
          aria-label="Name"
          value={s.name}
          disabled={!s.editable}
          onChange={(e) => setS({ ...s, name: e.target.value })}
          onBlur={() => patch({ name: s.name })}
        />
        <div className="grow" />
        <Seg
          value={s.visibility}
          small
          on={(v) => s.editable && patch({ visibility: v })}
          opts={[
            ['private', 'Private'],
            ['shared', 'Shared'],
          ]}
        />
        {s.editable && (
          <button
            className="link danger-link"
            onClick={() =>
              window.confirm(
                `Move the measurement "${s.name}" (${s.curves.length} curves) to the trash? You can restore it for 30 days.`,
              ) &&
              api('/iv/' + id, 'DELETE')
                .then(() => trashed('iv', id, s.name))
                .then(onBack)
            }
          >
            Delete
          </button>
        )}
      </div>
      <p className="mut small">
        {SYSTEM[s.system]} · measured {fdate(s.date)} · {s.substrates} substrates · {s.curves.length} curves · imported
        by {s.owner} {fmtDate(s.created_at)}
        {msg ? ` · ${msg}` : ''}
      </p>
      <details className="devices-box stab-box">
        <summary>
          Stability test
          {s.stabilityOf ? (
            <span className="mut small">
              {' '}
              · follow-up of {others.find((o) => o.id === s.stabilityOf)?.name ?? 'an earlier measurement'}, measured{' '}
              {new Date(s.measuredAt!).toLocaleString(undefined, {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          ) : s.followUps ? (
            <span className="mut small">
              {' '}
              · first of a series with {s.followUps} follow-up{s.followUps === 1 ? '' : 's'}
            </span>
          ) : (
            <span className="mut small"> · not part of one</span>
          )}
        </summary>
        <div className="stab-row">
          <label className="inline small">
            This is a later reading of
            <select
              disabled={!s.editable || !!s.followUps}
              value={s.stabilityOf ?? ''}
              onChange={(e) => patch({ stability_of: e.target.value ? +e.target.value : null })}
            >
              <option value="">nothing (a measurement of its own)</option>
              {others
                .filter((o) => o.id !== s.id && !o.stabilityOf)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="inline small">
            measured at{' '}
            <input
              type="datetime-local"
              disabled={!s.editable}
              defaultValue={
                s.measuredAt
                  ? new Date(new Date(s.measuredAt).getTime() - new Date().getTimezoneOffset() * 6e4)
                      .toISOString()
                      .slice(0, 16)
                  : ''
              }
              onBlur={(e) => e.target.value && patch({ measured_at: new Date(e.target.value).toISOString() })}
            />
          </label>
        </div>
        <p className="mut small">
          Follow-ups are matched to the first measurement by sample, substrate and pixel, plotted against time under
          Stability, and kept out of the statistics and the lab records.
        </p>
      </details>
      <div className="inline">
        <Seg
          value={tab}
          on={setTab}
          small
          opts={[
            ['cells', 'Cells'],
            ['stats', 'Statistics'],
            ...(s.stabilityOf || s.followUps ? [['stability', 'Stability'] as ['stability', string]] : []),
          ]}
        />
        {tab === 'cells' && hasRev && (
          <Seg
            value={dir}
            on={setDir}
            small
            opts={[
              ['rev', 'Backward scan'],
              ['fwd', 'Forward scan'],
            ]}
          />
        )}
        {tab === 'cells' && (
          <span className="mut small legend-px">
            <i className="k-ok" />
            PCE in % (darker = higher) <i className="k-dead" />
            dead <i className="k-short" />
            short · click a pixel for its curves, Shift-click to compare pixels
          </span>
        )}
      </div>
      {tab === 'cells' && cmp.items.length > 0 && (
        <ComparePanel
          items={cmp.items}
          onRemove={(k) => cmp.setItems(cmp.items.filter((x) => x.key !== k))}
          onClear={() => cmp.setItems([])}
        />
      )}
      <CompareCtx.Provider value={cmp.value}>
        {tab === 'stability' ? (
          <Stability setId={s.id} />
        ) : tab === 'stats' ? (
          <StatsFor sets={[s]} />
        ) : (
          s.samples.map((sample) => (
            <section key={sample} className="sample">
              <div className="inline sample-head">
                <h3>{sample.replace(/_/g, ' ')}</h3>
                <LinkSelect
                  value={s.rawLinks[sample] ?? null}
                  disabled={!s.editable}
                  onChange={(l) => patch({ links: { [sample]: l } })}
                />
              </div>
              <details className="devices-box">
                <summary>
                  Devices for the plots and device groups
                  {(() => {
                    const subs = [...new Set(s.curves.filter((c) => c.sample === sample).map((c) => c.substrate))],
                      off = subs.filter((x) => s.devices?.[devKey(sample, x)]?.off).length,
                      gs = new Set(subs.map((x) => s.devices?.[devKey(sample, x)]?.g).filter(Boolean));
                    return (
                      <span className="mut small">
                        {' '}
                        · {subs.length - off} of {subs.length} in plots
                        {gs.size ? ` · groups: ${[...gs].join(', ')}` : ''}
                      </span>
                    );
                  })()}
                </summary>
                <DeviceTable
                  rows={[...new Set(s.curves.filter((c) => c.sample === sample).map((c) => c.substrate))].map((x) => ({
                    sample,
                    substrate: x,
                    best: Math.max(
                      0,
                      ...s.curves
                        .filter((c) => c.sample === sample && c.substrate === x && counts(c))
                        .map((c) => c.m.pce),
                    ),
                  }))}
                  value={s.devices ?? {}}
                  disabled={!s.editable}
                  groups={[]}
                  fallback={(smp) => s.links[smp]?.label ?? smp.replace(/_/g, ' ')}
                  onChange={(p) => {
                    setS({ ...s, devices: { ...s.devices, ...p } });
                    api('/iv/' + id, 'PATCH', { devices: p }).catch((e) => setMsg(e.message));
                  }}
                />
              </details>
              <SampleMaps set={s} sample={sample} link={s.links[sample] ?? null} dir={dir} onCurve={onCurve} />
            </section>
          ))
        )}
      </CompareCtx.Provider>
    </div>
  );
}

/** Statistics across measurements: choose which, then box plots by group. */
function Stats({ sets }: { sets: IvSet[] }) {
  const [sel, setSel] = useState<number[] | null>(null),
    [full, setFull] = useState<Record<number, IvSetFull>>({});
  const chosen = sel ?? sets.map((s) => s.id);
  useEffect(() => {
    for (const id of chosen)
      if (!full[id])
        api<IvSetFull>('/iv/' + id)
          .then((x) => setFull((f) => ({ ...f, [id]: x })))
          .catch(() => {});
  }, [chosen.join(',')]);
  if (!sets.length)
    return <Empty title="No measurements yet" text="Import J–V measurements first (Import measurements)." />;
  return (
    <div className="stats">
      <div className="group">
        <h3>Measurements included</h3>
        <div className="chips">
          {sets.map((s) => (
            <button
              key={s.id}
              className={'chip' + (chosen.includes(s.id) ? ' on' : '')}
              aria-pressed={chosen.includes(s.id)}
              onClick={() => setSel(chosen.includes(s.id) ? chosen.filter((x) => x !== s.id) : [...chosen, s.id])}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>
      <StatsFor sets={chosen.map((id) => full[id]).filter(Boolean)} />
    </div>
  );
}

export function StatsFor({ sets }: { sets: IvSetFull[] }) {
  const [dir, setDir] = useState<Dir | 'both'>('rev'),
    [dens, setDens] = useState(false),
    [outl, setOutl] = useOutliers();
  const fs = useFigureSettings(),
    hasLogo = !!(fs.watermark || fs.group),
    [logo, setLogo] = useLogoChoice();
  const figs = useRef<Record<string, SVGSVGElement | null>>({}),
    [figErr, setFigErr] = useState('');
  // which plots to show (remembered in this browser)
  const [show, setShowState] = useState<MetricKey[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem('psc-plots') ?? 'null');
      if (Array.isArray(v) && v.length) return v;
    } catch {
      /* private window */
    }
    return ['jsc', 'ff', 'voc', 'pce'];
  });
  const toggleShow = (k: MetricKey) => {
    const n = show.includes(k)
      ? show.filter((x) => x !== k)
      : METRICS.map((m) => m.key).filter((x) => x === k || show.includes(x));
    setShowState(n);
    try {
      localStorage.setItem('psc-plots', JSON.stringify(n));
    } catch {
      /* ignore */
    }
  };
  const anyRev = sets.some((s) => s.curves.some((c) => c.dir === 'rev'));
  const rows = useMemo(() => statRows(sets, anyRev ? dir : dir === 'rev' ? 'fwd' : dir), [sets, dir, anyRev]);
  // groups keep the order they first appear in (by measurement, then sample) so a colour always means the same group
  const groups = useMemo(() => {
    const g: { key: string; label: string; rows: StatRow[] }[] = [];
    for (const r of rows) {
      let x = g.find((y) => y.key === r.gkey);
      if (!x) g.push((x = { key: r.gkey, label: r.group, rows: [] }));
      x.rows.push(r);
    }
    return g;
  }, [rows]);
  const champ = rows.reduce<StatRow | null>((b, r) => (!b || r.m.pce > b.m.pce ? r : b), null);
  const dirs: Dir[] = dir === 'both' && anyRev ? ['rev', 'fwd'] : [anyRev ? (dir === 'both' ? 'rev' : dir) : 'fwd'];
  const box = (k: MetricKey): BoxGroup[] =>
    groups.map((g, i) => ({
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
            tip: `${r.sample.replace(/_/g, ' ')} · substrate ${r.substrate} · pixel ${r.pixel}${r.scan ? ` · scan ${r.scan}` : ''} · ${r.dir === 'rev' ? 'backward' : 'forward'} · ${r.set}`,
          })),
        };
      }),
    }));
  if (!sets.length) return <p className="mut">Loading…</p>;
  return (
    <>
      <div className="inline">
        {anyRev && (
          <Seg
            value={dir}
            on={setDir}
            small
            opts={[
              ['rev', 'Backward scans'],
              ['fwd', 'Forward scans'],
              ['both', 'Both'],
            ]}
          />
        )}
        <span className="mut small">
          {rows.length} curves from working pixels in {groups.length} group{groups.length === 1 ? '' : 's'} · each pixel
          counts once per direction, with its best scan; dead and shorted pixels and check sweeps are left out (change
          it per pixel in Cells)
        </span>
        <div className="grow" />
        <button
          className="link"
          disabled={!rows.length}
          onClick={() => download(`jv-statistics-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows))}
        >
          Export CSV
        </button>
      </div>
      {champ && (
        <p className="champ">
          Champion: <b>{fmt(champ.m.pce)} %</b> · Voc {fmt(champ.m.voc, 3)} V · Jsc {fmt(champ.m.jsc)} mA/cm² · FF{' '}
          {fmt(champ.m.ff, 1)} %{' '}
          <span className="mut">
            — {champ.group} · substrate {champ.substrate} · pixel {champ.pixel} ·{' '}
            {champ.dir === 'rev' ? 'backward' : 'forward'}
          </span>
        </p>
      )}
      <div className="inline plot-pick">
        <span className="mut small">Show</span>
        <div className="chips">
          {METRICS.map((m) => (
            <button
              key={m.key}
              className={'chip' + (show.includes(m.key) ? ' on' : '')}
              aria-pressed={show.includes(m.key)}
              onClick={() => toggleShow(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <label className="inline small">
          <Check v={dens} on={setDens} /> Density curve
        </label>
        <OutlierToggle v={outl} on={setOutl} />
        {hasLogo && (
          <label className="inline small">
            <Check v={logo} on={setLogo} /> Group logo
          </label>
        )}
        <div className="grow" />
        {show.length > 1 && rows.length > 0 && (
          <span className="inline small">
            <span className="mut">All plots as one image</span>
            <button
              className="link small"
              onClick={() =>
                exportSvg(
                  combinePanels(show.map((k) => figs.current[k]).filter((x): x is SVGSVGElement => !!x)),
                  `jv-boxplots-${new Date().toISOString().slice(0, 10)}`,
                  'png',
                ).catch((e) => setFigErr(e.message))
              }
            >
              PNG
            </button>
            <button
              className="link small"
              onClick={() =>
                exportSvg(
                  combinePanels(show.map((k) => figs.current[k]).filter((x): x is SVGSVGElement => !!x)),
                  `jv-boxplots-${new Date().toISOString().slice(0, 10)}`,
                  'svg',
                )
              }
            >
              SVG
            </button>
          </span>
        )}
        {figErr && <span className="err small">{figErr}</span>}
      </div>
      {rows.length > 0 && (
        <p className="mut small">
          Dots: pixels (gold ring = best) ·{' '}
          {outl
            ? 'triangles: outliers (beyond 1.5 × IQR)'
            : 'axis fitted to the boxes; an arrow with a number marks outliers beyond it (still counted)'}
          {dirs.length > 1 ? ' · bwd = backward, fwd = forward (lighter)' : ''} · hover for values · each plot exports
          on its own, or all together{show.includes('rsh') ? ' · Rsh on a log axis' : ''}
        </p>
      )}
      {rows.length > 0 && (
        <div className="plot-grid">
          {show.map((k) => {
            const m = METRICS.find((x) => x.key === k)!;
            const name = `jv-${k}-${new Date().toISOString().slice(0, 10)}`;
            return (
              <figure key={k} className="plot-card">
                <div className="fig-wrap">
                  <BoxPanel
                    svgRef={(el) => {
                      figs.current[k] = el;
                    }}
                    showDensity={dens}
                    outliers={outl}
                    log={k === 'rsh'}
                    logo={hasLogo && logo ? fs : undefined}
                    panel={{ key: k, title: TITLES[k], groups: box(k), unit: m.unit, digits: m.digits }}
                  />
                </div>
                <figcaption className="inline">
                  <b>{m.label}</b>
                  <div className="grow" />
                  <button
                    className="link small"
                    onClick={() =>
                      figs.current[k] && exportSvg(figs.current[k]!, name, 'png').catch((e) => setFigErr(e.message))
                    }
                  >
                    PNG
                  </button>
                  <button
                    className="link small"
                    onClick={() => figs.current[k] && exportSvg(figs.current[k]!, name, 'svg')}
                  >
                    SVG
                  </button>
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}
      {(groups.length > 1 || dirs.length > 1) && (
        <div className="legend">
          {groups.map((g, i) => (
            <span key={g.key}>
              <i style={{ background: SERIES[i % SERIES.length] }} />
              {g.label}
            </span>
          ))}
          {dirs.length > 1 && (
            <span className="mut">
              backward in the group colour, forward lighter · dots{dens ? ' and density curves' : ''} darker
            </span>
          )}
        </div>
      )}
      <div className="group scroll">
        <table className="stat-table">
          <thead>
            <tr>
              <th>Group</th>
              <th>n</th>
              {METRICS.map((m) => (
                <th key={m.key}>
                  {m.label} ({m.unit})<br />
                  <span className="mut small">mean ± sd · median · best</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.flatMap((g, i) =>
              dirs.map((d) => {
                const rs = g.rows.filter((r) => r.dir === d);
                return (
                  <tr key={g.key + d}>
                    <td>
                      <i
                        className="swatch"
                        style={{
                          background:
                            d === 'fwd' && dirs.length > 1
                              ? lighter(SERIES[i % SERIES.length])
                              : SERIES[i % SERIES.length],
                        }}
                      />
                      {g.label}
                      {dirs.length > 1 ? <span className="mut"> · {d === 'rev' ? 'backward' : 'forward'}</span> : null}
                    </td>
                    <td>{rs.length}</td>
                    {METRICS.map((m) => {
                      const b = summarize(rs, m.key);
                      return (
                        <td key={m.key}>
                          {b ? (
                            <>
                              {fmt(b.mean, m.digits)} ± {fmt(b.sd, m.digits)}
                              <br />
                              <span className="mut small">
                                {fmt(b.median, m.digits)} · {fmt(b.max, m.digits)}
                              </span>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** On a batch page: the measurements linked to it. */
export function BatchMeasurements({
  batchId,
  code,
  onOpen,
}: {
  batchId: number;
  code: string;
  onOpen: (id: number) => void;
}) {
  const [list, setList] = useState<(IvSet & { linkedSamples: string[] })[] | null>(null),
    [full, setFull] = useState<Record<number, IvSetFull>>({}),
    [imp, setImp] = useState(false);
  const load = () =>
    api<(IvSet & { linkedSamples: string[] })[]>(`/batches/${batchId}/iv`)
      .then((l) => {
        setList(l);
        l.forEach((s) => api<IvSetFull>('/iv/' + s.id).then((x) => setFull((f) => ({ ...f, [s.id]: x }))));
      })
      .catch(() => setList([]));
  useEffect(() => {
    load();
  }, [batchId]);
  useState(() => clearGeomCache());
  return (
    <>
      <div className="inline">
        <h3 className="sub">Electric measurements for {code}</h3>
        <div className="grow" />
        <button className="link" onClick={() => setImp(true)}>
          Import measurements
        </button>
      </div>
      {list === null ? null : list.length === 0 ? (
        <p className="mut">
          None yet. Import the J–V files here (the samples are linked to this batch), or link a sample to {code} on the
          Electric measurements page.
        </p>
      ) : (
        list.map(
          (s) =>
            full[s.id] && (
              <section key={s.id} className="group sample">
                <div className="inline">
                  <b>{s.name}</b>
                  <span className="mut small">{fdate(s.date)}</span>
                  <div className="grow" />
                  <button className="link" onClick={() => onOpen(s.id)}>
                    Open measurement
                  </button>
                </div>
                {s.linkedSamples.map((sample) => (
                  <SampleMaps
                    key={sample}
                    set={full[s.id]}
                    sample={sample}
                    link={full[s.id].links[sample] ?? null}
                    dir={full[s.id].curves.some((c) => c.dir === 'rev') ? 'rev' : 'fwd'}
                    onCurve={(c) =>
                      setFull((f) => ({
                        ...f,
                        [s.id]: { ...f[s.id], curves: f[s.id].curves.map((x) => (x.id === c.id ? c : x)) },
                      }))
                    }
                  />
                ))}
              </section>
            ),
        )
      )}
      {imp && (
        <ImportIv
          presetLink={{ kind: 'batch', id: batchId }}
          onClose={() => setImp(false)}
          onDone={() => {
            setImp(false);
            load();
          }}
        />
      )}
    </>
  );
}
