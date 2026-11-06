import { Suspense, lazy, useContext, useMemo, useState } from 'react';
import { newId } from '@psc/core';
import { api } from '../api';
import { PrefCtx } from '../ctx';
import { PresetSheet } from '../lib/Library';
import { usePrint } from '../lib/ui';
import { DragHandle, useReorder } from '../views/common';
import { KINDS } from '../recipes';
import { Section } from '../recipes/shared';
import { norm, type Ctx, type Kind, type Rec } from '../recipes/types';
import {
  METHODS,
  TEMPLATES,
  presetName,
  slotKey,
  slotMaterial,
  slotReady,
  slotsFor,
  substrateOfPreset,
  viewSlabs,
  geometryOf,
  type Method,
  type Slot,
  type StackD,
} from './model';
import { defaultLook, isCustom, lookOf, type Appearance } from './appearance';
import RunSheet from './RunSheet';

const Viewer3D = lazy(() => import('./Viewer3D'));
const autoThickness = (s: Slot) => (/perovskite/i.test(s.n) ? 500 : /sam|pacz/i.test(s.n) ? 2 : 50);
const defaults = (): StackD => ({ arch: '', sl: [] });
const nstack = (d: StackD): StackD => ({
  ...defaults(),
  ...d,
  sl: (d.sl ?? []).map((s) => ({ ...s, m: s.m as Method })),
});
const Loading = () => (
  <div className="viewer" style={{ height: 520, display: 'grid', placeItems: 'center' }}>
    <span className="mut">Loading 3D view…</span>
  </div>
);

/** 3D view heights that fit the window: the stack's page (in its sheet) and the stack editor, so neither needs scrolling. */
export const FIT_VIEW = 'clamp(240px, calc(100dvh - 250px), 480px)';
export const FIT_EDIT = 'clamp(240px, calc(100dvh - 290px), 560px)';
/** On the batch page: the Schedule button under the view stays on screen. */
export const FIT_BATCH = 'clamp(240px, calc(100dvh - 330px), 440px)';

export function View3D({
  st,
  ctx,
  placed,
  current,
  height,
  cog,
  corner,
}: {
  st: StackD;
  ctx: Ctx;
  placed?: number;
  current?: number;
  height?: number | string;
  cog?: boolean;
  corner?: React.ReactNode;
}) {
  const v = useMemo(() => viewSlabs(st, ctx, placed, current), [st, ctx, placed, current]);
  return (
    <Suspense fallback={<Loading />}>
      <Viewer3D slabs={v.slabs} w={v.w} h={v.h} height={height} cog={cog} corner={corner} />
    </Suspense>
  );
}

/** Colour, opacity, roughness and metallic of one layer in the 3D view; empty values follow the default for that kind of layer. */
function LookEditor({
  label,
  of,
  ap,
  onChange,
}: {
  label: string;
  of: { kind: string; name: string; mat: string };
  ap?: Appearance;
  onChange: (ap: Appearance | undefined) => void;
}) {
  const L = lookOf(of, ap),
    d = defaultLook(of);
  const set = (k: keyof Appearance, v: string | number) => {
    const n = { ...ap, [k]: v };
    if (n[k] === d[k]) delete n[k];
    onChange(isCustom(n) ? n : undefined);
  };
  const slider = (k: 'o' | 'r' | 'm', name: string) => (
    <label className="look-row">
      <span>{name}</span>
      <input type="range" min={0} max={1} step={0.01} value={L[k]} onChange={(e) => set(k, +e.target.value)} />
      <output>{Math.round(L[k] * 100)} %</output>
    </label>
  );
  return (
    <div className="look">
      <div className="look-head">
        <span className="look-swatch" style={{ background: L.c, opacity: 0.25 + 0.75 * L.o }} />
        <b>{label}</b>
        <label className="look-color">
          <input type="color" value={L.c} onChange={(e) => set('c', e.target.value)} aria-label={`${label} colour`} />
          <span className="mut small">{L.c}</span>
        </label>
        <span className="grow" />
        {isCustom(ap) && (
          <button className="link small" onClick={() => onChange(undefined)}>
            Default
          </button>
        )}
      </div>
      {slider('o', 'Opacity')}
      {slider('r', 'Roughness')}
      {slider('m', 'Metallic')}
    </div>
  );
}

/** Cards of the presets of one kind; the first card creates a new one without leaving the stack. */
function Picker({
  seg,
  value,
  onPick,
  ctx,
  onNew,
  disabled,
}: {
  seg: string;
  value: string;
  onPick: (id: string) => void;
  ctx: Ctx;
  onNew: () => void;
  disabled?: (p: Rec) => string | null;
}) {
  const k = KINDS[seg],
    list = ctx.all.filter((p) => p.segment === seg);
  return (
    <div className="picker">
      <button className="mini new" onClick={onNew}>
        New {k.noun}
      </button>
      {list.map((p) => {
        const why = disabled?.(p) ?? null,
          d = norm(k, p.data);
        return (
          <button
            key={p.id}
            className={'mini' + (String(p.id) === value ? ' on' : '')}
            disabled={!!why}
            title={why ?? k.summary(d, ctx)}
            onClick={() => onPick(String(p.id) === value ? '' : String(p.id))}
          >
            <div className="mini-art">
              <k.Visual d={d} ctx={ctx} />
            </div>
            <div className="mini-body">
              <b>{p.name}</b>
              <span>{why ?? k.summary(d, ctx)}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Editor({ d: raw, set, ctx }: { d: StackD; set: (p: Partial<StackD>) => void; ctx: Ctx }) {
  const st = nstack(raw),
    n = st.sl.length,
    { prefs } = useContext(PrefCtx);
  const [step, setStep] = useState(st.arch ? n + 1 : 0),
    [placed, setPlaced] = useState(st.arch ? n : 0);
  const [nested, setNested] = useState<{ seg: string; pick: (id: string) => void } | null>(null);
  const [styleOpen, setStyleOpen] = useState<Set<string>>(new Set()); // layers whose preview-style controls are shown
  const i = step - 1,
    slot = st.sl[i],
    review = step === n + 1;
  const up = (p: Partial<Slot>) => set({ sl: st.sl.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  /** Forward places the layers passed (they drop in); Back lifts the current layer out again. Jumping via the step list keeps what is placed. */
  const go = (to: number, back = false) => {
    if (to > step) setPlaced((p) => Math.max(p, Math.min(to - 1, n)));
    else if (back && to >= 1 && to <= n) setPlaced((p) => Math.min(p, to - 1));
    setStep(to);
  };
  const g = useMemo(() => geometryOf(st, ctx), [raw, ctx]);
  const metalBlock = (p: Rec) => {
    const s = substrateOfPreset(p);
    return g.subId && s && s !== g.subId ? 'Made for a different substrate' : null;
  };
  const chooseArch = (a: string) => {
    if (
      st.arch &&
      st.arch !== a &&
      st.sl.some(slotReady) &&
      !window.confirm('Changing the architecture replaces the layer list. Continue?')
    )
      return;
    if (st.arch !== a) set({ arch: a, sl: slotsFor(a) });
    setPlaced(0);
    setStep(1);
  };
  const newIn = (seg: string, pick: (id: string) => void) => setNested({ seg, pick });

  const strip = (
    <div className="steps scrollx">
      <button className={'step' + (step === 0 ? ' on' : ' done')} onClick={() => go(0)}>
        <span>A</span>Architecture
      </button>
      {st.sl.map((s, j) => (
        <button
          key={slotKey(s, j)}
          className={'step' + (step === j + 1 ? ' on' : j < placed ? ' done' : '')}
          disabled={!st.arch || j > placed}
          onClick={() => go(j + 1)}
        >
          <span>{j + 1}</span>
          {s.n}
        </button>
      ))}
      <button className={'step' + (review ? ' on' : '')} disabled={!st.arch || placed < n} onClick={() => go(n + 1)}>
        <span>✓</span>Review
      </button>
    </div>
  );
  const label = (k: number) => (k === 0 ? 'Architecture' : k === n + 1 ? 'Review' : (st.sl[k - 1]?.n ?? ''));
  const nav = (
    <div className="wiz-nav">
      {step > 0 && (
        <button className="btn secondary" onClick={() => go(step - 1, true)}>
          ‹ Previous<span className="hide-phone">: {label(step - 1)}</span>
        </button>
      )}
      <div className="grow" />
      {slot && (
        <button className="btn secondary" onClick={() => insertAfter(i)} title={`Add an empty layer after “${slot.n}”`}>
          + New<span className="hide-phone"> layer</span>
        </button>
      )}
      {!review && st.arch && (
        <button className="btn" onClick={() => go(step + 1)}>
          Next<span className="hide-phone">: {label(step + 1)}</span> ›
        </button>
      )}
    </div>
  );
  const insertAfter = (j: number) => {
    set({
      sl: [
        ...st.sl.slice(0, j + 1),
        { id: newId(), n: 'New layer', m: 'Spin', a: '', b: '', t: '' },
        ...st.sl.slice(j + 1),
      ],
    });
    setPlaced(j + 1);
    setStep(j + 2);
  };
  // reordering the review list, which shows the top layer first; the substrate (first slot) never moves
  const reorder = useReorder(st.sl.slice(1).reverse(), (l) => set({ sl: [st.sl[0], ...[...l].reverse()] }), 'layer');
  const removeAt = (j: number) => {
    if (!window.confirm(`Remove “${st.sl[j].n}” from this stack?`)) return;
    set({ sl: st.sl.filter((_, k) => k !== j) });
    setPlaced((p) => Math.min(p, n - 1));
    setStep((x) => (x > n - 1 ? n : x));
  }; // stay on Review (its index drops by one)

  return (
    <div className="wizard">
      {strip}
      <div className="stack-wiz">
        <div className="stack-form">
          {step === 0 && (
            <Section title="Architecture">
              <div className="arch-grid">
                {Object.keys(TEMPLATES).map((a) => (
                  <button key={a} className={'arch' + (st.arch === a ? ' on' : '')} onClick={() => chooseArch(a)}>
                    <h3>{a}</h3>
                    <ol>
                      {[...TEMPLATES[a]].reverse().map(([l]) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ol>
                  </button>
                ))}
              </div>
              <p className="small mut">
                Layers are listed top to bottom. You can rename, skip or add layers in the next steps.
              </p>
            </Section>
          )}
          {slot && (
            <>
              <Section title={`Layer ${step} of ${n}`}>
                <label className="row">
                  <span>Name</span>
                  <input value={slot.n} onChange={(e) => up({ n: e.target.value })} style={{ width: 220 }} />
                </label>
                <label className="row">
                  <span>Method</span>
                  <select value={slot.m} onChange={(e) => up({ m: e.target.value as Method, a: '', b: '' })}>
                    {METHODS.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </label>
                {(slot.m === 'Spin' || slot.m === 'Manual') && (
                  <label className="row">
                    <span>Thickness for the 3D view (nm)</span>
                    <input
                      inputMode="decimal"
                      value={slot.th ?? ''}
                      placeholder={`auto (${autoThickness(slot)})`}
                      onChange={(e) => up({ th: parseFloat(e.target.value) || undefined })}
                      style={{ width: 120, textAlign: 'right' }}
                    />
                  </label>
                )}
              </Section>
              {slot.m === 'Substrate' && (
                <Section title="Substrate prep">
                  <Picker
                    seg="s0"
                    value={slot.a}
                    onPick={(a) => up({ a })}
                    ctx={ctx}
                    onNew={() => newIn('s0', (a) => up({ a }))}
                  />
                </Section>
              )}
              {slot.m === 'Spin' && (
                <>
                  <Section title="Solution">
                    <Picker
                      seg="s1"
                      value={slot.a}
                      onPick={(a) => up({ a })}
                      ctx={ctx}
                      onNew={() => newIn('s1', (a) => up({ a }))}
                    />
                  </Section>
                  <Section title="Spin program">
                    <Picker
                      seg="s2"
                      value={slot.b}
                      onPick={(b) => up({ b })}
                      ctx={ctx}
                      onNew={() => newIn('s2', (b) => up({ b }))}
                    />
                  </Section>
                </>
              )}
              {slot.m === 'Organic evap' && (
                <Section title="Organic layer">
                  <Picker
                    seg="s3"
                    value={slot.a}
                    onPick={(a) => up({ a })}
                    ctx={ctx}
                    onNew={() => newIn('s3', (a) => up({ a }))}
                  />
                </Section>
              )}
              {slot.m === 'Metal evap' && (
                <Section title="Metal contact">
                  {g.subId && (
                    <p className="small mut">
                      Only metal recipes whose mask was drawn for this stack’s substrate can be chosen.
                    </p>
                  )}
                  <Picker
                    seg="s4"
                    value={slot.a}
                    onPick={(a) => up({ a })}
                    ctx={ctx}
                    onNew={() => newIn('s4', (a) => up({ a }))}
                    disabled={metalBlock}
                  />
                </Section>
              )}
              {slot.m === 'Manual' && (
                <Section title="Instructions">
                  <textarea
                    value={slot.t}
                    onChange={(e) => up({ t: e.target.value })}
                    placeholder="What to do for this layer (e.g. CBD SnO2, ALD, blade coating…)"
                  />
                </Section>
              )}
              {slotReady(slot) && (
                <Section title="Look in the 3D view">
                  {(() => {
                    const custom = isCustom(slot.ap) || isCustom(slot.apGlass),
                      open = custom || styleOpen.has(slotKey(slot, i));
                    const toggle = (on: boolean) => {
                      if (on) {
                        setStyleOpen((s) => new Set(s).add(slotKey(slot, i)));
                        return;
                      }
                      if (custom && !window.confirm('Go back to the default look for this layer?')) return;
                      setStyleOpen((s) => {
                        const n = new Set(s);
                        n.delete(slotKey(slot, i));
                        return n;
                      });
                      if (custom) up({ ap: undefined, apGlass: undefined });
                    };
                    return (
                      <>
                        <label className="inline small">
                          <input type="checkbox" checked={open} onChange={(e) => toggle(e.target.checked)} /> Change
                          layer preview style
                        </label>
                        {open && (
                          <>
                            {slot.m === 'Substrate' ? (
                              <>
                                <LookEditor
                                  label="Glass"
                                  of={{ kind: 'glass', name: 'Glass', mat: 'Glass' }}
                                  ap={slot.apGlass}
                                  onChange={(apGlass) => up({ apGlass })}
                                />
                                <LookEditor
                                  label="ITO"
                                  of={{ kind: 'ito', name: 'ITO', mat: 'ITO' }}
                                  ap={slot.ap}
                                  onChange={(ap) => up({ ap })}
                                />
                              </>
                            ) : (
                              <LookEditor
                                label={slot.n}
                                of={{
                                  kind: slot.m === 'Metal evap' ? 'metal' : 'film',
                                  name: slot.n,
                                  mat: slotMaterial(slot, ctx),
                                }}
                                ap={slot.ap}
                                onChange={(ap) => up({ ap })}
                              />
                            )}
                            <p className="small mut">
                              Used by the Realistic view (Schematic uses the colour and opacity only).
                            </p>
                          </>
                        )}
                      </>
                    );
                  })()}
                </Section>
              )}
              {!slotReady(slot) && (
                <p className="small mut">
                  Nothing chosen yet. You can leave this layer empty and continue; remove or add layers in the Review
                  step.
                </p>
              )}
            </>
          )}
          {review && (
            <Section title="Review">
              <div className="layer-list">
                {[...st.sl]
                  .map((s, j) => ({ s, j }))
                  .reverse()
                  .map(({ s, j }) => (
                    <div
                      key={slotKey(s, j)}
                      className={'layer-row with-handle' + (j > 0 && reorder.drag === n - 1 - j ? ' dragging' : '')}
                      ref={j > 0 ? reorder.rowRef(n - 1 - j) : undefined}
                    >
                      {/* the substrate stays at the bottom; the layers above it can be dragged into another order */}
                      <DragHandle h={reorder.handle(n - 1 - j)} show={j > 0 && n > 2} />
                      <span className="num">{j + 1}</span>
                      <span>
                        <b>{s.n}</b> <span className="mut small">· {s.m}</span>
                        <br />
                        <span className="small">
                          {s.m === 'Manual'
                            ? s.t || 'No instructions'
                            : [presetName(ctx, s.a), presetName(ctx, s.b)].filter(Boolean).join(' + ') || (
                                <span className="err">No preset chosen</span>
                              )}
                        </span>
                      </span>
                      <span className="inline row-actions">
                        <button className="link" onClick={() => go(j + 1)}>
                          Edit
                        </button>
                        <button
                          className="link"
                          onClick={() => insertAfter(j)}
                          title="Insert a new layer above this one"
                        >
                          Insert above
                        </button>
                        <button className="link danger-link" onClick={() => removeAt(j)}>
                          Remove
                        </button>
                      </span>
                    </div>
                  ))}
              </div>
              {viewSlabs(st, ctx).mismatch && (
                <p className="err small">
                  The metal recipe’s mask was drawn for a different substrate than the substrate prep uses.
                </p>
              )}
              <p className="small mut">
                Drag a layer by its handle to change the order, Insert above to add one, Remove to drop an unused one
                (for example an optional passivation). Save, then use Print run sheet or Start batch from the stack’s
                page.
              </p>
            </Section>
          )}
          {nav}
        </div>
        <div className="stack-view">
          <View3D st={st} ctx={ctx} placed={review ? Infinity : placed} current={i} height={FIT_EDIT} cog />
        </div>
      </div>
      {nested && (
        <PresetSheet
          kind={KINDS[nested.seg]}
          ctx={ctx}
          open={{ draft: { name: '', visibility: prefs.vis, data: KINDS[nested.seg].defaults() } }}
          onClose={() => setNested(null)}
          onDuplicate={() => {}}
          onChanged={() => {}}
          onOpen={(id) => {
            ctx.refresh();
            nested.pick(String(id));
            setNested(null);
          }}
        />
      )}
    </div>
  );
}

function Output({ d: raw, ctx }: { d: StackD; ctx: Ctx; blanks?: boolean }) {
  const st = nstack(raw);
  return (
    <div className="stack-out">
      <View3D st={st} ctx={ctx} height={FIT_VIEW} cog />
      <div className="layer-list">
        {[...st.sl]
          .map((s, j) => ({ s, j }))
          .reverse()
          .map(({ s, j }) => (
            <div key={slotKey(s, j)} className="layer-row">
              <span className="num">{j + 1}</span>
              <span>
                <b>{s.n}</b>{' '}
                <span className="mut small">
                  · {s.m}
                  {s.th ? ` · ${s.th} nm` : ''}
                </span>
                <br />
                <span className="small">
                  {s.m === 'Manual'
                    ? s.t
                    : [presetName(ctx, s.a), presetName(ctx, s.b)].filter(Boolean).join(' + ') || '—'}
                </span>
              </span>
              <span />
            </div>
          ))}
      </div>
    </div>
  );
}

function Actions({ id, name, d, ctx }: { id: number; name: string; d: StackD; ctx: Ctx }) {
  const pr = usePrint(),
    [code, setCode] = useState(''),
    [err, setErr] = useState(''),
    { prefs } = useContext(PrefCtx);
  const start = () => {
    const c =
      code.trim() ||
      'B-' +
        new Date().toISOString().slice(0, 10).replace(/-/g, '') +
        '-' +
        Date.now().toString(36).slice(-3).toUpperCase();
    api<{ id: number }>('/batches', 'POST', {
      code: c,
      name,
      visibility: prefs.vis ?? 'shared',
      stack: { arch: d.arch, sl: d.sl, thumb: d.thumb },
      source: id || undefined,
    })
      .then((r) => ctx.openBatch?.(r.id))
      .catch((e) => setErr(e.message));
  };
  return (
    <>
      {err && <span className="err small">{err}</span>}
      <button className="link" onClick={() => pr.print(<RunSheet st={nstack(d)} ctx={ctx} name={name} />)}>
        Print run sheet
      </button>
      <input className="batch-code" placeholder="Batch code" value={code} onChange={(e) => setCode(e.target.value)} />
      <button className="link" onClick={start}>
        Start batch
      </button>
      {pr.portal}
    </>
  );
}

export const StackIcon = () => (
  <svg width="120" height="80" viewBox="0 0 120 80" aria-hidden>
    {[0, 1, 2, 3, 4].map((k) => (
      <path
        key={k}
        d={`M20 ${58 - k * 9} L60 ${70 - k * 9} L100 ${58 - k * 9} L60 ${46 - k * 9} Z`}
        fill={['#c9d3dc', '#5b8def', '#6b4432', '#7c6fd0', '#d0d4da'][k]}
        opacity=".85"
        stroke="var(--card)"
      />
    ))}
  </svg>
);

export const stack: Kind<StackD> = {
  segment: 'stk',
  title: 'Stacks',
  noun: 'stack',
  defaults,
  Editor,
  Output,
  wideEditor: true,
  wideView: true,
  Visual: ({ d }) => (d.thumb ? <img className="thumb" src={d.thumb} alt="" /> : <StackIcon />),
  summary: (d, ctx) =>
    `${d.arch || 'No architecture'} · ${d.sl?.length ?? 0} layers${
      d.sl?.length
        ? ' · ' +
          d.sl
            .map((s) => presetName(ctx, s.a) || s.n)
            .slice(-2)
            .join(', ')
        : ''
    }`,
  describe: (d, ctx) => ({
    Architecture: d.arch,
    ...Object.fromEntries(
      (d.sl ?? []).map((s, j) => [
        `${j + 1}. ${s.n}`,
        s.m === 'Manual' ? s.t : [presetName(ctx, s.a), presetName(ctx, s.b)].filter(Boolean).join(' + ') || '—',
      ]),
    ),
  }),
  runFields: () => [
    { key: 'devices', label: 'Devices made' },
    { key: 'best', label: 'Best PCE', unit: '%' },
  ],
  viewActions: (p) => <Actions {...p} />,
  prepareSave: async (d, ctx) => {
    try {
      const { renderThumb } = await import('./Viewer3D'),
        v = viewSlabs(nstack(d), ctx);
      return { ...d, thumb: renderThumb(v.slabs, v.w, v.h) };
    } catch {
      return d;
    } // no WebGL: save without a picture
  },
};
