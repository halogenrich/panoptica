import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtAmount, forecast, periodStart, series, toBase, useIn, type Period } from '@psc/core';
import { api } from '../api';
import { Badge, Seg, fmtDate } from '../lib/ui';
import { batchUses, type BatchUse } from '../lib/consumption';
import type { Chemical } from './common';
import Chemicals from './Chemicals';

type Shelf = { id: number; name: string; pos: number };
type Icon = 'cabinet' | 'desiccator' | 'glovebox' | 'fridge' | 'freezer' | 'shelf' | 'box' | 'flask' | 'flame' | 'drawer';
type SType = { id: number; name: string; icon: Icon; n: number };
type Area = { id: number; name: string; type_id: number | null; place: string; notes: string; shelves: Shelf[]; created_by_name?: string; created_at: string };
export type Box = {
  id: number; name: string; chem_id: number | null; cas: string; amount: number | null; size: number | null; unit: string; status: 'unopened' | 'in use' | 'empty';
  area_id: number | null; shelf_id: number | null; supplier: string; lot: string; purity: number | null; expires: string | null; opened: string | null; notes: string;
  added_by_name?: string; added_at: string; updated_by_name?: string; updated_at: string | null;
};
type Inv = { types: SType[]; areas: Area[]; containers: Box[] };

const ICONS: Icon[] = ['cabinet', 'drawer', 'shelf', 'desiccator', 'glovebox', 'fridge', 'freezer', 'flame', 'flask', 'box'];
const ICON_NAME: Record<Icon, string> = { cabinet: 'Cabinet', drawer: 'Drawers', shelf: 'Open shelf', desiccator: 'Desiccator', glovebox: 'Glovebox', fridge: 'Fridge', freezer: 'Freezer', flame: 'Flammables', flask: 'Glassware', box: 'Box' };
const UNITS = ['mg', 'g', 'kg', 'µL', 'mL', 'L'];
const STATUS: Box['status'][] = ['unopened', 'in use', 'empty'];
const today = () => new Date().toISOString().slice(0, 10);
const daysTo = (d: string) => Math.round((new Date(d + 'T00:00:00').getTime() - Date.now()) / 864e5);
const typeOf = (inv: Inv, a: Area) => inv.types.find((t) => t.id === a.type_id);

/** Line drawings for storage types. */
function StoreIcon({ k, size = 22 }: { k: Icon; size?: number }) {
  const p: Record<Icon, React.ReactNode> = {
    cabinet: <><rect x="5" y="3" width="14" height="18" rx="1.5" /><path d="M12 3v18M10 12h-.5M14 12h.5" /></>,
    drawer: <><rect x="4" y="3" width="16" height="18" rx="1.5" /><path d="M4 9h16M4 15h16M10.5 6h3M10.5 12h3M10.5 18h3" /></>,
    shelf: <><path d="M4 7h16M4 13h16M4 19h16M6 7v12M18 7v12" /></>,
    desiccator: <><path d="M6 20h12M7 20l1-8h8l1 8M8 12a4 4 0 0 1 8 0" /><circle cx="12" cy="6.5" r="1.3" /></>,
    glovebox: <><rect x="3" y="5" width="18" height="13" rx="1.5" /><circle cx="9" cy="13" r="2.3" /><circle cx="15" cy="13" r="2.3" /><path d="M3 9h18" /></>,
    fridge: <><rect x="6" y="2.5" width="12" height="19" rx="1.5" /><path d="M6 9h12M9 5.5v1.5M9 12v3" /></>,
    freezer: <><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5 12 6l2.5-1.5M9.5 19.5 12 18l2.5 1.5" /></>,
    flame: <><path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.4 1.2-3.8 2.2-5 .3 1.6 1 2.6 2 3 0-3 .3-5.6.8-8z" /></>,
    flask: <><path d="M9.5 3h5M10.5 3v6L5 19a1.5 1.5 0 0 0 1.3 2h11.4a1.5 1.5 0 0 0 1.3-2L13.5 9V3M7.5 15h9" /></>,
    box: <><path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5zM3.5 7.5 12 12l8.5-4.5M12 12v9" /></>,
  };
  return <svg className="store-icon" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{p[k] ?? p.box}</svg>;
}

const amountText = (b: Box) => b.amount === null ? (b.size !== null ? `— of ${b.size} ${b.unit}` : '—') : `${+b.amount.toPrecision(4)}${b.size ? ` of ${b.size}` : ''} ${b.unit}`;
const fill = (b: Box) => (b.amount !== null && b.size ? Math.max(0, Math.min(1, b.amount / b.size)) : null);
const Fill = ({ b }: { b: Box }) => { const f = fill(b); return f === null ? null : <span className={'fill' + (f < 0.15 ? ' low' : '')} title={`${Math.round(f * 100)} % left`}><i style={{ width: `${f * 100}%` }} /></span>; };

/** A small dialog over the page; closes on Escape or a click outside. */
function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'dialog' + (wide ? ' wide' : '')} role="dialog" aria-label={title}>
        <div className="dialog-head"><h2>{title}</h2><button className="iconbtn" aria-label="Close" onClick={onClose}>×</button></div>
        {children}
      </div>
    </div>
  );
}

/** Inventory: storage places with divisions, containers, consumption from batches, the chemical list and the storage types. */
export default function Inventory({ canEdit }: { canEdit: boolean }) {
  type Tab = 'storage' | 'containers' | 'use' | 'chems' | 'types';
  const [tab, setTab] = useState<Tab>(() => { try { return (localStorage.getItem('psc-inv-tab') as Tab) || 'storage'; } catch { return 'storage'; } });
  const [inv, setInv] = useState<Inv | null>(null), [chems, setChems] = useState<Chemical[]>([]), [err, setErr] = useState(''), [edit, setEdit] = useState<Partial<Box> | null>(null), [area, setArea] = useState<number | null>(null);
  const load = () => { api<Inv>('/inventory').then(setInv).catch((e) => setErr(e.message)); api<Chemical[]>('/chemicals').then(setChems).catch(() => {}); };
  useEffect(() => { load(); }, []);
  const go = (t: Tab) => { setTab(t); setArea(null); try { localStorage.setItem('psc-inv-tab', t); } catch { /* ignore */ } };
  const where = (b: Box) => { const a = inv?.areas.find((x) => x.id === b.area_id), s = a?.shelves.find((x) => x.id === b.shelf_id); return a ? a.name + (s ? ', ' + s.name : '') : '—'; };
  const tabs: [Tab, string][] = [['storage', 'Storage'], ['containers', 'Containers'], ['use', 'Consumption'], ['chems', 'Chemical list'], ...(canEdit ? [['types', 'Storage types'] as [Tab, string]] : [])];
  return (
    <div className="inventory">
      <div className="inline toolbar-row">
        <Seg value={tab} on={go} small opts={tabs} />
        <div className="grow" />
        {!canEdit && tab !== 'use' && <span className="mut small">View only. Editing needs the Inventory tag.</span>}
      </div>
      {err && <p className="err">{err}</p>}
      {tab === 'chems' ? <Chemicals admin={canEdit} />
        : !inv ? <p className="mut">Loading…</p>
        : tab === 'storage' ? (area !== null && inv.areas.some((a) => a.id === area)
          ? <AreaView a={inv.areas.find((a) => a.id === area)!} inv={inv} canEdit={canEdit} onBack={() => setArea(null)} reload={load} onEdit={setEdit} />
          : <Areas inv={inv} canEdit={canEdit} onOpen={setArea} reload={load} />)
        : tab === 'containers' ? <Containers inv={inv} canEdit={canEdit} where={where} onEdit={setEdit} reload={load} />
        : tab === 'types' ? <Types inv={inv} reload={load} />
        : <Consumption inv={inv} chems={chems} />}
      {edit && <ContainerForm init={edit} inv={inv!} chems={chems} canEdit={canEdit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

// ------------------------------------------------------------------ storage
/** The type picker: a segmented row of the storage types, each with its icon. */
function TypePick({ types, value, on }: { types: SType[]; value: number | null; on: (id: number) => void }) {
  return (
    <div className="type-pick" role="radiogroup" aria-label="Type">
      {types.map((t) => <button key={t.id} type="button" role="radio" aria-checked={value === t.id} className={value === t.id ? 'on' : ''} onClick={() => on(t.id)}><StoreIcon k={t.icon} size={18} />{t.name}</button>)}
    </div>
  );
}

/** Front view of a storage place: one rule per division, with a bar for how many containers sit there. */
function Front({ a, inv }: { a: Area; inv: Inv }) {
  const here = inv.containers.filter((c) => c.area_id === a.id && c.status !== 'empty');
  const rows = a.shelves.length ? a.shelves.map((s) => ({ name: s.name, n: here.filter((c) => c.shelf_id === s.id).length })) : [{ name: '', n: here.length }];
  const max = Math.max(4, ...rows.map((r) => r.n));
  return (
    <div className="front" aria-hidden>
      {rows.slice(0, 6).map((r, i) => <div key={i} className="front-row"><span className="front-name">{r.name}</span><span className="front-n">{r.n || ''}</span><span className="front-bar" style={{ width: `${(r.n / max) * 100}%` }} /></div>)}
      {rows.length > 6 && <div className="front-more">+{rows.length - 6} more</div>}
    </div>
  );
}

function NewStorage({ types, onClose, onMade }: { types: SType[]; onClose: () => void; onMade: (id: number) => void }) {
  const [name, setName] = useState(''), [type, setType] = useState<number | null>(types[0]?.id ?? null), [err, setErr] = useState('');
  const make = (e: React.FormEvent) => { e.preventDefault(); api<{ id: number }>('/inventory/areas', 'POST', { name: name.trim(), type_id: type }).then((r) => onMade(r.id)).catch((x) => setErr(x.message)); };
  return (
    <Dialog title="New storage" onClose={onClose}>
      <form className="stack-form-sm" onSubmit={make}>
        <label className="fld"><span>Name</span><input autoFocus value={name} placeholder="Flammables cabinet" onChange={(e) => setName(e.target.value)} /></label>
        <div className="fld"><span>Type</span><TypePick types={types} value={type} on={setType} /></div>
        <p className="mut small">Add its shelves, trays or drawers after creating it.</p>
        {err && <p className="err small">{err}</p>}
        <div className="dialog-actions"><button type="button" className="link" onClick={onClose}>Cancel</button><button className="btn" disabled={!name.trim()}>Create storage</button></div>
      </form>
    </Dialog>
  );
}

function Areas({ inv, canEdit, onOpen, reload }: { inv: Inv; canEdit: boolean; onOpen: (id: number) => void; reload: () => void }) {
  const [making, setMaking] = useState(false);
  const loose = inv.containers.filter((c) => !c.area_id && c.status !== 'empty').length;
  return (
    <>
      <div className="inline inv-bar">
        <span className="mut">{inv.areas.length ? `${inv.areas.length} storage place${inv.areas.length === 1 ? '' : 's'}` : ''}</span>
        <div className="grow" />
        {canEdit && <button className="btn" onClick={() => setMaking(true)}>New storage</button>}
      </div>
      {!inv.areas.length && <div className="inv-empty"><p>{canEdit ? 'Add the cabinets, desiccators and gloveboxes of the lab, then their shelves and the containers on them.' : 'No storage yet. Someone with the Inventory tag can add the lab’s cabinets and gloveboxes.'}</p></div>}
      <div className="inv-areas">
        {inv.areas.map((a) => {
          const t = typeOf(inv, a), here = inv.containers.filter((c) => c.area_id === a.id && c.status !== 'empty');
          const expired = here.filter((c) => c.expires && daysTo(c.expires) < 0).length, low = here.filter((c) => (fill(c) ?? 1) < 0.15).length;
          return (
            <button key={a.id} className="area-card" onClick={() => onOpen(a.id)}>
              <div className="area-top"><span className="icon-tile"><StoreIcon k={t?.icon ?? 'box'} /></span><div className="area-id"><b>{a.name}</b><span className="mut small">{t?.name ?? 'No type'}{a.place ? `, ${a.place}` : ''}</span></div></div>
              <Front a={a} inv={inv} />
              <div className="area-foot small"><span>{here.length} container{here.length === 1 ? '' : 's'}</span>{expired > 0 && <span className="alert">{expired} expired</span>}{low > 0 && <span className="alert soft">{low} running low</span>}</div>
            </button>
          );
        })}
      </div>
      {loose > 0 && <p className="mut small">{loose} container{loose === 1 ? ' has' : 's have'} no place yet. Find {loose === 1 ? 'it' : 'them'} under Containers.</p>}
      {making && <NewStorage types={inv.types} onClose={() => setMaking(false)} onMade={(id) => { setMaking(false); reload(); onOpen(id); }} />}
    </>
  );
}

function EditStorage({ a, types, onClose, onSaved }: { a: Area; types: SType[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(a.name), [type, setType] = useState(a.type_id), [place, setPlace] = useState(a.place), [err, setErr] = useState('');
  const save = (e: React.FormEvent) => { e.preventDefault(); api('/inventory/areas/' + a.id, 'PATCH', { name: name.trim(), type_id: type, place }).then(onSaved).catch((x) => setErr(x.message)); };
  return (
    <Dialog title="Edit storage" onClose={onClose}>
      <form className="stack-form-sm" onSubmit={save}>
        <label className="fld"><span>Name</span><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></label>
        <div className="fld"><span>Type</span><TypePick types={types} value={type} on={setType} /></div>
        <label className="fld"><span>Where in the lab</span><input value={place} placeholder="Room 12, by the fume hood" onChange={(e) => setPlace(e.target.value)} /></label>
        {err && <p className="err small">{err}</p>}
        <div className="dialog-actions"><button type="button" className="link" onClick={onClose}>Cancel</button><button className="btn" disabled={!name.trim()}>Save changes</button></div>
      </form>
    </Dialog>
  );
}

function AreaView({ a, inv, canEdit, onBack, reload, onEdit }: { a: Area; inv: Inv; canEdit: boolean; onBack: () => void; reload: () => void; onEdit: (b: Partial<Box>) => void }) {
  const [err, setErr] = useState(''), [showEmpty, setShowEmpty] = useState(false), [editing, setEditing] = useState(false), [adding, setAdding] = useState(false), [newName, setNewName] = useState(''), [renaming, setRenaming] = useState<number | null>(null);
  const key = 'psc-inv-closed-' + a.id;
  const [closed, setClosed] = useState<number[]>(() => { try { return JSON.parse(localStorage.getItem(key) ?? '[]'); } catch { return []; } });
  const toggle = (id: number) => { const n = closed.includes(id) ? closed.filter((x) => x !== id) : [...closed, id]; setClosed(n); try { localStorage.setItem(key, JSON.stringify(n)); } catch { /* ignore */ } };
  const run = (p: Promise<unknown>) => p.then(() => { setErr(''); reload(); }).catch((e) => setErr(e.message));
  const t = typeOf(inv, a), here = inv.containers.filter((c) => c.area_id === a.id && (showEmpty || c.status !== 'empty'));
  const groups: { s: Shelf | null; list: Box[] }[] = [...a.shelves.map((s) => ({ s, list: here.filter((c) => c.shelf_id === s.id) })), { s: null, list: here.filter((c) => !c.shelf_id || !a.shelves.some((s) => s.id === c.shelf_id)) }];
  const addDivision = (e: React.FormEvent) => { e.preventDefault(); if (!newName.trim()) return; run(api(`/inventory/areas/${a.id}/shelves`, 'POST', { name: newName.trim() })).then(() => { setNewName(''); setAdding(false); }); };
  return (
    <div className="area-page">
      <button className="link back" onClick={onBack}>‹ All storage</button>
      <header className="area-head">
        <span className="icon-tile big"><StoreIcon k={t?.icon ?? 'box'} size={28} /></span>
        <div className="area-id"><h2>{a.name}</h2><span className="mut">{t?.name ?? 'No type'}{a.place ? `, ${a.place}` : ''}</span></div>
        <div className="grow" />
        {canEdit && <button className="btn secondary" onClick={() => setEditing(true)}>Edit</button>}
        {canEdit && <button className="btn" onClick={() => onEdit({ area_id: a.id, shelf_id: null, unit: 'g', status: 'unopened' })}>Add container</button>}
      </header>
      {err && <p className="err small">{err}</p>}
      <div className="divisions">
        {groups.filter((g) => g.s || g.list.length).map((g) => {
          const id = g.s?.id ?? 0, open = !closed.includes(id);
          return (
            <section key={id} className={'division' + (open ? ' open' : '')}>
              <div className="div-head">
                {renaming === id && g.s
                  ? <form className="div-rename" onSubmit={(e) => { e.preventDefault(); const v = (e.currentTarget.elements.namedItem('n') as HTMLInputElement).value.trim(); if (v) run(api('/inventory/shelves/' + id, 'PATCH', { name: v })).then(() => setRenaming(null)); }}>
                      <input name="n" autoFocus defaultValue={g.s.name} onBlur={() => setRenaming(null)} onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)} /></form>
                  : <button className="div-toggle" aria-expanded={open} onClick={() => toggle(id)}><svg className="chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M4 2.5 7.5 6 4 9.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      <span className="div-name">{g.s ? g.s.name : 'Not in a division'}</span><span className="div-n">{g.list.length}</span></button>}
                <div className="grow" />
                {canEdit && <span className="div-actions">
                  <button className="link small" onClick={() => onEdit({ area_id: a.id, shelf_id: g.s?.id ?? null, unit: 'g', status: 'unopened' })}>Add here</button>
                  {g.s && <button className="link small" onClick={() => setRenaming(id)}>Rename</button>}
                  {g.s && <button className="link small danger-link" onClick={() => window.confirm(`Remove the division “${g.s!.name}”? Its containers stay in ${a.name}.`) && run(api('/inventory/shelves/' + id, 'DELETE'))}>Remove</button>}
                </span>}
              </div>
              {open && <div className="div-body">
                {g.list.length ? g.list.map((b) => (
                  <button key={b.id} className={'box-row' + (b.status === 'empty' ? ' empty' : '')} onClick={() => onEdit(b)}>
                    <span className="box-name"><b>{b.name}</b><span className="mut small">{[b.supplier, b.lot && `lot ${b.lot}`].filter(Boolean).join(', ')}</span></span>
                    {b.expires && daysTo(b.expires) < 30 && <Badge tone={daysTo(b.expires) < 0 ? 'err' : 'warn'}>{daysTo(b.expires) < 0 ? 'Expired' : 'Expires soon'}</Badge>}
                    {b.status !== 'in use' && <Badge>{b.status === 'unopened' ? 'Unopened' : 'Empty'}</Badge>}
                    <Fill b={b} /><span className="amt">{amountText(b)}</span>
                  </button>
                )) : <p className="mut small div-empty">Nothing here yet.</p>}
              </div>}
            </section>
          );
        })}
        {!a.shelves.length && !here.length && <p className="mut">Divide this storage into shelves, trays or drawers, then add containers to them.</p>}
      </div>
      <div className="inline area-tail">
        {canEdit && (adding
          ? <form className="inline add-div" onSubmit={addDivision}><input autoFocus value={newName} placeholder="Top shelf, tray 2, left drawer…" onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setAdding(false)} />
              <button className="btn" disabled={!newName.trim()}>Add division</button><button type="button" className="link" onClick={() => setAdding(false)}>Cancel</button></form>
          : <button className="btn secondary" onClick={() => setAdding(true)}>Add division</button>)}
        <div className="grow" />
        <label className="inline small"><input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} /> Show empty containers</label>
        {canEdit && <button className="link danger-link small" onClick={() => window.confirm(`Delete “${a.name}” and its divisions? Its containers stay in the inventory, without a place.`) && run(api('/inventory/areas/' + a.id, 'DELETE')).then(onBack)}>Delete storage</button>}
      </div>
      {editing && <EditStorage a={a} types={inv.types} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
    </div>
  );
}

/** The icon of a storage type: the tile opens a small grid of icons to choose from (Escape or a click outside closes it). */
function IconMenu({ v, on }: { v: Icon; on: (i: Icon) => void }) {
  const [open, setOpen] = useState(false), ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }, esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <span className="icon-menu" ref={ref}>
      <button type="button" className={'icon-tile btn-tile' + (open ? ' on' : '')} aria-label={`Icon: ${ICON_NAME[v]}. Change`} aria-expanded={open} onClick={() => setOpen(!open)}><StoreIcon k={v} /></button>
      {open && <div className="icon-pop" role="listbox" aria-label="Choose an icon">
        {ICONS.map((i) => <button key={i} type="button" role="option" aria-selected={v === i} className={v === i ? 'on' : ''} onClick={() => { on(i); setOpen(false); }}><StoreIcon k={i} size={22} /><span>{ICON_NAME[i]}</span></button>)}
      </div>}
    </span>
  );
}

/** Storage types: the options in the type picker. Inventory people add, rename, change the icon or remove unused ones. */
function Types({ inv, reload }: { inv: Inv; reload: () => void }) {
  const [name, setName] = useState(''), [icon, setIcon] = useState<Icon>('cabinet'), [err, setErr] = useState('');
  const run = (p: Promise<unknown>) => p.then(() => { setErr(''); reload(); }).catch((e) => setErr(e.message));
  return (
    <div className="types">
      <p className="mut">The options offered when someone creates or edits a storage place.</p>
      <section className="group">
        {inv.types.map((t) => (
          <div key={t.id} className="type-row">
            <IconMenu v={t.icon} on={(i) => run(api('/inventory/types/' + t.id, 'PATCH', { icon: i }))} />
            <input aria-label="Type name" defaultValue={t.name} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== t.name && run(api('/inventory/types/' + t.id, 'PATCH', { name: e.target.value.trim() }))} />
            <span className="mut small type-n">{t.n ? `${t.n} in use` : 'Unused'}</span>
            <button className="link small danger-link" disabled={t.n > 0} title={t.n ? 'Change the storage places of this type first' : undefined} onClick={() => run(api('/inventory/types/' + t.id, 'DELETE'))}>Remove</button>
          </div>
        ))}
        <form className="type-row new" onSubmit={(e) => { e.preventDefault(); run(api('/inventory/types', 'POST', { name: name.trim(), icon }).then(() => setName(''))); }}>
          <IconMenu v={icon} on={setIcon} />
          <input value={name} placeholder="New type, e.g. Flammables cabinet" onChange={(e) => setName(e.target.value)} />
          <button className="btn" disabled={!name.trim()}>Add type</button>
        </form>
      </section>
      {err && <p className="err small">{err}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ containers
function Containers({ inv, canEdit, where, onEdit, reload }: { inv: Inv; canEdit: boolean; where: (b: Box) => string; onEdit: (b: Partial<Box>) => void; reload: () => void }) {
  const [q, setQ] = useState(''), [st, setSt] = useState<'' | Box['status']>(''), [imp, setImp] = useState(false);
  const ql = q.toLowerCase();
  const list = inv.containers.filter((b) => (!st ? b.status !== 'empty' : b.status === st) && (!ql || [b.name, b.cas, b.supplier, b.lot, where(b)].some((x) => x?.toLowerCase().includes(ql))));
  return (
    <>
      <div className="inline" style={{ marginBottom: 12 }}>
        <input type="search" placeholder="Search name, CAS, supplier, lot, place" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={st} onChange={(e) => setSt(e.target.value as any)}><option value="">Not empty</option>{STATUS.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</select>
        <div className="grow" />
        {canEdit && <button className="btn secondary" onClick={() => setImp(true)}>Import CSV</button>}
        {canEdit && <button className="btn" onClick={() => onEdit({ unit: 'g', status: 'unopened' })}>Add container</button>}
      </div>
      {imp && <Import onClose={() => setImp(false)} onDone={() => { setImp(false); reload(); }} />}
      <section className="group scroll">
        <table className="list inv-table">
          <thead><tr><th>Name</th><th>Left</th><th>Where</th><th>Supplier</th><th>Lot</th><th>Expires</th><th>Added</th><th>Last change</th></tr></thead>
          <tbody>{list.map((b) => (
            <tr key={b.id} className={'clickable' + (b.status === 'empty' ? ' mut' : '')} onClick={() => onEdit(b)}>
              <td><b>{b.name}</b>{b.cas && <div className="mut small">CAS {b.cas}</div>}</td>
              <td className="nowrap"><Fill b={b} /> {amountText(b)}{b.status !== 'in use' && <div className="mut small">{b.status}</div>}</td>
              <td>{where(b)}</td>
              <td>{b.supplier}</td><td>{b.lot}</td>
              <td className={b.expires && daysTo(b.expires) < 0 ? 'err' : ''}>{b.expires ? fmtDate(b.expires) : '—'}</td>
              <td className="small">{b.added_by_name ?? '—'}<div className="mut">{fmtDate(b.added_at)}</div></td>
              <td className="small">{b.updated_at ? <>{b.updated_by_name}<div className="mut">{fmtDate(b.updated_at)}</div></> : <span className="mut">—</span>}</td>
            </tr>
          ))}</tbody>
        </table>
        {!list.length && <p className="mut">{inv.containers.length ? 'Nothing matches.' : 'No containers yet.'}</p>}
      </section>
    </>
  );
}

function ContainerForm({ init, inv, chems, canEdit, onClose, onSaved }: { init: Partial<Box>; inv: Inv; chems: Chemical[]; canEdit: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Partial<Box>>({ name: '', cas: '', supplier: '', lot: '', notes: '', amount: null, size: null, purity: null, expires: null, opened: null, ...init }), [err, setErr] = useState('');
  const set = (p: Partial<Box>) => setF((x) => ({ ...x, ...p }));
  const area = inv.areas.find((a) => a.id === f.area_id);
  const num = (v: string) => (v === '' ? null : +v);
  const save = (over: Partial<Box> = {}) => {
    const g = { ...f, ...over };
    const body = { name: g.name, chem_id: chems.find((c) => c.name.toLowerCase() === (g.name ?? '').toLowerCase())?.id ?? null, cas: g.cas, amount: g.amount, size: g.size, unit: g.unit, status: g.status,
      area_id: g.area_id ?? null, shelf_id: g.shelf_id ?? null, supplier: g.supplier, lot: g.lot, purity: g.purity, expires: g.expires || null, opened: g.opened || null, notes: g.notes };
    (g.id ? api('/inventory/containers/' + g.id, 'PUT', body) : api('/inventory/containers', 'POST', body)).then(onSaved).catch((e) => setErr(e.message));
  };
  return (
    <Dialog title={f.id ? f.name ?? 'Container' : 'Add container'} onClose={onClose} wide>
      <form className="box-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <fieldset disabled={!canEdit}>
          <div className="grid2">
            <label className="fld span2"><span>Chemical</span><input list="inv-chems" value={f.name ?? ''} autoFocus={!f.id} placeholder="PbI2" onChange={(e) => set({ name: e.target.value })} /></label>
            <datalist id="inv-chems">{chems.map((c) => <option key={c.id} value={c.name} />)}</datalist>
            <label className="fld"><span>Supplier</span><input value={f.supplier ?? ''} onChange={(e) => set({ supplier: e.target.value })} /></label>
            <label className="fld"><span>Lot</span><input value={f.lot ?? ''} onChange={(e) => set({ lot: e.target.value })} /></label>
            <label className="fld"><span>CAS number</span><input value={f.cas ?? ''} onChange={(e) => set({ cas: e.target.value })} /></label>
            <label className="fld"><span>Purity</span><span className="with-unit"><input type="number" min={0} max={100} step="any" value={f.purity ?? ''} onChange={(e) => set({ purity: num(e.target.value) })} /><i>%</i></span></label>
          </div>
          <h3 className="form-h">Amount</h3>
          <div className="grid3">
            <label className="fld"><span>Left</span><input type="number" min={0} step="any" value={f.amount ?? ''} onChange={(e) => set({ amount: num(e.target.value) })} /></label>
            <label className="fld"><span>Of a container of</span><input type="number" min={0} step="any" value={f.size ?? ''} onChange={(e) => set({ size: num(e.target.value) })} /></label>
            <label className="fld"><span>Unit</span><select value={f.unit} onChange={(e) => set({ unit: e.target.value })}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select></label>
          </div>
          <div className="fld"><span>Status</span><Seg value={f.status ?? 'unopened'} small on={(v) => set({ status: v, opened: v === 'in use' && !f.opened ? today() : f.opened })} opts={[['unopened', 'Unopened'], ['in use', 'In use'], ['empty', 'Empty']]} /></div>
          <h3 className="form-h">Place and dates</h3>
          <div className="grid2">
            <label className="fld"><span>Storage</span><select value={f.area_id ?? ''} onChange={(e) => set({ area_id: e.target.value ? +e.target.value : null, shelf_id: null })}><option value="">None</option>{inv.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
            <label className="fld"><span>Division</span><select value={f.shelf_id ?? ''} disabled={!area?.shelves.length} onChange={(e) => set({ shelf_id: e.target.value ? +e.target.value : null })}><option value="">{area?.shelves.length ? 'None' : 'No divisions'}</option>{area?.shelves.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <label className="fld"><span>Opened</span><input type="date" value={f.opened ?? ''} onChange={(e) => set({ opened: e.target.value || null })} /></label>
            <label className="fld"><span>Expires</span><input type="date" value={f.expires ?? ''} onChange={(e) => set({ expires: e.target.value || null })} /></label>
            <label className="fld span2"><span>Notes</span><textarea rows={2} value={f.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} /></label>
          </div>
        </fieldset>
        {f.id && <p className="mut small">Added by {f.added_by_name ?? 'someone'} on {fmtDate(f.added_at!)}{f.updated_at ? `. Last changed by ${f.updated_by_name} on ${fmtDate(f.updated_at)}.` : '.'}</p>}
        {err && <p className="err small">{err}</p>}
        {canEdit && <div className="dialog-actions">
          {f.id && <button type="button" className="link danger-link" onClick={() => window.confirm(`Delete this container of ${f.name}? Mark it empty instead to keep its history.`) && api('/inventory/containers/' + f.id, 'DELETE').then(onSaved).catch((e) => setErr(e.message))}>Delete</button>}
          <div className="grow" />
          {f.id && f.status !== 'empty' && <button type="button" className="btn secondary" onClick={() => save({ status: 'empty', amount: 0 })}>Mark empty</button>}
          <button className="btn" disabled={!f.name?.trim()}>{f.id ? 'Save changes' : 'Add container'}</button>
        </div>}
      </form>
    </Dialog>
  );
}

// ------------------------------------------------------------------ import (CSV from OpenEnventory or a spreadsheet)
const FIELDS: [string, string, string[]][] = [
  ['name', 'Name', ['name', 'molecule_name', 'molecule', 'chemical', 'chemical name', 'substance', 'compound', 'nome', 'reagente']],
  ['cas', 'CAS', ['cas', 'cas_nr', 'casnr', 'cas no', 'cas number', 'cas-nr']],
  ['amount', 'Amount left', ['actual_amount', 'amount', 'quantity', 'qty', 'quantidade', 'remaining']],
  ['size', 'Container size', ['package_amount', 'size', 'container size', 'total amount', 'package size', 'tamanho']],
  ['unit', 'Unit', ['amount_unit', 'unit', 'units', 'unidade']],
  ['area', 'Storage', ['storage_name', 'storage', 'location', 'cabinet', 'room', 'local', 'armario']],
  ['shelf', 'Division', ['compartment', 'shelf', 'division', 'tray', 'drawer', 'position', 'prateleira']],
  ['supplier', 'Supplier', ['supplier', 'vendor', 'brand', 'manufacturer', 'fornecedor', 'marca']],
  ['lot', 'Lot', ['lot', 'lot_no', 'batch', 'batch_no', 'lote']],
  ['purity', 'Purity (%)', ['purity', 'pureza']],
  ['expires', 'Expires', ['expiry_date', 'expiry', 'expires', 'expiration', 'validade']],
  ['opened', 'Opened', ['open_date', 'opened', 'opening date', 'aberto']],
  ['notes', 'Notes', ['comment', 'comments', 'notes', 'description', 'observacoes']],
];
/** CSV/TSV with quotes; the delimiter is guessed from the header line. */
function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0], d = [',', ';', '\t'].map((c) => [c, first.split(c).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = []; let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === d) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
const normDate = (v: string) => { const s = v.trim(); let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`; m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null; };
const normUnit = (u: string) => { const s = u.trim().replace('ul', 'µL').replace('uL', 'µL'); const k = UNITS.find((x) => x.toLowerCase() === s.toLowerCase()); return k; };

function Import({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<string[][] | null>(null), [map, setMap] = useState<Record<string, number>>({}), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const read = (f?: File) => f && f.text().then((t) => {
    const r = parseCsv(t.replace(/^﻿/, '')); if (r.length < 2) return setErr('No rows found. Export a CSV with a header line.');
    const h = r[0].map((x) => x.trim().toLowerCase()), m: Record<string, number> = {};
    for (const [k, , syn] of FIELDS) { const i = syn.map((s) => h.indexOf(s)).find((i) => i >= 0); if (i !== undefined) m[k] = i; }
    setErr(''); setRows(r); setMap(m);
  });
  const out = useMemo(() => !rows ? [] : rows.slice(1).map((r) => {
    const g = (k: string) => (map[k] !== undefined ? (r[map[k]] ?? '').trim() : '');
    let amount: number | null = parseFloat(g('amount').replace(',', '.')), unit = normUnit(g('unit')) ?? normUnit(g('amount').replace(/^[\d.,\s]+/, '')) ?? 'g';
    if (!Number.isFinite(amount)) amount = null;
    const size = parseFloat(g('size').replace(',', '.')), purity = parseFloat(g('purity').replace(',', '.').replace('%', ''));
    return { name: g('name'), cas: g('cas'), amount, size: Number.isFinite(size) ? size : null, unit, area: g('area') || undefined, shelf: g('shelf') || undefined,
      supplier: g('supplier'), lot: g('lot'), purity: Number.isFinite(purity) && purity <= 100 ? purity : null, expires: normDate(g('expires')), opened: normDate(g('opened')), notes: g('notes'),
      status: amount === 0 ? 'empty' : 'in use' };
  }).filter((x) => x.name), [rows, map]);
  const go = () => { setBusy(true); api<{ imported: number }>('/inventory/import', 'POST', { rows: out }).then(onDone).catch((e) => setErr(e.message)).finally(() => setBusy(false)); };
  return (
    <section className="group import">
      <div className="inline"><h3 className="sub">Import containers</h3><div className="grow" /><button className="link" onClick={onClose}>Cancel</button></div>
      <p className="mut small">A CSV export from OpenEnventory or any spreadsheet (save as CSV). Columns are matched by their header; check them below. Storage places and divisions are created by name.</p>
      <input type="file" accept=".csv,.tsv,.txt,text/csv" onChange={(e) => read(e.target.files?.[0])} />
      {rows && <>
        <div className="map-grid">{FIELDS.map(([k, label]) => (
          <label key={k}>{label}<select value={map[k] ?? ''} onChange={(e) => setMap({ ...map, [k]: e.target.value === '' ? (undefined as any) : +e.target.value })}>
            <option value="">—</option>{rows[0].map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}</select></label>))}</div>
        <div className="scroll"><table className="list small"><thead><tr><th>Name</th><th>Left</th><th>Storage, division</th><th>Supplier</th><th>Lot</th><th>Expires</th></tr></thead>
          <tbody>{out.slice(0, 6).map((r, i) => <tr key={i}><td>{r.name}</td><td>{r.amount ?? '—'}{r.size ? ` / ${r.size}` : ''} {r.unit}</td><td>{[r.area, r.shelf].filter(Boolean).join(', ') || '—'}</td><td>{r.supplier}</td><td>{r.lot}</td><td>{r.expires ?? ''}</td></tr>)}</tbody></table></div>
        <div className="inline"><button className="btn" disabled={busy || !out.length || map.name === undefined} onClick={go}>Import {out.length} container{out.length === 1 ? '' : 's'}</button>{map.name === undefined && <span className="err small">Choose the Name column</span>}</div>
      </>}
      {err && <p className="err small">{err}</p>}
    </section>
  );
}

// ------------------------------------------------------------------ consumption
type Row = { name: string; base: 'mg' | 'µL'; s: { start: string; v: number }[]; stock: number | null; f: ReturnType<typeof forecast>; batches: { code: string; date: string; v: number }[] };

function Consumption({ inv, chems }: { inv: Inv; chems: Chemical[] }) {
  const [uses, setUses] = useState<BatchUse[] | null>(null), [p, setP] = useState<Period>('week'), [open, setOpen] = useState<string | null>(null), [err, setErr] = useState('');
  useEffect(() => { api<any[]>('/inventory/batches').then((l) => setUses(l.map(batchUses))).catch((e) => setErr(e.message)); }, []);
  const rows = useMemo<Row[]>(() => {
    if (!uses) return [];
    const by = new Map<string, { date: string; code: string; u: { mg?: number; ul?: number } }[]>();
    for (const b of uses) for (const u of b.uses) { const k = u.name.trim(); if (!by.has(k)) by.set(k, []); by.get(k)!.push({ date: b.date, code: b.code, u }); }
    const n = p === 'week' ? 26 : 12, start = (() => { let s = periodStart(today(), p); for (let i = 1; i < n; i++) { const d = new Date(s + 'T00:00:00Z'); if (p === 'week') d.setUTCDate(d.getUTCDate() - 7); else d.setUTCMonth(d.getUTCMonth() - 1); s = d.toISOString().slice(0, 10); } return s; })();
    return [...by.entries()].map(([name, ev]) => {
      const c = chems.find((x) => x.name.toLowerCase() === name.toLowerCase()), dens = c?.d ?? null;
      const liquid = c?.role === 'solvent' || ev.every((e) => !e.u.mg);
      const base: 'mg' | 'µL' = liquid ? 'µL' : 'mg';
      const s = series(ev.map((e) => ({ date: e.date, v: useIn(e.u, base, dens) })), p, start, today()).filter((x) => x.start >= start);
      const boxes = inv.containers.filter((b) => b.status !== 'empty' && b.amount !== null && (b.chem_id === c?.id || b.name.toLowerCase() === name.toLowerCase()));
      const parts = boxes.map((b) => toBase(b.amount!, b.unit, base, dens)), stock = boxes.length ? parts.reduce<number>((a, v) => a + (v ?? 0), 0) : null;
      return { name, base, s, stock, f: forecast(s, stock ?? 0, p), batches: ev.map((e) => ({ code: e.code, date: e.date, v: useIn(e.u, base, dens) })) };
    }).filter((r) => r.s.some((x) => x.v > 0)).sort((a, b) => (a.stock === null ? 1 : 0) - (b.stock === null ? 1 : 0) || a.f.days - b.f.days || a.name.localeCompare(b.name));
  }, [uses, p, inv, chems]);
  if (err) return <p className="err">{err}</p>;
  if (!uses) return <p className="mut">Reading batches…</p>;
  const label = p === 'week' ? 'week' : 'month', sel = rows.find((r) => r.name === open);
  return (
    <>
      <div className="inline" style={{ marginBottom: 10 }}>
        <Seg value={p} on={setP} small opts={[['week', 'By week'], ['month', 'By month']]} />
        <span className="mut small">From the recipes of {uses.length} running and done batch{uses.length === 1 ? '' : 'es'} (planned amounts: solutions as prepared, solvents dispensed in spin programs). Stock from the containers not marked empty.</span>
      </div>
      {!rows.length ? <p className="mut">No reagent use in the last {p === 'week' ? '26 weeks' : '12 months'}.</p> : (
        <section className="group scroll">
          <table className="list use-table">
            <thead><tr><th>Chemical</th><th>Use per {label}</th><th>This {label}</th><th>Average</th><th>In stock</th><th>Lasts until</th></tr></thead>
            <tbody>{rows.map((r) => {
              const cur = r.s[r.s.length - 1]?.v ?? 0, out = r.stock !== null && Number.isFinite(r.f.days) ? new Date(Date.now() + r.f.days * 864e5) : null, warn = out && r.f.days < 30, flag = r.f.unusual.some(Boolean);
              return (
                <tr key={r.name} className={'clickable' + (open === r.name ? ' on' : '')} onClick={() => setOpen(open === r.name ? null : r.name)}>
                  <td><b>{r.name}</b>{flag && <> <Badge tone="warn">unusual use</Badge></>}</td>
                  <td><Spark s={r.s} unusual={r.f.unusual} /></td>
                  <td>{cur ? fmtAmount(cur, r.base) : '—'}</td>
                  <td>{r.f.rate ? fmtAmount(r.f.rate, r.base) : '—'}</td>
                  <td>{r.stock === null ? <span className="mut">no container</span> : fmtAmount(r.stock, r.base)}</td>
                  <td className={warn ? 'err' : ''}>{r.stock === null ? '—' : out ? `${fmtDate(out.toISOString())} (${Math.round(r.f.days)} d)` : r.stock <= 0 ? 'out of stock' : 'no recent use'}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </section>
      )}
      {sel && <UseDetail r={sel} p={p} />}
    </>
  );
}

const Spark = ({ s, unusual }: { s: { v: number }[]; unusual: boolean[] }) => {
  const m = Math.max(...s.map((x) => x.v), 1e-9), w = 4, g = 1.5;
  return <svg className="spark" width={s.length * (w + g)} height={22} aria-hidden>{s.map((x, i) => <rect key={i} x={i * (w + g)} y={22 - (x.v / m) * 20} width={w} height={Math.max(x.v > 0 ? 1.5 : 0.6, (x.v / m) * 20)} className={unusual[i] ? 'u' : x.v > 0 ? '' : 'z'} />)}</svg>;
};

/** One chemical: use per period as bars (unusual ones marked), the average line, and the batches behind it. */
function UseDetail({ r, p }: { r: Row; p: Period }) {
  const W = 760, H = 220, L = 58, B = 28, T = 12, n = r.s.length, bw = (W - L - 10) / n, max = Math.max(...r.s.map((x) => x.v), r.f.rate, 1e-9) * 1.1;
  const Y = (v: number) => T + (H - T - B) * (1 - v / max);
  const ticks = [0, 0.5, 1].map((k) => k * max);
  const lab = (s: string) => (p === 'month' ? new Date(s + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' }) : new Date(s + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }));
  const step = Math.ceil(n / 9);
  return (
    <section className="group use-detail">
      <div className="inline"><b className="use-title">{r.name}</b><span className="mut small">Average {fmtAmount(r.f.rate, r.base)} per {p} over the last {p === 'week' ? 8 : 6} complete {p}s{r.stock !== null ? `, ${fmtAmount(r.stock, r.base)} in stock` : ''}</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="use-chart" role="img" aria-label={`Use of ${r.name} per ${p}`}>
        {ticks.map((t, i) => <g key={i}><line x1={L} x2={W - 10} y1={Y(t)} y2={Y(t)} className="grid" /><text x={L - 6} y={Y(t)} textAnchor="end" dominantBaseline="central">{fmtAmount(t, r.base)}</text></g>)}
        {r.s.map((x, i) => <g key={x.start}>
          <rect x={L + i * bw + 1.5} y={Y(x.v)} width={Math.max(1, bw - 3)} height={Y(0) - Y(x.v)} className={r.f.unusual[i] ? 'u' : i === n - 1 ? 'cur' : ''}><title>{`${lab(x.start)}: ${fmtAmount(x.v, r.base)}${r.f.unusual[i] ? ' (unusual)' : ''}${i === n - 1 ? ` (this ${p}, so far)` : ''}`}</title></rect>
          {i % step === 0 && <text x={L + i * bw + bw / 2} y={H - 10} textAnchor="middle">{lab(x.start)}</text>}
        </g>)}
        {r.f.rate > 0 && <><line x1={L} x2={W - 10} y1={Y(r.f.rate)} y2={Y(r.f.rate)} className="avg" /><text x={W - 12} y={Y(r.f.rate) - 5} textAnchor="end" className="avg-t">average</text></>}
      </svg>
      <p className="mut small">Batches: {r.batches.slice(-12).reverse().map((b) => `${b.code} (${fmtDate(b.date)}) ${fmtAmount(b.v, r.base)}`).join(', ')}{r.batches.length > 12 ? ', …' : ''}</p>
    </section>
  );
}

