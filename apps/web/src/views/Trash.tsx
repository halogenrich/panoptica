import { useEffect, useState } from 'react';
import { api } from '../api';
import { Badge, Empty, fmtDate } from '../lib/ui';
import { refreshAll, showToast } from '../lib/trash';

type Item = { kind: 'preset' | 'batch' | 'iv'; id: number; name: string; segment: string; deleted_at: string; purge_at: string; owner: string };
const KIND: Record<string, string> = { stk: 'Stack', batches: 'Batch', iv: 'Measurement', sub: 'Substrate', mask: 'Metal mask', s0: 'Substrate prep', s1: 'Solution', s2: 'Spin program', s3: 'Organic evaporation', s4: 'Metal evaporation' };

/** Deleted stacks, recipes, designs, batches and measurements: restore them, or delete them for good. Emptied automatically after 30 days. */
export default function Trash({ admin }: { admin: boolean }) {
  const [d, setD] = useState<{ days: number; items: Item[] } | null>(null), [err, setErr] = useState('');
  const load = () => api<{ days: number; items: Item[] }>('/trash').then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const restore = (i: Item) => api(`/trash/${i.kind}/${i.id}/restore`, 'POST').then(() => { showToast(`Restored “${i.name}”`); refreshAll(); load(); }).catch((e) => setErr(e.message));
  const purge = (i: Item) => window.confirm(`Delete “${i.name}” for good? This cannot be undone (only a database backup would bring it back).`)
    && api(`/trash/${i.kind}/${i.id}`, 'DELETE').then(load).catch((e) => setErr(e.message));
  const left = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 864e5));
  if (!d) return <p className="mut">{err || 'Loading…'}</p>;
  return (
    <>
      <p className="mut">Deleted items stay here for {d.days} days, then they are removed for good. {admin ? 'As an admin you see everyone’s deleted items.' : 'You see the items you deleted or own.'}</p>
      {err && <p className="err">{err}</p>}
      {d.items.length === 0 ? <Empty title="The trash is empty" text="Deleted stacks, recipes, designs, batches and measurements appear here." /> : (
        <section className="group scroll flush">
          <table className="list">
            <thead><tr><th>Name</th><th>Type</th>{admin && <th>Owner</th>}<th>Deleted</th><th /></tr></thead>
            <tbody>{d.items.map((i) => (
              <tr key={i.kind + i.id}>
                <td><b>{i.name}</b></td><td><Badge>{KIND[i.segment] ?? i.segment}</Badge></td>{admin && <td>{i.owner}</td>}
                <td className="mut">{fmtDate(i.deleted_at)} · removed in {left(i.purge_at)} day{left(i.purge_at) === 1 ? '' : 's'}</td>
                <td className="row-actions"><button className="link" onClick={() => restore(i)}>Restore</button> <button className="link danger-link" onClick={() => purge(i)}>Delete for good</button></td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}
    </>
  );
}
