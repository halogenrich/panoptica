import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Chem } from '@psc/core';
import { api } from '../api';
import { PrefCtx } from '../ctx';
import { useChems } from '../views/common';
import { norm, type Ctx, type Design, type Kind, type Rec, type RunField } from '../recipes/types';
import { RunInput, fmtRun, runError } from './RunInputs';
import { Badge, Empty, Modal, Seg, fmtDate, useToast } from './ui';
import { trashed, useRefresh } from './trash';
import Comments, { useCommentCount } from './Comments';
const CommentsLabel = ({ id }: { id: number }) => {
  const n = useCommentCount('preset', id);
  return <>Comments{n ? ` (${n})` : ''}</>;
};

type Row = Rec;
type FamNode = {
  id: number;
  name: string;
  parent_id: number | null;
  owner: string;
  updated_at: string;
  data?: any;
  hidden?: boolean;
};
type Detail = Row & {
  usage: {
    stacks: { id: number; name: string }[];
    batches: { id: number; code: string }[];
    presets: { id: number; name: string; segment: string }[];
  };
  family: FamNode[];
};
type Draft = { name: string; visibility: 'private' | 'shared'; data: any; parent_id?: number };
type Open = { id: number } | { draft: Draft };

/** Chemical table + every visible preset (solution names for spin dispenses, designs for recipes, all presets for stacks). */
export function useRecipeCtx(openBatch?: (id: number) => void): Ctx {
  const chems = useChems(),
    [all, setAll] = useState<Rec[]>([]),
    [tick, setTick] = useState(0),
    ob = useRef(openBatch);
  ob.current = openBatch;
  useEffect(() => {
    api<Rec[]>('/presets')
      .then(setAll)
      .catch(() => {});
  }, [tick]);
  const cl: Chem[] = useMemo(() => chems.map((c) => ({ n: c.name, f: c.f, M: c.M, pur: c.pur })), [chems]);
  return useMemo(
    () => ({
      chems,
      cl,
      all,
      openBatch: (id: number) => ob.current?.(id),
      refresh: () => setTick((t) => t + 1),
      solutions: all.filter((p) => p.segment === 's1').map((p) => p.name),
      designs: all
        .filter((p) => p.segment === 'sub' || p.segment === 'mask')
        .map((r) => ({ id: r.id, name: r.name, segment: r.segment as Design['segment'], data: r.data })),
    }),
    [chems, cl, all],
  );
}

export default function Library({
  kind,
  openId,
  onOpenBatch,
}: {
  kind: Kind;
  openId?: number | null;
  onOpenBatch?: (id: number) => void;
}) {
  const ctx = useRecipeCtx(onOpenBatch),
    { prefs } = useContext(PrefCtx),
    toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null),
    [scope, setScope] = useState<'all' | 'mine' | 'shared'>('all'),
    [q, setQ] = useState('');
  const [layout, setLayout] = useState<'cards' | 'list'>(() => {
    try {
      return (localStorage.getItem('psc.layout') as 'cards' | 'list') || 'cards';
    } catch {
      return 'cards';
    }
  });
  const [open, setOpen] = useState<Open | null>(openId ? { id: openId } : null);
  const load = () =>
    api<Row[]>('/presets?segment=' + kind.segment)
      .then(setRows)
      .catch(() => setRows([]));
  useEffect(() => {
    setRows(null);
    load();
  }, [kind.segment]);
  useRefresh(load, ['presets']);
  useEffect(() => {
    if (openId) setOpen({ id: openId });
  }, [openId]);
  useEffect(() => {
    try {
      localStorage.setItem('psc.layout', layout);
    } catch {
      /* storage unavailable */
    }
  }, [layout]);

  const shown = (rows ?? []).filter(
    (r) =>
      (scope === 'all' || (scope === 'mine' ? r.mine : r.visibility === 'shared')) &&
      r.name.toLowerCase().includes(q.toLowerCase()),
  );
  const create = () => setOpen({ draft: { name: '', visibility: prefs.vis, data: kind.defaults() } });

  return (
    <>
      <div className="lib-bar">
        <Seg
          value={scope}
          opts={[
            ['all', 'All'],
            ['mine', 'Mine'],
            ['shared', 'Shared'],
          ]}
          on={setScope}
          small
        />
        <input
          className="lib-search"
          type="search"
          placeholder={`Search ${kind.title.toLowerCase()}`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="grow" />
        <span className="hide-phone">
          <Seg
            value={layout}
            opts={[
              ['cards', 'Cards'],
              ['list', 'List'],
            ]}
            on={setLayout}
            small
          />
        </span>
        <button className="btn" onClick={create}>
          New {kind.noun}
        </button>
      </div>

      {rows === null ? (
        <div className="cards">
          {[0, 1, 2].map((i) => (
            <div key={i} className="pcard skeleton" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        rows.length === 0 ? (
          <Empty
            title={`No ${kind.title.toLowerCase()} yet`}
            text={`Create your first ${kind.noun}. It is saved as a reusable preset.`}
            action={
              <button className="btn" onClick={create}>
                New {kind.noun}
              </button>
            }
          />
        ) : (
          <Empty title="Nothing matches" text="Change the filter or the search text." />
        )
      ) : layout === 'cards' ? (
        <div className="cards">
          {shown.map((r) => {
            const d = norm(kind, r.data);
            return (
              <button key={r.id} className="pcard" onClick={() => setOpen({ id: r.id })}>
                <div className="pcard-art">
                  <kind.Visual d={d} ctx={ctx} />
                </div>
                <div className="pcard-body">
                  <div className="pcard-name">{r.name}</div>
                  <div className="pcard-sum">{kind.summary(d, ctx)}</div>
                  <div className="pcard-meta">
                    <span>{r.mine ? 'You' : r.owner}</span>
                    {r.visibility === 'shared' && <Badge>Shared</Badge>}
                    {r.used > 0 && <Badge tone="ac">In use</Badge>}
                    {r.parent_id && <Badge>Version</Badge>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <section className="group scroll flush">
          <table className="list">
            <thead>
              <tr>
                <th>Name</th>
                <th>Summary</th>
                <th>Owner</th>
                <th />
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="click" onClick={() => setOpen({ id: r.id })}>
                  <td>
                    <b>{r.name}</b>
                  </td>
                  <td className="mut">{kind.summary(norm(kind, r.data), ctx)}</td>
                  <td>{r.mine ? 'You' : r.owner}</td>
                  <td>
                    {r.visibility === 'shared' && <Badge>Shared</Badge>} {r.used > 0 && <Badge tone="ac">In use</Badge>}
                  </td>
                  <td className="mut">{fmtDate(r.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {open && (
        <PresetSheet
          key={'id' in open ? 'p' + open.id : 'new'}
          kind={kind}
          ctx={ctx}
          open={open}
          onClose={() => setOpen(null)}
          onOpen={(id) => setOpen({ id })}
          onDuplicate={(draft) => setOpen({ draft })}
          onChanged={(msg) => {
            load();
            ctx.refresh();
            if (msg) toast.show(msg);
          }}
        />
      )}
      {toast.node}
    </>
  );
}

export function PresetSheet({
  kind,
  ctx,
  open,
  onClose,
  onOpen,
  onDuplicate,
  onChanged,
}: {
  kind: Kind;
  ctx: Ctx;
  open: Open;
  onClose: () => void;
  onOpen: (id: number) => void;
  onDuplicate: (d: Draft) => void;
  onChanged: (msg?: string) => void;
}) {
  const isNew = !('id' in open);
  const [det, setDet] = useState<Detail | null>(null),
    [err, setErr] = useState('');
  const [mode, setMode] = useState<'view' | 'edit'>(isNew ? 'edit' : 'view');
  const [draft, setDraft] = useState<Draft | null>(isNew ? open.draft : null),
    [base, setBase] = useState(isNew ? JSON.stringify(open.draft) : '');
  const [tab, setTab] = useState<'recipe' | 'runs' | 'history' | 'comments'>('recipe'),
    [pane, setPane] = useState<'in' | 'out'>('in'),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [naming, setNaming] = useState<string | null>(null); // the "Name and save" box, open when not null

  const fetchDet = (id: number) =>
    api<Detail>('/presets/' + id)
      .then((d) => {
        setDet(d);
        setErr('');
      })
      .catch((e) => setErr(e.message));
  useEffect(() => {
    if ('id' in open) fetchDet(open.id);
  }, []);

  const dirty = mode === 'edit' && draft !== null && JSON.stringify(draft) !== base;
  const edit = () => {
    if (!det) return;
    const d: Draft = { name: det.name, visibility: det.visibility, data: norm(kind, det.data) };
    setDraft(d);
    setBase(JSON.stringify(d));
    setMode('edit');
    setPane('in');
  };
  const leaveEdit = () => {
    setConfirm(false);
    if (isNew) onClose();
    else {
      setMode('view');
      setDraft(null);
    }
  };
  const tryClose = () => {
    if (dirty) setConfirm(true);
    else if (mode === 'edit' && !isNew) leaveEdit();
    else onClose();
  };
  const usage = det?.usage,
    uses = usage ? usage.stacks.length + usage.batches.length + (usage.presets?.length ?? 0) : 0,
    forks = !isNew && det !== null && (uses > 0 || !det.mine);

  /** Saves the draft; `name` comes from the "Name and save" box when the title was left empty. */
  const save = async (name?: string) => {
    const nm = (name ?? draft?.name ?? '').trim();
    if (!draft || !nm) {
      setNaming('');
      return;
    }
    if (name !== undefined) setDraft({ ...draft, name: nm });
    setNaming(null);
    setBusy(true);
    try {
      const data = kind.prepareSave ? await kind.prepareSave(draft.data, ctx) : draft.data;
      const body = {
        segment: kind.segment,
        name: nm,
        visibility: draft.visibility,
        data,
        parent_id: draft.parent_id ?? null,
      };
      if (isNew) {
        const r = await api<{ id: number }>('/presets', 'POST', body);
        onChanged(`Saved “${body.name}”`);
        onOpen(r.id);
      } else {
        const r = await api<{ id: number; forked: boolean; name: string; reasons?: string[] }>(
          '/presets/' + det!.id,
          'PUT',
          body,
        );
        onChanged(
          r.forked ? `Saved as new version “${r.name}” (original ${r.reasons?.join(', ')})` : `Saved “${r.name}”`,
        );
        if (r.forked) onOpen(r.id);
        else {
          await fetchDet(r.id);
          setMode('view');
          setDraft(null);
        }
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const del = async () => {
    if (!det || !window.confirm(`Move “${det.name}” to the trash? You can restore it for 30 days (Library › Trash).`))
      return;
    try {
      await api('/presets/' + det.id, 'DELETE');
      onChanged();
      trashed('preset', det.id, det.name);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const dup = () =>
    det &&
    onDuplicate({
      name: det.name.replace(/ v\d+$/, '') + ' copy',
      visibility: det.visibility,
      data: norm(kind, det.data),
      parent_id: det.id,
    });

  if (!isNew && !det)
    return (
      <Modal onClose={onClose}>
        <div className="modal-body pad">
          <p className="mut">{err || 'Loading…'}</p>
        </div>
      </Modal>
    );

  // ---------- edit mode: two panes, inputs and live output ----------
  if (mode === 'edit' && draft) {
    const d = norm(kind, draft.data),
      set = (p: object) => setDraft({ ...draft, data: { ...draft.data, ...p } });
    return (
      <Modal onClose={tryClose} wide>
        <header className="modal-head">
          <input
            className="title-input"
            placeholder={`Name this ${kind.noun}`}
            value={draft.name}
            autoFocus={isNew}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <Seg
            value={draft.visibility}
            opts={[
              ['private', 'Private'],
              ['shared', 'Shared'],
            ]}
            on={(v) => setDraft({ ...draft, visibility: v })}
            small
          />
        </header>
        {forks && (
          <div className="notice">
            {uses > 0
              ? `Used by ${[...usage!.stacks.map((s) => 'stack ' + s.name), ...usage!.batches.map((b) => 'batch ' + b.code), ...(usage!.presets ?? []).map((p) => p.name)].join(', ')}`
              : `Owned by ${det!.owner}`}
            : saving creates a new version and keeps the original unchanged.
          </div>
        )}
        {kind.wideEditor ? (
          <div className="modal-body wide-editor">
            <kind.Editor d={d} set={set} ctx={ctx} />
          </div>
        ) : (
          <>
            <div className="phone-only pad-x">
              <Seg
                value={pane}
                opts={[
                  ['in', 'Inputs'],
                  ['out', 'Output'],
                ]}
                on={setPane}
              />
            </div>
            <div className="modal-body two">
              <div className={'pane form' + (pane === 'out' ? ' hide-phone' : '')}>
                <kind.Editor d={d} set={set} ctx={ctx} />
              </div>
              <div className={'pane out' + (pane === 'in' ? ' hide-phone' : '')}>
                <div className="pane-label">Output</div>
                <kind.Output d={d} ctx={ctx} />
              </div>
            </div>
          </>
        )}
        <footer className="modal-foot">
          {confirm ? (
            <>
              <span>Discard unsaved changes?</span>
              <div className="grow" />
              <button className="link" onClick={() => setConfirm(false)}>
                Keep editing
              </button>
              <button className="btn danger" onClick={leaveEdit}>
                Discard
              </button>
            </>
          ) : (
            <>
              {err && <span className="err">{err}</span>}
              <div className="grow" />
              <button className="link" onClick={tryClose}>
                Cancel
              </button>
              {draft.name.trim() ? (
                <button className="btn" disabled={busy} onClick={() => save()}>
                  {forks ? 'Save as new version' : 'Save'}
                </button>
              ) : (
                <div className="name-save">
                  {naming !== null && (
                    <form
                      className="name-pop"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (naming.trim()) save(naming);
                      }}
                    >
                      <label htmlFor="name-pop-input">Name this {kind.noun}</label>
                      <input
                        id="name-pop-input"
                        autoFocus
                        value={naming}
                        placeholder={`e.g. ${kind.summary(norm(kind, draft.data), ctx).split(' · ')[0]}`}
                        onChange={(e) => setNaming(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            e.stopPropagation(); // closes this box, not the editor
                            setNaming(null);
                          }
                        }}
                      />
                      <div className="inline">
                        <span className="mut small">You can rename it later.</span>
                        <div className="grow" />
                        <button type="button" className="link" onClick={() => setNaming(null)}>
                          Cancel
                        </button>
                        <button className="btn" disabled={busy || !naming.trim()}>
                          Save
                        </button>
                      </div>
                    </form>
                  )}
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => setNaming(naming === null ? '' : null)}
                    aria-expanded={naming !== null}
                  >
                    Name and save
                  </button>
                </div>
              )}
            </>
          )}
        </footer>
      </Modal>
    );
  }

  // ---------- view mode ----------
  const p = det!,
    d = norm(kind, p.data),
    facts = kind.describe(d, ctx);
  return (
    <Modal onClose={onClose} wide>
      <header className="modal-head">
        <div className="title-block">
          <h2>{p.name}</h2>
          <div className="pcard-meta">
            <span>
              {p.mine ? 'You' : p.owner} · updated {fmtDate(p.updated_at)}
            </span>
            {p.visibility === 'shared' && <Badge>Shared</Badge>}
            {uses > 0 && <Badge tone="ac">In use</Badge>}
          </div>
        </div>
        <div className="grow" />
        <div className="head-actions">
          {kind.viewActions?.({ id: p.id, name: p.name, d, ctx })}
          <button className="link" onClick={dup}>
            Duplicate
          </button>
          {(p.mine || false) && (
            <button className="link" onClick={del}>
              Delete
            </button>
          )}
          <button className="btn" onClick={edit}>
            Edit
          </button>
        </div>
        <button className="iconbtn head-close" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </header>
      <div className="pad-x">
        <Seg
          value={tab}
          opts={[
            [
              'recipe',
              kind.segment === 'stk'
                ? 'Stack'
                : kind.segment === 'sub' || kind.segment === 'mask'
                  ? 'Design'
                  : 'Recipe',
            ],
            ['runs', 'Run data'],
            ['history', 'History'],
            ['comments', <CommentsLabel key="c" id={p.id} />],
          ]}
          on={setTab}
          small
        />
      </div>
      {err && <p className="err pad-x">{err}</p>}
      <div className="modal-body">
        {tab === 'recipe' && kind.wideView && <kind.Output d={d} ctx={ctx} />}
        {tab === 'recipe' && !kind.wideView && (
          <div className="view-grid">
            <aside className="facts">
              {!kind.noFactsArt && (
                <div className="facts-art">
                  <kind.Visual d={d} ctx={ctx} />
                </div>
              )}
              <dl>
                {Object.entries(facts).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              {uses > 0 && (
                <div className="mut small">
                  Used by{' '}
                  {[
                    ...usage!.stacks.map((s) => 'stack ' + s.name),
                    ...usage!.batches.map((b) => 'batch ' + b.code),
                    ...(usage!.presets ?? []).map((p) => p.name),
                  ].join(', ')}
                </div>
              )}
            </aside>
            <div className="out">
              <kind.Output d={d} ctx={ctx} />
            </div>
          </div>
        )}
        {tab === 'runs' && <RunData kind={kind} ctx={ctx} id={p.id} d={d} />}
        {tab === 'history' && <History kind={kind} ctx={ctx} det={p} onOpen={onOpen} />}
        {tab === 'comments' && <Comments kind="preset" id={p.id} />}
      </div>
    </Modal>
  );
}

type RunDraft = { batch: string; values: Record<string, string>; notes: string; deviation: string };

/** Form for one run-data entry: actual values next to the recipe values, deviation and notes. Batch codes are suggested. */
/** Staged fields as a grid (rows = stages, columns = measured quantities); the rest as a list. */
function splitFields(kind: Kind, d: any, fields: RunField[]) {
  const staged = fields.filter((f) => f.stage !== undefined),
    plain = fields.filter((f) => f.stage === undefined);
  const stages = staged.length ? (kind.runStages?.(d) ?? []) : [],
    cols = [...new Set(staged.map((f) => f.col ?? f.label))];
  const at = (i: number, c: string) => staged.find((f) => f.stage === i && (f.col ?? f.label) === c);
  return { plain, stages, cols, at, unitOf: (c: string) => staged.find((f) => (f.col ?? f.label) === c)?.unit };
}

/** Form for one run-data entry: actual values next to the recipe values, deviation and notes. Batch codes are suggested. */
export function RunForm({
  kind,
  ctx,
  d,
  presetId,
  batch = '',
  onDone,
  onCancel,
}: {
  kind: Kind;
  ctx: Ctx;
  d: any;
  presetId: number;
  batch?: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<RunDraft>({ batch, values: {}, notes: '', deviation: '' }),
    [err, setErr] = useState(''),
    [codes, setCodes] = useState<string[]>([]);
  useEffect(() => {
    api<{ code: string }[]>('/batches')
      .then((l) => setCodes(l.map((x) => x.code)))
      .catch(() => {});
  }, []);
  const fields = kind.runFields(d, ctx),
    listId = 'codes' + presetId,
    g = splitFields(kind, d, fields);
  const val = (k: string) => form.values[k] ?? '',
    put = (k: string) => (v: string) => setForm((f) => ({ ...f, values: { ...f.values, [k]: v } }));
  // the exponent of the last pressure typed, so the next one starts there
  const ex = (() => {
    let e = -6;
    for (const f of fields)
      if (f.input === 'sci') {
        const m = val(f.key).split('e')[1];
        if (m && /^-?\d+$/.test(m)) e = +m;
      }
    return e;
  })();
  const problems = fields.map((f) => [f, runError(f, form.values[f.key])] as const).filter(([, e]) => e);
  const save = () => {
    if (problems.length) return setErr(`${problems[0][0].label}: ${problems[0][1]}`);
    api(`/presets/${presetId}/runs`, 'POST', form)
      .then(onDone)
      .catch((e) => setErr(e.message));
  };
  const cell = (f: RunField) => {
    const e = runError(f, form.values[f.key]);
    return (
      <>
        <RunInput f={f} value={val(f.key)} on={put(f.key)} ex={ex} />
        {e && <div className="field-err">{e}</div>}
      </>
    );
  };
  return (
    <div className="run-form">
      <div className="inline">
        <label className="inline">
          Batch code{' '}
          <input
            list={listId}
            value={form.batch}
            onChange={(e) => setForm({ ...form, batch: e.target.value })}
            placeholder="optional"
          />
        </label>
        <datalist id={listId}>
          {codes.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>
      {g.stages.length > 0 && (
        <div className="run-stages">
          <table>
            <thead>
              <tr>
                <th>Stage</th>
                {g.cols.map((c) => (
                  <th key={c}>
                    {c}
                    {g.unitOf(c) ? ` (${g.unitOf(c)})` : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {g.stages.map((s, i) => (
                <tr key={i}>
                  <td>
                    <b>{s.label}</b>
                    {s.expected && <div className="mut small">{s.expected}</div>}
                  </td>
                  {g.cols.map((c) => {
                    const f = g.at(i, c);
                    return <td key={c}>{f ? cell(f) : null}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <table>
        <thead>
          <tr>
            <th>Value</th>
            <th>Recipe</th>
            <th>Actual</th>
          </tr>
        </thead>
        <tbody>
          {g.plain.map((f) => (
            <tr key={f.key}>
              <td>{f.label}</td>
              <td className="mut">{f.expected ?? ''}</td>
              <td>{cell(f)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {kind.runResult?.(d, form.values, ctx)}
      <textarea
        placeholder="Deviation from the procedure"
        value={form.deviation}
        onChange={(e) => setForm({ ...form, deviation: e.target.value })}
      />
      <textarea placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      <div className="inline">
        {err && <span className="err">{err}</span>}
        <div className="grow" />
        <button className="link" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn" onClick={save}>
          Save run data
        </button>
      </div>
    </div>
  );
}

export type Run = {
  id: number;
  batch?: string;
  created_at: string;
  author: string;
  mine: number;
  values: Record<string, string>;
  notes: string;
  deviation: string;
  preset?: string;
};

/** One saved run-data entry. */
export function RunEntry({
  kind,
  ctx,
  d,
  r,
  onDelete,
  title,
}: {
  kind: Kind;
  ctx: Ctx;
  d: any;
  r: Run;
  onDelete?: () => void;
  title?: React.ReactNode;
}) {
  const g = splitFields(kind, d, kind.runFields(d, ctx)),
    has = (f?: RunField) => !!(f && r.values[f.key]);
  const rows = g.stages.map((s, i) => ({ s, i })).filter(({ i }) => g.cols.some((c) => has(g.at(i, c))));
  return (
    <section className="group">
      <div className="inline">
        {title}
        <b>{fmtDate(r.created_at)}</b>
        <span className="mut">{r.author}</span>
        {r.batch && <Badge>{r.batch}</Badge>}
        <div className="grow" />
        {r.mine && onDelete ? (
          <button
            className="link"
            onClick={() => window.confirm('Delete this entry?') && api('/runs/' + r.id, 'DELETE').then(onDelete)}
          >
            Delete
          </button>
        ) : null}
      </div>
      {rows.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Stage</th>
              {g.cols.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ s, i }) => (
              <tr key={i}>
                <td>{s.label}</td>
                {g.cols.map((c) => {
                  const f = g.at(i, c);
                  return <td key={c}>{f && has(f) ? <b>{fmtRun(f, r.values[f.key])}</b> : '—'}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {g.plain.some(has) && (
        <table>
          <thead>
            <tr>
              <th>Value</th>
              <th>Recipe</th>
              <th>Actual</th>
            </tr>
          </thead>
          <tbody>
            {g.plain.filter(has).map((f) => (
              <tr key={f.key}>
                <td>{f.label}</td>
                <td className="mut">{f.expected}</td>
                <td>
                  <b>{fmtRun(f, r.values[f.key])}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {kind.runResult?.(d, r.values, ctx)}
      {r.deviation && (
        <p>
          <span className="mut">Deviation:</span> {r.deviation}
        </p>
      )}
      {r.notes && (
        <p>
          <span className="mut">Notes:</span> {r.notes}
        </p>
      )}
    </section>
  );
}

function RunData({ kind, ctx, id, d }: { kind: Kind; ctx: Ctx; id: number; d: any }) {
  const [runs, setRuns] = useState<Run[] | null>(null),
    [adding, setAdding] = useState(false);
  const load = () => api<Run[]>(`/presets/${id}/runs`).then(setRuns);
  useEffect(() => {
    load();
  }, [id]);
  if (adding)
    return (
      <RunForm
        kind={kind}
        ctx={ctx}
        d={d}
        presetId={id}
        onCancel={() => setAdding(false)}
        onDone={() => {
          setAdding(false);
          load();
        }}
      />
    );
  return (
    <>
      <div className="inline" style={{ marginBottom: 12 }}>
        <span className="mut">Values recorded while running this recipe, from your lab notes.</span>
        <div className="grow" />
        <button className="btn" onClick={() => setAdding(true)}>
          Add run data
        </button>
      </div>
      {runs === null ? (
        <p className="mut">Loading…</p>
      ) : runs.length === 0 ? (
        <Empty title="No run data yet" text="Add an entry after running this recipe." />
      ) : (
        runs.map((r) => <RunEntry key={r.id} kind={kind} ctx={ctx} d={d} r={r} onDelete={load} />)
      )}
    </>
  );
}

function History({ kind, ctx, det, onOpen }: { kind: Kind; ctx: Ctx; det: Detail; onOpen: (id: number) => void }) {
  const fam = det.family,
    byId = new Map(fam.map((f) => [f.id, f]));
  const root = fam.find((f) => !f.parent_id || !byId.has(f.parent_id)) ?? fam[0];
  const diff = (f: FamNode) => {
    const par = f.parent_id ? byId.get(f.parent_id) : undefined;
    if (!par || par.hidden || f.hidden) return [];
    const a = kind.describe(norm(kind, par.data), ctx),
      b = kind.describe(norm(kind, f.data), ctx);
    return Object.keys({ ...a, ...b })
      .filter((k) => a[k] !== b[k])
      .map((k) => `${k}: ${a[k] ?? '—'} → ${b[k] ?? '—'}`);
  };
  const node = (f: FamNode, depth: number): React.ReactNode => {
    const kids = fam.filter((c) => c.parent_id === f.id).sort((x, y) => x.id - y.id),
      ch = diff(f);
    return (
      <div key={f.id}>
        <button
          className={'tree-node' + (f.id === det.id ? ' on' : '')}
          style={{ paddingLeft: 10 + depth * 24 }}
          disabled={f.hidden || f.id === det.id}
          onClick={() => onOpen(f.id)}
        >
          <span className="dot" />
          <span>
            <b>{f.name}</b>{' '}
            <span className="mut">
              · {f.owner} · {fmtDate(f.updated_at)}
            </span>
            {ch.length > 0 && (
              <span className="tree-diff">
                {ch.slice(0, 4).join(' · ')}
                {ch.length > 4 ? ` · +${ch.length - 4} more` : ''}
              </span>
            )}
          </span>
        </button>
        {kids.map((k) => node(k, depth + 1))}
      </div>
    );
  };
  return fam.length <= 1 ? (
    <Empty
      title="No other versions"
      text="Editing this preset while it is used by a stack or batch, or duplicating it, creates a new version here."
    />
  ) : (
    <div className="tree">{node(root, 0)}</div>
  );
}
