import { useEffect, useMemo, useRef, useState } from 'react';
import { GHS, casValid, fold, molarMass } from '@psc/core';
import { api } from '../api';
import { refreshAll, showToast, useRefresh } from '../lib/trash';
import { Dialog, ROLES, ROLE_LABEL, bottleText, type Chemical } from './common';
import { Picker } from './Picker';

/**
 * Inventory › Substances (0.44): what the lab's containers are of. A substance is made when its first container is added or
 * imported; here its identity, roles, hazard pictograms and controls are set, and which of its containers recipes use. There
 * is nothing to add by hand.
 */
export default function Substances({
  chems,
  canEdit,
  reload,
  dups: dupsAsked = 0,
}: {
  chems: Chemical[];
  canEdit: boolean;
  reload: () => void;
  /** set (a new value each time) when a notification asks to review possible duplicates (0.54) */
  dups?: number;
}) {
  const [review, setReview] = useState(false),
    pairs = useDuplicates();
  useEffect(() => {
    if (dupsAsked) setReview(true);
  }, [dupsAsked]);
  const [q, setQ] = useState(''),
    [role, setRole] = useState(''),
    [ctl, setCtl] = useState<'' | 'pf' | 'army'>(''),
    [stock, setStock] = useState<'' | 'in' | 'out'>(''),
    [open, setOpen] = useState<number | null>(null);
  const ql = q.toLowerCase();
  const shown = chems.filter(
    (c) =>
      (!role || c.roles.includes(role)) &&
      (!ctl || c[ctl]) &&
      (!stock || (stock === 'in') === c.bottles.length > 0) &&
      (!ql ||
        [c.name, c.s, c.cas, c.f, ...c.aka].some((x) => x.toLowerCase().includes(ql) || fold(x).includes(fold(q)))),
  );
  const sel = chems.find((c) => c.id === open);
  return (
    <>
      <div className="inline" style={{ marginBottom: 12 }}>
        <input
          type="search"
          placeholder="Search name, short name, CAS, formula"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        <select value={ctl} onChange={(e) => setCtl(e.target.value as typeof ctl)} aria-label="Controlled">
          <option value="">Controlled or not</option>
          <option value="pf">Federal Police</option>
          <option value="army">Army</option>
        </select>
        <select value={stock} onChange={(e) => setStock(e.target.value as typeof stock)} aria-label="Stock">
          <option value="">In stock or not</option>
          <option value="in">In stock</option>
          <option value="out">Not in stock</option>
        </select>
      </div>
      <p className="mut small">
        A substance is made when its first container is added or imported. Purity, supplier and lot belong to each
        container.
      </p>
      {pairs.length > 0 && (
        <p className="small dup-note">
          {pairs.length === 1 ? '1 pair of substances may be' : `${pairs.length} pairs of substances may be`} the same
          substance.{' '}
          <button className="link" onClick={() => setReview(true)}>
            Review possible duplicates
          </button>
        </p>
      )}
      <section className="group scroll">
        <table className="list inv-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Roles</th>
              <th>Formula</th>
              <th>M (g/mol)</th>
              <th>Recipes use</th>
              <th>Controlled</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.id} className="clickable" onClick={() => setOpen(c.id)}>
                <td>
                  <b>{c.s || c.name}</b>
                  {c.s && <div className="mut small">{c.name}</div>}
                  {c.cas && <div className="mut small">CAS {c.cas}</div>}
                </td>
                <td className="small">{c.roles.map((r) => ROLE_LABEL[r] ?? r).join(', ') || '—'}</td>
                <td>{c.f || '—'}</td>
                <td>{c.M ? c.M.toFixed(2) : <span className="err small">missing</span>}</td>
                <td className="small">
                  {c.bottle ? (
                    <>
                      {bottleText(c.bottle)}
                      {c.bottles.length > 1 && <div className="mut">{c.bottles.length} containers</div>}
                    </>
                  ) : (
                    <span className="mut">Not in stock</span>
                  )}
                </td>
                <td className="small">{[c.pf && 'Federal Police', c.army && 'Army'].filter(Boolean).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && (
          <p className="mut">
            {chems.length ? 'Nothing matches.' : 'No substances yet: add or import containers and they appear here.'}
          </p>
        )}
      </section>
      {review && (
        <Duplicates
          canEdit={canEdit}
          onClose={() => setReview(false)}
          onChanged={() => {
            reload();
            refreshAll();
          }}
        />
      )}
      {sel && (
        <SubstanceForm
          key={sel.id}
          c={sel}
          chems={chems}
          canEdit={canEdit}
          onClose={() => setOpen(null)}
          onSaved={() => {
            reload();
            refreshAll();
          }}
        />
      )}
    </>
  );
}

const numOrNull = (v: string) => (v.trim() === '' ? null : +v);

function SubstanceForm({
  c,
  chems,
  canEdit,
  onClose,
  onSaved,
}: {
  c: Chemical;
  chems: Chemical[];
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState(c),
    [aka, setAka] = useState(c.aka.join('; ')),
    [into, setInto] = useState<string | null>(null),
    [err, setErr] = useState(''),
    mergeRef = useRef<HTMLDivElement>(null);
  // the merge part opens at the bottom of the dialog: brought into view
  useEffect(() => {
    if (into === '') mergeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [into === '']);
  const set = (p: Partial<Chemical>) => setF((x) => ({ ...x, ...p }));
  const fromFormula = useMemo(() => (f.f ? molarMass(f.f) : null), [f.f]);
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const save = () =>
    api('/chemicals/' + c.id, 'PUT', {
      name: f.name,
      cas: f.cas,
      s: f.s.trim(),
      aka: aka
        .split(/[;\n]/)
        .map((x) => x.trim())
        .filter(Boolean),
      f: f.f,
      M: f.M || 0,
      d: f.d,
      mp: f.mp,
      bp: f.bp,
      nD: f.nD,
      roles: f.roles,
      ghs: f.ghs,
      pf: f.pf,
      army: f.army,
      notes: f.notes,
    })
      .then(() => {
        onSaved();
        onClose();
      })
      .catch((e) => setErr(e.message));
  const trash = () =>
    api('/chemicals/' + c.id, 'DELETE')
      .then(() => {
        showToast(`${c.name} moved to the trash, with its containers`);
        onSaved();
        onClose();
      })
      .catch((e) => setErr(e.message));
  const target = chems.find((x) => String(x.id) === into);
  const merge = () =>
    target &&
    window.confirm(
      `Merge ${c.name} into ${target.name}? Its containers and the recipes that name it move to ${target.name}, and its names become other names of ${target.name}. This cannot be undone.`,
    ) &&
    api(`/chemicals/${c.id}/merge`, 'POST', { into: target.id })
      .then(() => {
        showToast(`${c.name} merged into ${target.name}`);
        onSaved();
        onClose();
      })
      .catch((e) => setErr(e.message));
  const use = (id: number) =>
    api(`/inventory/containers/${id}/use`, 'PUT', { use: true })
      .then(onSaved)
      .catch((e) => setErr(e.message));
  return (
    <Dialog title={c.name} onClose={onClose} wide>
      <form
        className="box-form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <fieldset disabled={!canEdit}>
          <div className="grid2">
            <label className="fld">
              <span>Name</span>
              <input value={f.name} onChange={(e) => set({ name: e.target.value })} />
            </label>
            <label className="fld">
              <span>Short name</span>
              <input value={f.s} placeholder="DMF" onChange={(e) => set({ s: e.target.value })} />
              <span className="mut small">Shown in recipes and lists in place of the name.</span>
            </label>
            <label className="fld span2">
              <span>Other names</span>
              <input value={aka} onChange={(e) => setAka(e.target.value)} />
              <span className="mut small">Search finds it by these too. Separate them with “;”.</span>
            </label>
            <label className="fld">
              <span>CAS number</span>
              <input value={f.cas} placeholder="10101-63-0" onChange={(e) => set({ cas: e.target.value })} />
              {f.cas && !casValid(f.cas) && <span className="err small">The check digit is wrong.</span>}
            </label>
            <label className="fld">
              <span>Formula</span>
              <input value={f.f} placeholder="PbI2" onChange={(e) => set({ f: e.target.value })} />
            </label>
            <label className="fld">
              <span>Molar mass</span>
              <span className="with-unit">
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={f.M || ''}
                  onChange={(e) => set({ M: +e.target.value || 0 })}
                />
                <i>g/mol</i>
              </span>
              {fromFormula !== null && Math.abs(fromFormula - (f.M || 0)) > 0.05 && (
                <button type="button" className="link small" onClick={() => set({ M: fromFormula })}>
                  {f.M ? 'The formula gives' : 'Use'} {fromFormula.toFixed(2)} g/mol
                </button>
              )}
            </label>
            <label className="fld">
              <span>Density</span>
              <span className="with-unit">
                <input
                  type="number"
                  step="any"
                  value={f.d ?? ''}
                  onChange={(e) => set({ d: numOrNull(e.target.value) })}
                />
                <i>g/mL</i>
              </span>
            </label>
            <label className="fld">
              <span>Refractive index</span>

              <input
                type="number"
                step="any"
                value={f.nD ?? ''}
                onChange={(e) => set({ nD: numOrNull(e.target.value) })}
              />
            </label>
            <label className="fld">
              <span>Melting point</span>
              <span className="with-unit">
                <input
                  type="number"
                  step="any"
                  value={f.mp ?? ''}
                  onChange={(e) => set({ mp: numOrNull(e.target.value) })}
                />
                <i>°C</i>
              </span>
            </label>
            <label className="fld">
              <span>Boiling point</span>
              <span className="with-unit">
                <input
                  type="number"
                  step="any"
                  value={f.bp ?? ''}
                  onChange={(e) => set({ bp: numOrNull(e.target.value) })}
                />
                <i>°C</i>
              </span>
            </label>
          </div>
          <div className="fld">
            <span>Roles</span>
            <div className="chips" role="group" aria-label="Roles">
              {ROLES.filter((r) => r !== 'other').map((r) => (
                <button
                  key={r}
                  type="button"
                  className={'chip' + (f.roles.includes(r) ? ' on' : '')}
                  aria-pressed={f.roles.includes(r)}
                  onClick={() => set({ roles: toggle(f.roles, r) })}
                >
                  {ROLE_LABEL[r]}
                </button>
              ))}
            </div>
          </div>
          <div className="fld">
            <span>Hazard pictograms</span>
            <div className="chips" role="group" aria-label="Hazard pictograms">
              {Object.entries(GHS).map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  className={'chip' + (f.ghs.includes(k) ? ' on' : '')}
                  aria-pressed={f.ghs.includes(k)}
                  title={k}
                  onClick={() => set({ ghs: toggle(f.ghs, k) })}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          <label className="check">
            <input type="checkbox" checked={f.pf} onChange={(e) => set({ pf: e.target.checked })} /> Controlled by the
            Federal Police
          </label>
          <label className="check">
            <input type="checkbox" checked={f.army} onChange={(e) => set({ army: e.target.checked })} /> Controlled by
            the Army
          </label>
          <label className="fld">
            <span>Notes</span>
            <textarea rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
          </label>
        </fieldset>
        <h3 className="form-h">Containers in stock</h3>
        {c.bottles.length ? (
          <table className="list small">
            <tbody>
              {c.bottles.map((b) => (
                <tr key={b.id}>
                  <td>{bottleText(b)}</td>
                  <td className="nowrap">
                    {b.amount ?? '?'} {b.unit}
                  </td>
                  <td className="mut">{b.place || 'No storage place'}</td>
                  <td className="nowrap" style={{ textAlign: 'right' }}>
                    {c.bottle?.id === b.id ? (
                      <span className="badge ac">Used in recipes</span>
                    ) : (
                      canEdit && (
                        <button type="button" className="link small" onClick={() => use(b.id)}>
                          Use in recipes
                        </button>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mut small">None. Recipes that name it say it is not in stock.</p>
        )}
        {c.bottles.length > 1 && (
          <p className="mut small">Recipes take the purity of the one they use to work out the masses to weigh.</p>
        )}
        {into !== null && (
          <div className="merge-into" ref={mergeRef}>
            <h3 className="form-h">Merge into another substance</h3>
            <p className="mut small">
              For the same substance entered twice. Its containers and the recipes that name it move to the one you
              pick.
            </p>
            <div className="inline">
              <Picker
                label="Substance to keep"
                empty="Pick the substance to keep"
                value={into}
                onChange={setInto}
                options={chems
                  .filter((x) => x.id !== c.id)
                  .map((x) => ({
                    value: String(x.id),
                    label: x.name,
                    short: x.s || undefined,
                    other: [...x.aka, x.f, x.cas].filter(Boolean),
                    hint: x.cas ? `CAS ${x.cas}` : undefined,
                  }))}
              />
              <button type="button" className="btn" disabled={!target} onClick={merge}>
                Merge
              </button>
            </div>
          </div>
        )}
        {err && <p className="err small">{err}</p>}
        <div className="dialog-actions">
          {canEdit && (
            <>
              <button type="button" className="link danger-link" onClick={trash}>
                Move to trash
              </button>
              <button type="button" className="link" onClick={() => setInto(into === null ? '' : null)}>
                Merge into…
              </button>
            </>
          )}
          <div className="grow" />
          <button type="button" className="link" onClick={onClose}>
            {canEdit ? 'Cancel' : 'Close'}
          </button>
          {canEdit && <button className="btn">Save changes</button>}
        </div>
      </form>
    </Dialog>
  );
}

type Pair = { why: 'cas' | 'name' | 'formula'; a: Chemical; b: Chemical };
/** Possible duplicates (0.54), read again when the inventory changes. */
function useDuplicates() {
  const [l, setL] = useState<Pair[]>([]);
  const load = () => {
    api<Pair[]>('/chemicals/duplicates')
      .then(setL)
      .catch(() => {});
  };
  useEffect(load, []);
  useRefresh(load, ['inventory']);
  return l;
}
const WHY: Record<Pair['why'], string> = {
  cas: 'Same CAS number',
  name: 'A name of one is a name of the other',
  formula: 'Same formula, no CAS numbers that differ',
};

/**
 * Possible duplicates (0.54): pairs that may be one substance entered twice. Nothing is merged by itself: for each pair, keep
 * one (the other is merged into it) or say they are not the same, and the pair is not shown again.
 */
function Duplicates({ canEdit, onClose, onChanged }: { canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  const pairs = useDuplicates(),
    [err, setErr] = useState('');
  const keep = (k: Chemical, gone: Chemical) =>
    window.confirm(
      `Keep ${k.name} and merge ${gone.name} into it? Containers and recipes of ${gone.name} move to ${k.name}. This cannot be undone.`,
    ) &&
    api(`/chemicals/${gone.id}/merge`, 'POST', { into: k.id })
      .then(() => {
        showToast(`${gone.name} merged into ${k.name}`);
        onChanged();
      })
      .catch((e) => setErr(e.message));
  const notSame = (p: Pair) =>
    api('/chemicals/duplicates/not', 'POST', { a: p.a.id, b: p.b.id })
      .then(() => {
        showToast('Marked as different substances');
        onChanged();
      })
      .catch((e) => setErr(e.message));
  const side = (c: Chemical, other: Chemical) => (
    <div className="dup-side">
      <b>{c.name}</b>
      <div className="mut small">
        {[c.s && `Short name ${c.s}`, c.cas && `CAS ${c.cas}`, c.f].filter(Boolean).join(' · ') ||
          'No CAS number or formula'}
      </div>
      <div className="small">
        {c.bottles.length
          ? `${c.bottles.length} container${c.bottles.length === 1 ? '' : 's'} in stock`
          : 'Not in stock'}
      </div>
      {canEdit && (
        <button className="btn secondary small-btn" onClick={() => keep(c, other)}>
          Keep this one
        </button>
      )}
    </div>
  );
  return (
    <Dialog title="Possible duplicates" onClose={onClose} wide>
      {pairs.length ? (
        <>
          <p className="mut small">
            Keep one of each pair: the other is merged into it, with its containers and the recipes that name it.
          </p>
          <ul className="dup-list">
            {pairs.map((p) => (
              <li key={`${p.a.id}:${p.b.id}`} className="dup-pair">
                <div className="dup-why small mut">{WHY[p.why]}</div>
                <div className="dup-sides">
                  {side(p.a, p.b)}
                  {side(p.b, p.a)}
                </div>
                {canEdit && (
                  <div className="inline dup-actions">
                    <div className="grow" />
                    <button className="link" onClick={() => notSame(p)}>
                      Not a duplicate
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mut">No possible duplicates left.</p>
      )}
      {err && <p className="err small">{err}</p>}
    </Dialog>
  );
}
