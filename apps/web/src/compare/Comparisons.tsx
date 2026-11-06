import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { trashed, useRefresh } from '../lib/trash';
import { Badge, Empty, Modal, Seg, fmtDate } from '../lib/ui';
import { Check } from '../views/common';
import { useFigureSettings, useLogoChoice } from '../lib/figure';
import { xlsx, downloadBytes, type Sheet } from '../lib/xlsx';
import { BFH, BFW, BoxFigure, OutlierToggle, TITLES, useOutliers } from '../iv/BoxFigure';
import { CompareFigure, bestScan, type CmpItem } from '../iv/Compare';
import { exportSvg } from '../iv/JvFigure';
import type { BoxGroup } from '../iv/charts';
import {
  METRICS,
  SERIES,
  fmt,
  hasValue,
  seriesColor,
  summarize,
  type Dir,
  type IvSetFull,
  type MetricKey,
} from '../iv/model';
import type { Batch } from '../views/Batches';
import { SlideFrame, useSlide } from '../views/overview/slides';
import {
  autoGroups,
  batchFacts,
  cmpRows,
  diffFacts,
  memberKey,
  newId,
  relative,
  splitName,
  type CRow,
  type CmpData,
  type Comparison,
  type DeviceRow,
  type Group,
  type Member,
} from './model';

const BOX_KEYS: MetricKey[] = ['jsc', 'ff', 'voc', 'pce'];
const DIR_NAME = { rev: 'Backward', fwd: 'Forward', both: 'Both directions' } as const;
const gColor = (i: number) => SERIES[i % SERIES.length]; // figures (exported, always on white)
const safe = (s: string) => s.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'comparison';

/** Comparisons: groups of devices from any measurements, side by side. */
export default function Comparisons({
  openId,
  onOpen,
}: {
  openId: number | null;
  onOpen: (id: number | null) => void;
}) {
  return openId ? <Detail id={openId} onBack={() => onOpen(null)} /> : <List onOpen={onOpen} />;
}

// ------------------------------------------------------------------ list
type Summary = Omit<Comparison, 'data'> & { owner: string };
function List({ onOpen }: { onOpen: (id: number) => void }) {
  const [rows, setRows] = useState<Summary[] | null>(null),
    [err, setErr] = useState(''),
    [q, setQ] = useState('');
  const load = () =>
    api<Summary[]>('/comparisons')
      .then(setRows)
      .catch(() => setRows([]));
  useEffect(() => {
    load();
  }, []);
  useRefresh(load, ['comparisons']);
  const make = () =>
    api<{ id: number }>('/comparisons', 'POST', {
      name: `Comparison ${new Date().toLocaleDateString()}`,
      visibility: 'private',
      data: { groups: [{ id: newId(), name: 'Reference', ref: true, members: [] }], dir: 'rev' },
    })
      .then((r) => onOpen(r.id))
      .catch((e) => setErr(e.message));
  const shown = (rows ?? []).filter((r) => (r.name + ' ' + r.owner).toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="lib-bar">
        <input
          className="lib-search"
          type="search"
          placeholder="Search comparisons"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="grow" />
        <button className="btn" onClick={make}>
          New comparison
        </button>
      </div>
      {err && <p className="err">{err}</p>}
      {rows === null ? (
        <div className="cards">
          {[0, 1, 2].map((i) => (
            <div key={i} className="pcard skeleton" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <Empty
          title={rows.length ? 'Nothing matches' : 'No comparisons yet'}
          text={
            rows.length
              ? 'Change the search text.'
              : 'Put devices from any measurements into groups (for example a reference and two modifications) and see them side by side: box plots, J–V curves, a table and what changed between them. Private until you share it.'
          }
          action={
            !rows.length && (
              <button className="btn" onClick={make}>
                New comparison
              </button>
            )
          }
        />
      ) : (
        <div className="cards">
          {shown.map((r) => (
            <button key={r.id} className="pcard" onClick={() => onOpen(r.id)}>
              <div className="pcard-art cx-art" aria-hidden>
                {Array.from({ length: Math.min(r.groups, 6) }, (_, i) => (
                  <i key={i} style={{ background: seriesColor(i) }} />
                ))}
              </div>
              <div className="pcard-body">
                <div className="pcard-name">{r.name}</div>
                <div className="pcard-sum">
                  {r.groups} group{r.groups === 1 ? '' : 's'}, {r.devices} device{r.devices === 1 ? '' : 's'}
                  {r.mine ? '' : `, by ${r.owner}`}
                </div>
                <div className="pcard-meta">
                  {r.visibility === 'shared' ? <Badge>Shared</Badge> : <Badge tone="ac">Private</Badge>}
                  <span>{fmtDate(r.updated_at)}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ one comparison
function Detail({ id, onBack }: { id: number; onBack: () => void }) {
  const [c, setC] = useState<Comparison | null>(null),
    [err, setErr] = useState(''),
    [sets, setSets] = useState<Record<number, IvSetFull>>({}),
    [missing, setMissing] = useState<number[]>([]),
    [pick, setPick] = useState<string | null>(null), // group id the picker adds to ('' = by name)
    [odd, setOdd] = useState<{ dev: DeviceRow; why: string }[]>([]),
    [saved, setSaved] = useState<'' | 'saving' | 'saved'>('');
  const load = () =>
    api<Comparison>('/comparisons/' + id)
      .then(setC)
      .catch((e) => setErr(e.message));
  useEffect(() => {
    load();
  }, [id]);
  // measurements used by the groups, loaded once each (and again when one changes)
  const setIds = useMemo(
    () => [...new Set((c?.data.groups ?? []).flatMap((g) => g.members.map((m) => m.set)))].sort((a, b) => a - b),
    [c],
  );
  const loadSets = (ids: number[], force = false) => {
    const need = force ? ids : ids.filter((x) => !sets[x]);
    if (!need.length) return;
    Promise.all(
      need.map((x) =>
        api<IvSetFull>('/iv/' + x)
          .then((s) => [x, s] as const)
          .catch(() => [x, null] as const),
      ),
    ).then((got) => {
      setSets((o) => {
        const n = { ...o };
        for (const [x, s] of got) if (s) n[x] = s;
        return n;
      });
      setMissing((o) => [
        ...new Set([
          ...o.filter((x) => !got.some(([g, s]) => g === x && s)),
          ...got.filter(([, s]) => !s).map(([x]) => x),
        ]),
      ]);
    });
  };
  useEffect(() => loadSets(setIds), [setIds.join(',')]);
  useRefresh(() => {
    load();
    loadSets(setIds, true);
  }, ['comparisons', 'iv']);

  // saving: every change goes to the server shortly after it is made
  const timer = useRef<number>(0);
  const patch = (p: Partial<Pick<Comparison, 'name' | 'visibility' | 'notes'>> & { data?: CmpData }) => {
    if (!c) return;
    setC({ ...c, ...p, data: p.data ?? c.data });
    if (!c.editable) return;
    setSaved('saving');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(
      () =>
        api('/comparisons/' + id, 'PATCH', p)
          .then(() => setSaved('saved'))
          .catch((e) => {
            setErr(e.message);
            setSaved('');
          }),
      p.data ? 500 : 700,
    );
  };
  const setData = (d: Partial<CmpData>) => c && patch({ data: { ...c.data, ...d } });
  const setGroups = (groups: Group[]) => setData({ groups });

  if (!c) return <p className="mut">{err || 'Loading…'}</p>;
  const groups = c.data.groups,
    dir = c.data.dir ?? 'rev',
    ref = groups.find((g) => g.ref),
    rel = !!c.data.relative && !!ref;
  const del = () =>
    window.confirm(`Move “${c.name}” to the trash?`) &&
    api('/comparisons/' + id, 'DELETE')
      .then(() => {
        trashed('cmp', id, c.name);
        onBack();
      })
      .catch((e) => setErr(e.message));
  const copy = () =>
    api<{ id: number }>('/comparisons', 'POST', {
      name: `${c.name} (copy)`,
      visibility: 'private',
      notes: c.notes,
      data: c.data,
    })
      .then(() => onBack())
      .catch((e) => setErr(e.message));

  const addMembers = (gid: string | null, devs: DeviceRow[]) => {
    const ms: Member[] = devs.map((d) => ({ set: d.set, sample: d.sample, substrate: d.substrate }));
    const inAny = new Set(groups.flatMap((g) => g.members.map(memberKey)));
    if (gid === null) {
      // by name: one group per modification; joins groups of the same name, reference kept
      const { groups: made, odd: o } = autoGroups(devs.filter((d) => !inAny.has(memberKey(d))));
      const next = groups.filter((g) => g.members.length || g.name.trim() !== 'Reference' || !made.some((m) => m.ref));
      for (const m of made) {
        const same = next.find((g) => g.name.trim().toLowerCase() === m.name.trim().toLowerCase());
        if (same) same.members = [...same.members, ...m.members];
        else next.push({ ...m, ref: m.ref && !next.some((g) => g.ref) });
      }
      setGroups(next.map((g) => ({ ...g, members: [...g.members] })));
      setOdd(o);
    } else
      setGroups(
        groups.map((g) =>
          g.id === gid ? { ...g, members: [...g.members, ...ms.filter((m) => !inAny.has(memberKey(m)))] } : g,
        ),
      );
    setPick(null);
  };

  return (
    <>
      <div className="lib-bar cx-head">
        <button className="link" onClick={onBack}>
          ‹ Comparisons
        </button>
        <input
          className="title-input"
          aria-label="Name"
          value={c.name}
          readOnly={!c.editable}
          onChange={(e) => patch({ name: e.target.value || 'Comparison' })}
        />
        <span className="mut small cx-saved" aria-live="polite">
          {saved === 'saving' ? 'Saving…' : saved === 'saved' ? 'Saved' : ''}
        </span>
        {c.editable ? (
          <Seg
            small
            value={c.visibility}
            on={(v) => patch({ visibility: v })}
            opts={[
              ['private', 'Private'],
              ['shared', 'Shared'],
            ]}
          />
        ) : (
          <span className="mut small">By {c.owner} · read only</span>
        )}
        {!c.editable && (
          <button className="btn secondary small-btn" onClick={copy}>
            Make a copy
          </button>
        )}
        {c.editable && (
          <button className="link danger-link" onClick={del}>
            Delete
          </button>
        )}
      </div>
      {err && <p className="err">{err}</p>}
      <div className="cx-layout">
        <GroupRail
          groups={groups}
          sets={sets}
          editable={c.editable}
          onChange={setGroups}
          onAdd={(gid) => setPick(gid)}
        />
        <Results
          c={c}
          groups={groups}
          sets={sets}
          dir={dir}
          rel={rel}
          refGroup={ref}
          missing={missing}
          odd={odd}
          onDismissOdd={() => setOdd([])}
          setDir={(d) => setData({ dir: d })}
          setRel={(r) => setData({ relative: r })}
        />
      </div>
      {pick !== null && (
        <DevicePicker
          groups={groups}
          target={pick}
          onClose={() => setPick(null)}
          onAdd={(gid, devs) => addMembers(gid, devs)}
        />
      )}
    </>
  );
}

// ------------------------------------------------------------------ groups
function GroupRail({
  groups,
  sets,
  editable,
  onChange,
  onAdd,
}: {
  groups: Group[];
  sets: Record<number, IvSetFull>;
  editable: boolean;
  onChange: (g: Group[]) => void;
  onAdd: (gid: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const up = (id: string, p: Partial<Group>) => onChange(groups.map((g) => (g.id === id ? { ...g, ...p } : g)));
  const mods = (g: Group) => {
    const c = new Map<string, number>();
    for (const m of g.members) {
      const k = splitName(m.sample).mod.toLowerCase();
      c.set(k, (c.get(k) ?? 0) + 1);
    }
    return c;
  };
  return (
    <aside className="cx-rail" aria-label="Groups">
      <div className="cx-rail-head">
        <h3>Groups</h3>
        {editable && (
          <button className="btn secondary small-btn" onClick={() => onAdd('')}>
            Add devices
          </button>
        )}
      </div>
      {groups.length === 0 && <p className="mut small">No groups yet.</p>}
      <ol className="cx-groups">
        {groups.map((g, i) => {
          const mc = mods(g),
            main = [...mc.entries()].sort((a, b) => b[1] - a[1])[0]?.[0],
            strays = mc.size > 1 ? g.members.filter((m) => splitName(m.sample).mod.toLowerCase() !== main) : [];
          return (
            <li key={g.id} className={'cx-group' + (g.ref ? ' ref' : '')} style={{ '--g': seriesColor(i) } as any}>
              <div className="cx-group-row">
                <input
                  className="cx-gname"
                  aria-label={`Name of group ${i + 1}`}
                  value={g.name}
                  readOnly={!editable}
                  placeholder="Group name"
                  onChange={(e) => up(g.id, { name: e.target.value })}
                />
                <button
                  className={'cx-ref' + (g.ref ? ' on' : '')}
                  disabled={!editable}
                  aria-pressed={!!g.ref}
                  title="The reference: relative values and “what changed” are against this group"
                  onClick={() => onChange(groups.map((x) => ({ ...x, ref: x.id === g.id ? !g.ref : false })))}
                >
                  {g.ref ? 'Reference' : 'Set as reference'}
                </button>
              </div>
              <div className="cx-group-meta">
                <button
                  className="link small"
                  aria-expanded={open === g.id}
                  onClick={() => setOpen(open === g.id ? null : g.id)}
                >
                  {g.members.length} device{g.members.length === 1 ? '' : 's'}
                </button>
                {strays.length > 0 && (
                  <span
                    className="cx-warn small"
                    title="Their names suggest another modification than most of this group"
                  >
                    {strays.length} name{strays.length > 1 ? 's' : ''} differ
                  </span>
                )}
                <div className="grow" />
                {editable && (
                  <>
                    <button className="link small" onClick={() => onAdd(g.id)}>
                      Add
                    </button>
                    {i > 0 && (
                      <button
                        className="iconbtn small"
                        aria-label="Move up"
                        onClick={() => {
                          const n = [...groups];
                          [n[i - 1], n[i]] = [n[i], n[i - 1]];
                          onChange(n);
                        }}
                      >
                        ↑
                      </button>
                    )}
                    <button
                      className="iconbtn small"
                      aria-label={`Remove group ${g.name}`}
                      onClick={() =>
                        (!g.members.length || window.confirm(`Remove the group “${g.name}”?`)) &&
                        onChange(groups.filter((x) => x.id !== g.id))
                      }
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
              {open === g.id && (
                <ul className="cx-members">
                  {g.members.length === 0 && <li className="mut small">Empty: use Add to pick devices.</li>}
                  {g.members.map((m) => {
                    const s = sets[m.set],
                      stray = strays.includes(m);
                    return (
                      <li key={memberKey(m)} className={stray ? 'stray' : ''}>
                        <span>
                          <b>{m.sample.replace(/_/g, ' ')}</b> · substrate {m.substrate}
                          <span className="mut"> · {s ? s.name : 'measurement not visible'}</span>
                          {stray && <span className="cx-warn"> · name differs</span>}
                        </span>
                        {editable && (
                          <button
                            className="iconbtn small"
                            aria-label={`Remove ${m.sample} ${m.substrate}`}
                            onClick={() =>
                              up(g.id, { members: g.members.filter((x) => memberKey(x) !== memberKey(m)) })
                            }
                          >
                            ✕
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      {editable && (
        <button
          className="link"
          onClick={() =>
            onChange([...groups, { id: newId(), name: `Group ${groups.length + 1}`, ref: !groups.length, members: [] }])
          }
        >
          + New group
        </button>
      )}
    </aside>
  );
}

// ------------------------------------------------------------------ picking devices
function DevicePicker({
  groups,
  target,
  onAdd,
  onClose,
}: {
  groups: Group[];
  target: string;
  onAdd: (gid: string | null, d: DeviceRow[]) => void;
  onClose: () => void;
}) {
  const [all, setAll] = useState<DeviceRow[] | null>(null),
    [err, setErr] = useState(''),
    [q, setQ] = useState(''),
    [set, setSet] = useState(''),
    [who, setWho] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [sel, setSel] = useState<Set<string>>(new Set()),
    [gid, setGid] = useState<string>(target || '__name');
  useEffect(() => {
    api<DeviceRow[]>('/comparisons/devices')
      .then(setAll)
      .catch((e) => setErr(e.message));
  }, []);
  const used = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) for (const x of g.members) m.set(memberKey(x), g.name);
    return m;
  }, [groups]);
  const rows = (all ?? []).filter(
    (d) =>
      (!set || String(d.set) === set) &&
      (!who || d.owner === who) &&
      (!from || d.date >= from) &&
      (!to || d.date <= to) &&
      `${d.sample} ${d.substrate} ${d.setName} ${d.link?.label ?? ''} ${d.group}`
        .toLowerCase()
        .includes(q.toLowerCase()),
  );
  const measurements = [...new Map((all ?? []).map((d) => [d.set, d])).values()];
  const people = [...new Set((all ?? []).map((d) => d.owner))].sort();
  const free = rows.filter((d) => !used.has(memberKey(d)));
  const allOn = free.length > 0 && free.every((d) => sel.has(memberKey(d)));
  const toggle = (k: string) => setSel((s) => (s.has(k) ? new Set([...s].filter((x) => x !== k)) : new Set([...s, k])));
  const chosen = (all ?? []).filter((d) => sel.has(memberKey(d)));
  return (
    <Modal onClose={onClose} wide>
      <header className="modal-head">
        <h2>Add devices</h2>
        <div className="grow" />
        <button className="link" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="cx-filters pad-x">
        <input
          type="search"
          className="lib-search"
          placeholder="Sample, batch or measurement"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search devices"
        />
        <select value={set} onChange={(e) => setSet(e.target.value)} aria-label="Measurement">
          <option value="">Every measurement</option>
          {measurements.map((m) => (
            <option key={m.set} value={m.set}>
              {m.setName} ({m.date})
            </option>
          ))}
        </select>
        <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Measured by">
          <option value="">Anyone</option>
          {people.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <label className="inline small">
          From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="inline small">
          to <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <div className="modal-body">
        {err && <p className="err">{err}</p>}
        {all === null ? (
          <p className="mut">{err ? '' : 'Loading devices…'}</p>
        ) : rows.length === 0 ? (
          <Empty title="No devices match" text="Change the filters above." />
        ) : (
          <table className="list cx-devs">
            <thead>
              <tr>
                <th>
                  <Check v={allOn} on={(v) => setSel(v ? new Set([...sel, ...free.map(memberKey)]) : new Set())} />
                </th>
                <th>Device</th>
                <th>Batch</th>
                <th>Measurement</th>
                <th className="num">Best PCE</th>
                <th className="num">Pixels</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const k = memberKey(d),
                  inG = used.get(k);
                return (
                  <tr key={k} className={inG ? 'mut' : ''} onClick={() => !inG && toggle(k)}>
                    <td onClick={(e) => e.stopPropagation()}>
                      {inG ? '' : <Check v={sel.has(k)} on={() => toggle(k)} />}
                    </td>
                    <td>
                      <b>{d.sample.replace(/_/g, ' ')}</b> · substrate {d.substrate}
                      {inG && <span className="small"> · in “{inG}”</span>}
                      {d.off && (
                        <span className="small cx-warn" title="Left out of the plots in its measurement">
                          {' '}
                          · left out there
                        </span>
                      )}
                    </td>
                    <td>{d.link?.label ?? <span className="mut">not linked</span>}</td>
                    <td>
                      {d.setName} <span className="mut small">{d.date}</span>
                    </td>
                    <td className="num">{d.best ? fmt(d.best) + ' %' : '—'}</td>
                    <td className="num">{d.pixels}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <footer className="cx-pick-foot">
        <span className="small">
          {chosen.length} selected{rows.length !== (all ?? []).length ? ` · ${rows.length} shown` : ''}
        </span>
        <div className="grow" />
        <label className="inline small">
          Put them in
          <select value={gid} onChange={(e) => setGid(e.target.value)} aria-label="Group">
            <option value="__name">groups by name (batch_mod)</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name || 'Unnamed group'}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" disabled={!chosen.length} onClick={() => onAdd(gid === '__name' ? null : gid, chosen)}>
          Add {chosen.length || ''} device{chosen.length === 1 ? '' : 's'}
        </button>
      </footer>
    </Modal>
  );
}

// ------------------------------------------------------------------ results
function useBatches(groups: Group[], sets: Record<number, IvSetFull>) {
  const ids = [
    ...new Set(
      groups.flatMap((g) =>
        g.members
          .map((m) => sets[m.set]?.links[m.sample])
          .filter((l) => l?.kind === 'batch')
          .map((l) => l!.id),
      ),
    ),
  ].sort((a, b) => a - b);
  const [b, setB] = useState<Record<number, Batch | null>>({});
  useEffect(() => {
    const need = ids.filter((x) => !(x in b));
    if (!need.length) return;
    Promise.all(need.map((x) => api<Batch>('/batches/' + x).catch(() => null))).then((got) =>
      setB((o) => ({ ...o, ...Object.fromEntries(need.map((x, i) => [x, got[i]])) })),
    );
  }, [ids.join(',')]);
  return b;
}

/** The recipe values of a group's batches; a value that differs between its batches is shown as varying. */
function groupFacts(g: Group, sets: Record<number, IvSetFull>, batches: Record<number, Batch | null>) {
  const ids = [
    ...new Set(
      g.members
        .map((m) => sets[m.set]?.links[m.sample])
        .filter((l) => l?.kind === 'batch')
        .map((l) => l!.id),
    ),
  ];
  const fs = ids
    .map((x) => batches[x])
    .filter((x): x is Batch => !!x)
    .map(batchFacts);
  if (!fs.length) return { ids, facts: null as Record<string, string> | null };
  const facts: Record<string, string> = {};
  for (const k of new Set(fs.flatMap((f) => Object.keys(f)))) {
    const v = new Set(fs.map((f) => f[k] ?? '—'));
    facts[k] = v.size === 1 ? [...v][0] : `varies (${fs.length} batches)`;
  }
  return { ids, facts };
}

function Results({
  c,
  groups,
  sets,
  dir,
  rel,
  refGroup,
  missing,
  odd,
  onDismissOdd,
  setDir,
  setRel,
}: {
  c: Comparison;
  groups: Group[];
  sets: Record<number, IvSetFull>;
  dir: Dir | 'both';
  rel: boolean;
  refGroup?: Group;
  missing: number[];
  odd: { dev: DeviceRow; why: string }[];
  onDismissOdd: () => void;
  setDir: (d: Dir | 'both') => void;
  setRel: (r: boolean) => void;
}) {
  const [dens, setDens] = useState(false),
    [outl, setOutl] = useOutliers(),
    [logo, setLogo] = useLogoChoice(),
    fs = useFigureSettings(),
    hasLogo = !!(fs.watermark || fs.group);
  const boxRef = useRef<SVGSVGElement>(null),
    jvRef = useRef<SVGSVGElement>(null),
    slide = useSlide(),
    [figErr, setFigErr] = useState('');
  const batches = useBatches(groups, sets);
  const all = useMemo(() => cmpRows(groups, sets), [groups, sets]);
  const anyRev = all.some((r) => r.dir === 'rev');
  const d: Dir | 'both' = anyRev ? dir : 'fwd';
  const dirs: Dir[] = d === 'both' ? ['rev', 'fwd'] : [d];
  const abs = all.filter((r) => dirs.includes(r.dir));
  const { rows, missing: noRef } = useMemo(
    () =>
      rel
        ? relative(
            abs,
            refGroup?.id,
            METRICS.map((m) => m.key),
          )
        : { rows: abs, missing: 0 },
    [abs, rel, refGroup?.id],
  );
  const loading = groups.some((g) => g.members.some((m) => !sets[m.set] && !missing.includes(m.set)));
  const unit = (k: MetricKey) => (rel ? '× ref' : METRICS.find((m) => m.key === k)!.unit);
  const digits = (k: MetricKey) => (rel ? 3 : METRICS.find((m) => m.key === k)!.digits);
  const panels = BOX_KEYS.map((k) => ({
    key: k,
    title: rel ? <>{METRICS.find((m) => m.key === k)!.label} relative to the reference</> : TITLES[k],
    unit: unit(k),
    digits: digits(k),
    groups: groups
      .map((g, gi) => ({ g, gi }))
      .filter(({ g }) => rows.some((r) => r.gid === g.id))
      .map(({ g, gi }): BoxGroup => ({
        label: g.name || 'Unnamed group',
        series: dirs.map((dd) => {
          const rs = rows.filter((r) => r.gid === g.id && r.dir === dd && hasValue(r, k)),
            best = rs.reduce<CRow | null>((b, r) => (!b || r.m.pce > b.m.pce ? r : b), null);
          return {
            label: dirs.length > 1 ? DIR_NAME[dd] : '',
            color: gColor(gi),
            light: dd === 'fwd' && dirs.length > 1,
            stats: summarize(rs, k),
            points: rs.map((r) => ({
              v: r.m[k] as number,
              best: r === best,
              tip: `${r.sample.replace(/_/g, ' ')} · substrate ${r.substrate} · pixel ${r.pixel} · ${r.set}`,
            })),
          };
        }),
      })),
  }));
  // J–V: the best pixel of each group (absolute values), in the group's colour
  const jvItems: CmpItem[] = groups.flatMap((g, gi) => {
    const rs = abs.filter((r) => r.gid === g.id),
      b = rs.reduce<CRow | null>((x, r) => (!x || r.m.pce > x.m.pce ? r : x), null);
    if (!b) return [];
    const s = sets[b.setId],
      cs = s.curves.filter((x) => x.sample === b.sample && x.substrate === b.substrate && x.pixel === b.pixel);
    return [
      {
        key: g.id,
        label: g.name || 'Unnamed group',
        curves: bestScan(cs).curves,
        link: s.links[b.sample] ?? null,
        color: gColor(gi),
      },
    ];
  });
  // table
  const stat = (g: Group, k: MetricKey) =>
    summarize(
      rows.filter((r) => r.gid === g.id && hasValue(r, k)),
      k,
    );
  const refStat = refGroup ? stat(refGroup, 'pce') : null;
  const table = groups.map((g, gi) => {
    const rs = rows.filter((r) => r.gid === g.id);
    return {
      g,
      gi,
      devices: new Set(rs.map((r) => r.dev)).size,
      listed: g.members.length,
      pixels: rs.length,
      s: Object.fromEntries(METRICS.map((m) => [m.key, stat(g, m.key)])) as Record<MetricKey, ReturnType<typeof stat>>,
      best: Math.max(0, ...abs.filter((r) => r.gid === g.id).map((r) => r.m.pce)),
    };
  });
  const delta = (t: (typeof table)[number]) =>
    !refGroup || t.g.id === refGroup.id || !t.s.pce || !refStat
      ? null
      : rel
        ? (t.s.pce.median - 1) * 100
        : ((t.s.pce.median - refStat.median) / refStat.median) * 100;
  // what changed
  const refF = refGroup ? groupFacts(refGroup, sets, batches) : null;
  const changes = groups
    .filter((g) => refGroup && g.id !== refGroup.id && g.members.length)
    .map((g) => {
      const f = groupFacts(g, sets, batches),
        modR = [...new Set(refGroup!.members.map((m) => splitName(m.sample).mod))],
        modG = [...new Set(g.members.map((m) => splitName(m.sample).mod))];
      const same = !!refF && f.ids.length > 0 && f.ids.join() === refF.ids.join();
      return {
        g,
        same,
        noBatch: !f.facts || !refF?.facts,
        diff: f.facts && refF?.facts && !same ? diffFacts(refF.facts, f.facts) : [],
        names: modR.join(', ') !== modG.join(', ') ? [modR.join(', '), modG.join(', ')] : null,
      };
    });

  const sub = `${new Set(rows.map((r) => r.gid)).size} groups · ${new Set(rows.map((r) => r.dev)).size} devices · ${DIR_NAME[d].toLowerCase()} scans${rel ? ` · relative to ${refGroup!.name}` : ''}`;
  const fileBase = safe(c.name);
  const slideEl = (
    <SlideFrame svgRef={slide.ref} title={c.name} sub={sub} compact>
      <svg x={80} y={210} width={1080} height={(1080 * BFH) / BFW} viewBox={`0 0 ${BFW} ${BFH}`}>
        <BoxFigure panels={panels} outliers={outl} />
      </svg>
      {jvItems.length > 0 && (
        <svg x={1190} y={210} width={640} height={(640 * 520) / 760} viewBox="0 0 760 520">
          <CompareFigure items={jvItems} dir={d} logo={false} />
        </svg>
      )}
      {/* median PCE of each group under the J–V figure, in the group colour */}
      <g fontFamily="Inter, 'Segoe UI', Helvetica, Arial, sans-serif">
        <text x={1210} y={720} fontSize={26} fill="#5f6570">
          {rel ? 'Median PCE, relative to the reference' : 'Median PCE'}
        </text>
        {table
          .filter((t) => t.s.pce)
          .slice(0, 6)
          .map((t, i) => {
            const dl = delta(t),
              y = 780 + i * 52;
            return (
              <g key={t.g.id}>
                <rect x={1210} y={y - 24} width={16} height={30} rx={4} fill={gColor(t.gi)} />
                <text x={1240} y={y} fontSize={30} fill="#15171a">
                  {(t.g.name || 'Unnamed group').slice(0, 22) + (t.g.ref ? ' (ref.)' : '')}
                </text>
                <text x={1700} y={y} fontSize={30} fontWeight={700} fill="#15171a" textAnchor="end">
                  {rel ? `${fmt(t.s.pce!.median, 3)}×` : `${fmt(t.s.pce!.median)} %`}
                </text>
                {dl !== null && (
                  <text x={1830} y={y} fontSize={26} fill={dl >= 0 ? '#1d7a34' : '#d70015'} textAnchor="end">
                    {`${dl >= 0 ? '+' : '−'}${Math.abs(dl).toFixed(1)} %`}
                  </text>
                )}
              </g>
            );
          })}
      </g>
    </SlideFrame>
  );
  const excel = () => {
    const mk = METRICS.map((m) => m.key);
    const sheets: Sheet[] = [
      {
        name: 'Groups',
        rows: [
          [
            'Group',
            'Reference',
            'Devices',
            'Pixels',
            ...mk.flatMap((k) => [`${k} median`, `${k} mean`, `${k} sd`]),
            'Best PCE (%)',
            'PCE median vs reference (%)',
          ],
          ...table.map((t) => [
            t.g.name,
            t.g.ref ? 'yes' : '',
            t.devices,
            t.pixels,
            ...mk.flatMap((k) => [t.s[k]?.median ?? null, t.s[k]?.mean ?? null, t.s[k]?.sd ?? null]),
            t.best || null,
            delta(t),
          ]),
          [],
          [`${DIR_NAME[d]} scans${rel ? `, values relative to ${refGroup!.name} (same measurement)` : ''}`],
        ],
        widths: [24, 10, 8, 8],
      },
      {
        name: 'Pixels',
        rows: [
          ['Group', 'Measurement', 'Date', 'Sample', 'Substrate', 'Pixel', 'Scan', 'Direction', ...mk],
          ...rows.map((r) => [
            r.group,
            r.set,
            r.date,
            r.sample,
            r.substrate,
            r.pixel,
            r.scan,
            r.dir === 'rev' ? 'backward' : 'forward',
            ...mk.map((k) => (Number.isFinite(r.m[k] as number) ? (r.m[k] as number) : null)),
          ]),
        ],
        widths: [20, 24, 11, 24, 9, 6, 6, 10],
      },
      {
        name: 'What changed',
        rows: [
          ['Group', 'What', `Reference${refGroup ? ` (${refGroup.name})` : ''}`, 'This group'],
          ...changes.flatMap((x) => [
            ...(x.names ? [[x.g.name, 'Sample names', x.names[0], x.names[1]]] : []),
            ...x.diff.map(([a, r, v]) => [x.g.name, a, r, v]),
          ]),
        ],
        widths: [20, 40, 30, 30],
      },
    ];
    downloadBytes(`${fileBase}.xlsx`, xlsx(sheets));
  };
  const fig = (r: React.RefObject<SVGSVGElement | null>, name: string, as: 'png' | 'svg') =>
    r.current && exportSvg(r.current, name, as).catch((e) => setFigErr(e.message));

  const nothing = !groups.some((g) => g.members.length);
  return (
    <section className="cx-results" aria-label="Results">
      <div className="inline cx-controls">
        {anyRev && (
          <Seg
            small
            value={d}
            on={setDir}
            opts={[
              ['rev', 'Backward'],
              ['fwd', 'Forward'],
              ['both', 'Both'],
            ]}
          />
        )}
        <Seg
          small
          value={rel ? 'rel' : 'abs'}
          on={(v) => setRel(v === 'rel')}
          opts={[
            ['abs', 'Absolute'],
            ['rel', 'Relative to reference'],
          ]}
        />
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
        <ExportMenu
          disabled={!rows.length}
          items={[
            ['Slide (16:9)', (as) => slide.make(slideEl, `${fileBase}-slide`, as)],
            ['Box plots', (as) => fig(boxRef, `${fileBase}-boxplots`, as)],
            ['J–V curves', (as) => fig(jvRef, `${fileBase}-jv`, as)],
          ]}
          onExcel={excel}
        />
      </div>
      {!refGroup && c.data.relative && (
        <p className="mut small">Mark one group as the reference to see values relative to it.</p>
      )}
      {rel && noRef > 0 && (
        <p className="cx-note small">
          {noRef} pixel curve{noRef > 1 ? 's are' : ' is'} left out: no reference device in the same measurement.
        </p>
      )}
      {missing.length > 0 && (
        <p className="cx-note small">
          {missing.length} measurement{missing.length > 1 ? 's are' : ' is'} not visible to you (private or deleted);
          their devices are left out.
        </p>
      )}
      {odd.length > 0 && (
        <div className="cx-note small">
          <b>Check these names</b> (grouped by the part after the first underscore):
          <ul>
            {odd.slice(0, 8).map((o) => (
              <li key={memberKey(o.dev)}>
                {o.dev.sample} · substrate {o.dev.substrate} ({o.dev.setName}): {o.why}
              </li>
            ))}
            {odd.length > 8 && <li>and {odd.length - 8} more</li>}
          </ul>
          <button className="link small" onClick={onDismissOdd}>
            Done
          </button>
        </div>
      )}
      {figErr && <p className="err small">{figErr}</p>}
      {nothing ? (
        <Empty
          title="Pick the devices to compare"
          text="Use Add devices to choose devices from any measurement. Group them by name (batch_mod: one group per modification) or put them in a group yourself, then mark the reference."
        />
      ) : loading && !rows.length ? (
        <p className="mut">Loading measurements…</p>
      ) : !rows.length ? (
        <p className="mut">
          No counted pixels in these devices{rel ? ' with a reference in the same measurement' : ''}.
        </p>
      ) : (
        <>
          <figure className="cx-fig">
            <div className="fig-wrap">
              <BoxFigure
                svgRef={boxRef}
                panels={panels}
                showDensity={dens}
                outliers={outl}
                logo={logo && hasLogo ? fs : undefined}
              />
            </div>
          </figure>
          <div className="cx-table scroll">
            <table className="stat-table">
              <thead>
                <tr>
                  <th>Group</th>
                  <th className="num">Devices</th>
                  <th className="num">Pixels</th>
                  <th className="num">PCE {rel ? '(× ref)' : '(%)'}</th>
                  <th className="num">Voc</th>
                  <th className="num">Jsc</th>
                  <th className="num">FF</th>
                  <th className="num">vs ref.</th>
                </tr>
              </thead>
              <tbody>
                {table.map((t) => {
                  const dl = delta(t),
                    med = (k: MetricKey) => (t.s[k] ? fmt(t.s[k]!.median, digits(k)) : '—');
                  return (
                    <tr key={t.g.id}>
                      <td>
                        <i className="cx-sw" style={{ background: seriesColor(t.gi) }} />
                        {t.g.name || 'Unnamed group'}
                        {t.g.ref && <span className="mut small"> · reference</span>}
                      </td>
                      <td className="num">
                        {t.devices}
                        {t.devices < t.listed && <span className="mut small"> of {t.listed}</span>}
                      </td>
                      <td className="num">{t.pixels}</td>
                      <td className="num">
                        <b>{med('pce')}</b>
                        {t.s.pce && t.s.pce.n > 1 && (
                          <span className="mut small"> ± {fmt(t.s.pce.sd, rel ? 3 : 2)}</span>
                        )}
                      </td>
                      <td className="num">{med('voc')}</td>
                      <td className="num">{med('jsc')}</td>
                      <td className="num">{med('ff')}</td>
                      <td className={'num' + (dl === null ? '' : dl >= 0 ? ' up' : ' down')}>
                        {dl === null ? '' : `${dl >= 0 ? '+' : '−'}${Math.abs(dl).toFixed(1)} %`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mut small">
              Medians of the counted pixels (± standard deviation for PCE); each pixel once per direction with its best
              scan, never a check sweep.
              {rel ? ' Each value is divided by the reference median of its own measurement.' : ''}
            </p>
          </div>
          <div className="cx-split">
            {jvItems.length > 0 && (
              <figure className="cx-fig">
                <div className="fig-wrap">
                  <CompareFigure items={jvItems} dir={d} svgRef={jvRef} logo={logo && hasLogo} />
                </div>
                <figcaption className="mut small">Best pixel of each group, its best scan.</figcaption>
              </figure>
            )}
            {refGroup && changes.length > 0 && (
              <section className="cx-changes" aria-label="What changed">
                <h3>What changed against {refGroup.name || 'the reference'}</h3>
                {changes.map((x) => (
                  <div key={x.g.id} className="cx-change" style={{ '--g': seriesColor(groups.indexOf(x.g)) } as any}>
                    <h4>{x.g.name || 'Unnamed group'}</h4>
                    {x.names && (
                      <p className="small">
                        Sample names: <s className="mut">{x.names[0]}</s> → <b>{x.names[1]}</b>
                      </p>
                    )}
                    {x.noBatch ? (
                      <p className="mut small">
                        Recipes are compared from batches, and these devices (or the reference) are not linked to a
                        batch: link the samples to their batches in the measurement.
                      </p>
                    ) : x.same ? (
                      <p className="mut small">
                        Same batch as the reference: the recipes are the same, so what differs is not recorded in the
                        app
                        {x.names ? ' beyond the sample names' : ''}.
                      </p>
                    ) : x.diff.length === 0 ? (
                      <p className="mut small">Different batches with the same recipes.</p>
                    ) : (
                      <table className="cx-diff">
                        <thead>
                          <tr>
                            <th />
                            <th>{refGroup.name || 'Reference'}</th>
                            <th>{x.g.name || 'This group'}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {x.diff.map(([a, r, v]) => (
                            <tr key={a}>
                              <th>{a}</th>
                              <td className="mut">{r}</td>
                              <td>{v}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                ))}
              </section>
            )}
          </div>
        </>
      )}
      {slide.holder}
    </section>
  );
}

function ExportMenu({
  items,
  onExcel,
  disabled,
}: {
  items: [string, (as: 'png' | 'svg') => void][];
  onExcel: () => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false),
    ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const f = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', f);
    return () => document.removeEventListener('mousedown', f);
  }, [open]);
  const pick = (fn: () => void) => () => {
    fn();
    setOpen(false);
  };
  return (
    <div className="ov-exp" ref={ref}>
      <button
        className="btn secondary small-btn"
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Export
      </button>
      {open && (
        <div className="ov-exp-menu" role="menu">
          {items.map(([label, fn]) => (
            <div key={label} className="ov-exp-row">
              <span>{label}</span>
              <button className="link" onClick={pick(() => fn('png'))}>
                PNG
              </button>
              <button className="link" onClick={pick(() => fn('svg'))}>
                SVG
              </button>
            </div>
          ))}
          <div className="ov-exp-row">
            <span>Table and every pixel</span>
            <button className="link" onClick={pick(onExcel)}>
              Excel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
