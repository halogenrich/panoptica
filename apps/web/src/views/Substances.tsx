import { useMemo, useState } from 'react';
import { GHS, casValid, molarMass } from '@psc/core';
import { api } from '../api';
import { refreshAll } from '../lib/trash';
import { Dialog, ROLES, ROLE_LABEL, bottleText, type Chemical } from './common';

/**
 * Inventory › Substances (0.44): what the lab's containers are of. A substance is made when its first container is added or
 * imported; here its identity, roles, hazard pictograms and controls are set, and which of its containers recipes use. There
 * is nothing to add by hand.
 */
export default function Substances({
  chems,
  canEdit,
  reload,
}: {
  chems: Chemical[];
  canEdit: boolean;
  reload: () => void;
}) {
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
      (!ql || [c.name, c.cas, c.f].some((x) => x.toLowerCase().includes(ql))),
  );
  const sel = chems.find((c) => c.id === open);
  return (
    <>
      <div className="inline" style={{ marginBottom: 12 }}>
        <input type="search" placeholder="Search name, CAS, formula" value={q} onChange={(e) => setQ(e.target.value)} />
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
                  <b>{c.name}</b>
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
      {sel && (
        <SubstanceForm
          key={sel.id}
          c={sel}
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
  canEdit,
  onClose,
  onSaved,
}: {
  c: Chemical;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState(c),
    [err, setErr] = useState('');
  const set = (p: Partial<Chemical>) => setF((x) => ({ ...x, ...p }));
  const fromFormula = useMemo(() => (f.f ? molarMass(f.f) : null), [f.f]);
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const save = () =>
    api('/chemicals/' + c.id, 'PUT', {
      name: f.name,
      cas: f.cas,
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
        {err && <p className="err small">{err}</p>}
        <div className="dialog-actions">
          {canEdit && !c.bottles.length && (
            <button
              type="button"
              className="link danger-link"
              onClick={() =>
                window.confirm(`Delete ${c.name}? Recipes that name it will say it is not in the inventory.`) &&
                api('/chemicals/' + c.id, 'DELETE')
                  .then(() => {
                    onSaved();
                    onClose();
                  })
                  .catch((e) => setErr(e.message))
              }
            >
              Delete
            </button>
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
