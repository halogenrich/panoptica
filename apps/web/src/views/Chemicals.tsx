import { useEffect, useState } from 'react';
import { api } from '../api';
import { ROLES, type Chemical } from './common';

export default function Chemicals({ admin }: { admin: boolean }) {
  const [list, setList] = useState<Chemical[]>([]), [q, setQ] = useState(''), [role, setRole] = useState(''), [err, setErr] = useState('');
  const load = () => api<Chemical[]>('/chemicals').then(setList);
  useEffect(() => { load(); }, []);
  const set = (id: number, p: Partial<Chemical>) => setList((l) => l.map((c) => (c.id === id ? { ...c, ...p } : c)));
  const save = (c: Chemical) => api('/chemicals/' + c.id, 'PUT', { name: c.name, role: c.role, f: c.f, M: c.M, d: c.d, pur: c.pur, brand: c.brand })
    .then(() => setErr('')).catch((e) => { setErr(e.message); load(); });
  const shown = list.filter((c) => (!role || c.role === role) && c.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
            {err && <p className="err">{err}</p>}
      <div className="inline" style={{ marginBottom: 12 }}>
        <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={role} onChange={(e) => setRole(e.target.value)}><option value="">All roles</option>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
        {admin && <button className="btn" onClick={() => api('/chemicals', 'POST', { name: 'New chemical ' + Date.now() % 1000, role: 'other', f: '', M: 0, d: null, pur: 100, brand: '' }).then(load)}>Add</button>}
      </div>
      <section className="group scroll">
        <table className="edit">
          <thead><tr><th>Name</th><th>Role</th><th>Formula</th><th>M (g/mol)</th><th>ρ (g/mL)</th><th>Purity %</th><th>Brand</th><th /></tr></thead>
          <tbody>{shown.map((c) => admin ? (
            <tr key={c.id}>
              <td><input value={c.name} onChange={(e) => set(c.id, { name: e.target.value })} onBlur={() => save(c)} /></td>
              <td><select value={c.role} onChange={(e) => { const n = { ...c, role: e.target.value }; set(c.id, n); save(n); }}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></td>
              <td><input value={c.f} onChange={(e) => set(c.id, { f: e.target.value })} onBlur={() => save(c)} /></td>
              <td><input type="number" value={c.M} onChange={(e) => set(c.id, { M: +e.target.value || 0 })} onBlur={() => save(c)} /></td>
              <td><input type="number" value={c.d ?? ''} onChange={(e) => set(c.id, { d: e.target.value === '' ? null : +e.target.value })} onBlur={() => save(c)} /></td>
              <td><input type="number" value={c.pur} onChange={(e) => set(c.id, { pur: +e.target.value || 0 })} onBlur={() => save(c)} /></td>
              <td><input value={c.brand} onChange={(e) => set(c.id, { brand: e.target.value })} onBlur={() => save(c)} /></td>
              <td><button className="link" onClick={() => window.confirm('Delete ' + c.name + '?') && api('/chemicals/' + c.id, 'DELETE').then(load)}>×</button></td>
            </tr>
          ) : (
            <tr key={c.id}><td>{c.name}</td><td>{c.role}</td><td>{c.f}</td><td>{c.M}</td><td>{c.d ?? ''}</td><td>{c.pur}</td><td>{c.brand}</td><td /></tr>
          ))}</tbody>
        </table>
      </section>
    </>
  );
}
