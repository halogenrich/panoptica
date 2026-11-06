import { useEffect, useMemo, useState } from 'react';
import { describeChanges, nextVariantId, type VarChange, type Variant, type Variants as VariantsD } from '@psc/core';
import { api } from '../api';
import { Seg } from '../lib/ui';
import { RemoveRow } from './common';
import { SEG, METHODS, type Method } from '../stacks/model';
import type { Batch } from './Batches';

type P = { id: number; name: string; segment: string; parent_id: number | null };
export const NO_VARIANTS: VariantsD = { control: '', list: [] };

/** The variant a measurement link points at, if the batch still has it. */
export const variantOf = (b: { variants?: VariantsD }, id?: string) =>
  id ? (b.variants?.list ?? []).find((v) => v.id === id) : undefined;

const ADD: [VarChange['t'], string][] = [
  ['recipe', 'Use another recipe'],
  ['additive', 'Add an additive'],
  ['layer', 'Add a layer'],
  ['remove', 'Leave out a layer'],
  ['other', 'Describe another change'],
];

/**
 * Variants of a batch: the default device is the stack the batch was started from; each variant is another stack (a premade
 * variation) or what changes from the default device. Measurements link samples to a variant so statistics and comparisons tell
 * them apart.
 */
export default function Variants({ b, onSaved }: { b: Batch; onSaved: (v: VariantsD) => void }) {
  const v = b.variants ?? NO_VARIANTS,
    sl = b.snapshot.stack.sl,
    [edit, setEdit] = useState<Variant | null>(null),
    [isNew, setIsNew] = useState(false),
    [err, setErr] = useState(''),
    [control, setControl] = useState(v.control);
  useEffect(() => setControl(v.control), [v.control]);

  const toIn = (x: Variant) => ({
    id: x.id,
    name: x.name,
    substrates: x.substrates,
    stack: x.stack?.id ?? null,
    changes: x.changes.map((c) => {
      if (c.t === 'recipe') return { t: c.t, slot: c.slot, which: c.which, id: c.id };
      if (c.t === 'layer') return { t: c.t, after: c.after, n: c.n, m: c.m, a: c.a, b: c.b, th: c.th };
      return c;
    }),
  });
  const save = (list: Variant[], ctl = control) =>
    api<VariantsD>(`/batches/${b.id}/variants`, 'PUT', { control: ctl, list: list.map(toIn) }).then((r) => {
      setErr('');
      onSaved(r);
      return r;
    });

  // a batch that cannot change (locked, or not yours) and has no variants has nothing to show here
  if (!b.editable && !v.list.length) return null;
  const subsField = (value: string, saveTo: (x: string) => void, placeholder: string, label: string) =>
    b.editable ? (
      <input
        defaultValue={value}
        key={value}
        aria-label={label}
        placeholder={placeholder}
        onBlur={(e) => e.target.value.trim() !== value && saveTo(e.target.value.trim())}
      />
    ) : (
      <span>{value || '—'}</span>
    );
  return (
    <section className="group variants">
      <div className="var-head">
        <h3>Variants</h3>
        <div className="grow" />
        {b.editable && !edit && (
          <button
            className="link"
            onClick={() => {
              setIsNew(true);
              setEdit({ id: nextVariantId(v.list), name: '', substrates: '', stack: null, changes: [] });
            }}
          >
            Add variant
          </button>
        )}
      </div>
      {err && <p className="err small">{err}</p>}
      <div className="var-row">
        <div className="var-name">
          <b>Default device</b>
          <span className="mut small">{b.snapshot.stack.arch}, as the batch was started</span>
        </div>
        <div className="var-subs">
          <span className="mut small">Substrates</span>
          {subsField(
            control,
            (x) => {
              setControl(x);
              save(v.list, x).catch((e) => setErr(e.message));
            },
            v.list.length ? 'e.g. 1 to 4' : 'All',
            'Substrates of the default device',
          )}
        </div>
      </div>
      {v.list.map((x) =>
        edit && !isNew && edit.id === x.id ? (
          <Editor
            key={x.id}
            b={b}
            v={edit}
            onChange={setEdit}
            onCancel={() => setEdit(null)}
            onSave={(n) =>
              save(v.list.map((y) => (y.id === n.id ? n : y)))
                .then(() => setEdit(null))
                .catch((e) => setErr(e.message))
            }
          />
        ) : (
          <div key={x.id} className="var-row">
            <div className="var-name">
              <b>{x.name}</b>
              <ul className="var-changes">
                {describeChanges(x, sl).map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
            <div className="var-subs">
              <span className="mut small">Substrates</span>
              {subsField(
                x.substrates,
                (n) =>
                  save(v.list.map((y) => (y.id === x.id ? { ...y, substrates: n } : y))).catch((e) =>
                    setErr(e.message),
                  ),
                'e.g. 5 to 8',
                `Substrates of ${x.name}`,
              )}
            </div>
            {b.editable && !edit && (
              <div className="var-acts">
                <button
                  className="link small"
                  onClick={() => {
                    setIsNew(false);
                    setEdit(structuredClone(x));
                  }}
                >
                  Edit
                </button>
                <button
                  className="link small danger-link"
                  title="Samples linked to it count as the default device afterwards"
                  onClick={() =>
                    window.confirm(
                      `Remove the variant “${x.name}”? Its frozen recipes are deleted, and samples linked to it count as the default device.`,
                    ) && save(v.list.filter((y) => y.id !== x.id)).catch((e) => setErr(e.message))
                  }
                >
                  Remove
                </button>
              </div>
            )}
          </div>
        ),
      )}
      {edit && isNew && (
        <Editor
          b={b}
          v={edit}
          onChange={setEdit}
          onCancel={() => setEdit(null)}
          onSave={(n) =>
            save([...v.list, n])
              .then(() => setEdit(null))
              .catch((e) => setErr(e.message))
          }
        />
      )}
      {!v.list.length && !edit && (
        <p className="mut small">
          Variants are the devices of this batch that differ from the default: another recipe, an additive, a layer
          added or left out, or another stack. Link measured samples to a variant when importing.
        </p>
      )}
    </section>
  );
}

/** Presets of one kind, those of the same family (versions of the given one) first. */
function useOptions(all: P[]) {
  return useMemo(() => {
    const by = new Map(all.map((p) => [p.id, p]));
    const root = (id: number) => {
      let p = by.get(id);
      for (let i = 0; p?.parent_id && by.has(p.parent_id) && i < 50; i++) p = by.get(p.parent_id);
      return p?.id ?? id;
    };
    return (seg: string, near?: string) => {
      const list = all.filter((p) => p.segment === seg);
      if (!near) return { family: [] as P[], rest: list };
      const r = root(+near);
      return {
        family: list.filter((p) => root(p.id) === r && String(p.id) !== near),
        rest: list.filter((p) => root(p.id) !== r),
      };
    };
  }, [all]);
}

function PresetSelect({
  value,
  onChange,
  opts,
  familyLabel,
}: {
  value: string;
  onChange: (id: string) => void;
  opts: { family: P[]; rest: P[] };
  familyLabel: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose…</option>
      {opts.family.length > 0 && (
        <optgroup label={familyLabel}>
          {opts.family.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label={opts.family.length ? 'Others' : 'All'}>
        {opts.rest.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

function Editor({
  b,
  v,
  onChange,
  onCancel,
  onSave,
}: {
  b: Batch;
  v: Variant;
  onChange: (v: Variant) => void;
  onCancel: () => void;
  onSave: (v: Variant) => Promise<unknown>;
}) {
  const [all, setAll] = useState<P[]>([]),
    [mode, setMode] = useState<'changes' | 'stack'>(v.stack ? 'stack' : 'changes'),
    [stackId, setStackId] = useState(v.stack ? String(v.stack.id) : ''),
    [busy, setBusy] = useState(false),
    chems = b.snapshot.chems.map((c: { name: string }) => c.name);
  useEffect(() => {
    api<P[]>('/presets')
      .then(setAll)
      .catch(() => {});
  }, []);
  const opts = useOptions(all),
    sl = b.snapshot.stack.sl,
    source = (b.snapshot as { source?: number }).source;
  const set = (i: number, c: VarChange) => onChange({ ...v, changes: v.changes.map((x, j) => (j === i ? c : x)) });
  const layerSel = (
    value: number | null,
    on: (n: number | null) => void,
    o: { from?: number; whole?: boolean } = {},
  ) => (
    <select value={value ?? ''} onChange={(e) => on(e.target.value === '' ? null : +e.target.value)}>
      {o.whole && <option value="">Whole device</option>}
      {sl.map((s, i) =>
        i < (o.from ?? 0) ? null : (
          <option key={i} value={i}>
            {i + 1}. {s.n}
          </option>
        ),
      )}
    </select>
  );
  const blank = (t: VarChange['t']): VarChange => {
    const spin = Math.max(
      0,
      sl.findIndex((s) => /perovskite/i.test(s.n)),
    );
    switch (t) {
      case 'recipe':
        return { t, slot: spin, which: 'a', id: 0 };
      case 'additive':
        return { t, slot: spin, name: '', amount: '' };
      case 'layer':
        return { t, after: spin, n: '', m: 'Spin', a: '', b: '' };
      case 'remove':
        return { t, slot: Math.max(1, sl.length - 1) };
      default:
        return { t: 'other', slot: null, text: '' };
    }
  };
  const ready =
    v.name.trim() &&
    (mode === 'stack'
      ? !!stackId
      : v.changes.length > 0 &&
        v.changes.every((c) =>
          c.t === 'recipe'
            ? c.id > 0
            : c.t === 'additive'
              ? c.name.trim()
              : c.t === 'layer'
                ? c.n.trim()
                : c.t === 'other'
                  ? c.text.trim()
                  : true,
        ));
  const stacks = opts('stk', source ? String(source) : undefined);

  return (
    <div className="var-edit">
      <div className="var-edit-top">
        <label>
          <span className="mut small">Name</span>
          <input
            value={v.name}
            autoFocus
            placeholder="e.g. 5 % MACl"
            onChange={(e) => onChange({ ...v, name: e.target.value })}
          />
        </label>
        <label>
          <span className="mut small">Substrates</span>
          <input
            value={v.substrates}
            placeholder="e.g. 5 to 8"
            onChange={(e) => onChange({ ...v, substrates: e.target.value })}
          />
        </label>
      </div>
      <Seg
        small
        value={mode}
        on={setMode}
        opts={[
          ['changes', 'Changes to the default device'],
          ['stack', 'Another stack'],
        ]}
      />
      {mode === 'stack' ? (
        <label className="var-stack">
          <span className="mut small">Stack</span>
          <PresetSelect
            value={stackId}
            onChange={setStackId}
            opts={stacks}
            familyLabel="Variations of the batch's stack"
          />
          <span className="mut small">Its recipes are frozen with the variant, like the batch's own.</span>
        </label>
      ) : (
        <>
          <ol className="var-change-list">
            {v.changes.map((c, i) => (
              <li key={i} className="var-change">
                <span className="var-change-k">{ADD.find(([t]) => t === c.t)?.[1]}</span>
                <div className="var-change-f">
                  {c.t === 'recipe' &&
                    (() => {
                      const s = sl[c.slot],
                        seg = c.which === 'b' ? 's2' : (SEG[s?.m as Method] ?? ''),
                        cur = s ? s[c.which] : '';
                      return (
                        <>
                          {layerSel(c.slot, (n) => set(i, { ...c, slot: n ?? 0, which: 'a', id: 0 }))}
                          {s?.m === 'Spin' && (
                            <select
                              value={c.which}
                              onChange={(e) => set(i, { ...c, which: e.target.value as 'a' | 'b', id: 0 })}
                            >
                              <option value="a">Solution</option>
                              <option value="b">Spin program</option>
                            </select>
                          )}
                          {seg ? (
                            <PresetSelect
                              value={c.id ? String(c.id) : ''}
                              onChange={(id) => set(i, { ...c, id: +id || 0 })}
                              opts={opts(seg, cur)}
                              familyLabel={`Versions of ${b.snapshot.resolved[c.slot]?.[c.which]?.name ?? 'this recipe'}`}
                            />
                          ) : (
                            <span className="mut small">This layer has no recipe; describe the change instead.</span>
                          )}
                        </>
                      );
                    })()}
                  {c.t === 'additive' && (
                    <>
                      {layerSel(c.slot, (n) => set(i, { ...c, slot: n ?? 0 }))}
                      <input
                        list="var-chems"
                        placeholder="Additive"
                        value={c.name}
                        onChange={(e) => set(i, { ...c, name: e.target.value })}
                      />
                      <input
                        className="var-amount"
                        placeholder="Amount, e.g. 1 mg/mL"
                        value={c.amount}
                        onChange={(e) => set(i, { ...c, amount: e.target.value })}
                      />
                    </>
                  )}
                  {c.t === 'layer' && (
                    <>
                      <input
                        placeholder="Layer name"
                        value={c.n}
                        onChange={(e) => set(i, { ...c, n: e.target.value })}
                      />
                      <span className="mut small">after</span>
                      {layerSel(c.after, (n) => set(i, { ...c, after: n ?? 0 }))}
                      <select
                        value={c.m}
                        onChange={(e) => set(i, { ...c, m: e.target.value, a: '', b: '' })}
                        aria-label="Method"
                      >
                        {METHODS.filter((m) => m !== 'Substrate').map((m) => (
                          <option key={m}>{m}</option>
                        ))}
                      </select>
                      {SEG[c.m as Method] && (
                        <PresetSelect
                          value={c.a}
                          onChange={(id) => set(i, { ...c, a: id })}
                          opts={opts(SEG[c.m as Method]!)}
                          familyLabel=""
                        />
                      )}
                      {c.m === 'Spin' && (
                        <PresetSelect
                          value={c.b}
                          onChange={(id) => set(i, { ...c, b: id })}
                          opts={opts('s2')}
                          familyLabel=""
                        />
                      )}
                    </>
                  )}
                  {c.t === 'remove' && layerSel(c.slot, (n) => set(i, { ...c, slot: n ?? 1 }), { from: 1 })}
                  {c.t === 'other' && (
                    <>
                      {layerSel(c.slot, (n) => set(i, { ...c, slot: n }), { whole: true })}
                      <input
                        className="var-text"
                        placeholder="e.g. annealed at 120 °C instead of 100 °C"
                        value={c.text}
                        onChange={(e) => set(i, { ...c, text: e.target.value })}
                      />
                    </>
                  )}
                </div>
                <RemoveRow
                  label="Remove this change"
                  onClick={() => onChange({ ...v, changes: v.changes.filter((_, j) => j !== i) })}
                />
              </li>
            ))}
          </ol>
          <datalist id="var-chems">
            {chems.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <div className="var-add">
            {ADD.map(([t, l]) => (
              <button
                key={t}
                className="link small"
                onClick={() => onChange({ ...v, changes: [...v.changes, blank(t)] })}
              >
                {l}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="inline">
        <button
          className="btn"
          disabled={!ready || busy}
          onClick={() => {
            setBusy(true);
            const out: Variant =
              mode === 'stack'
                ? {
                    ...v,
                    changes: [],
                    stack:
                      v.stack && String(v.stack.id) === stackId
                        ? v.stack
                        : ({ id: +stackId, name: '', stack: { arch: '', sl: [] }, resolved: {} } as Variant['stack']),
                  }
                : { ...v, stack: null };
            onSave(out).finally(() => setBusy(false));
          }}
        >
          Save variant
        </button>
        <button className="link" onClick={onCancel}>
          Cancel
        </button>
        {!ready && (
          <span className="mut small">
            {!v.name.trim()
              ? 'Name the variant.'
              : mode === 'stack'
                ? 'Choose the stack.'
                : v.changes.length
                  ? 'Complete each change.'
                  : 'Add what changes from the default device.'}
          </span>
        )}
      </div>
    </div>
  );
}
