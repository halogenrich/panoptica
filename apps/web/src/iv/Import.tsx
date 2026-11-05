import { useEffect, useMemo, useRef, useState } from 'react';
import { unzipSync } from 'fflate';
import { DeviceTable, type DeviceMap } from './Devices';
import { ivMetrics, parseIvFiles, type IvCurve, type IvFile } from '@psc/core';
import { api } from '../api';
import { Modal } from '../lib/ui';
import { SYSTEM, type Link } from './model';

const dec = new TextDecoder('windows-1252'); // instrument files are plain ASCII / Latin-1 (e.g. "mA/cm²")
const fdate = (d: string) => (d ? new Date(d + 'T12:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'no date');

/** Every file inside dropped files, folders and .zip archives. */
async function collect(items: { name: string; file: File }[]): Promise<IvFile[]> {
  const out: IvFile[] = [];
  for (const { name, file } of items) {
    const buf = new Uint8Array(await file.arrayBuffer());
    if (/\.zip$/i.test(name)) {
      for (const [n, data] of Object.entries(unzipSync(buf))) if (!n.endsWith('/') && /\.(csv|txt)$/i.test(n) && !/(^|\/)(__MACOSX\/|\._)/.test(n)) out.push({ name: n, text: dec.decode(data) }); // skip macOS resource copies
    } else if (/\.(csv|txt)$/i.test(name) && !/(^|\/)(__MACOSX\/|\._)/.test(name)) out.push({ name, text: dec.decode(buf) });
  }
  return out;
}
/** Files from a drag and drop, walking into folders. */
async function fromDrop(dt: DataTransfer) {
  const items: { name: string; file: File }[] = [];
  const walk = async (e: any, path: string): Promise<void> => {
    if (e.isFile) { const f: File = await new Promise((r, j) => e.file(r, j)); items.push({ name: path + f.name, file: f }); }
    else if (e.isDirectory) {
      const reader = e.createReader(); let batch: any[];
      do { batch = await new Promise((r, j) => reader.readEntries(r, j)); for (const c of batch) await walk(c, path + e.name + '/'); } while (batch.length);
    }
  };
  const entries = [...dt.items].map((i) => (i as any).webkitGetAsEntry?.()).filter(Boolean);
  if (entries.length) for (const e of entries) await walk(e, ''); else for (const f of [...dt.files]) items.push({ name: f.name, file: f });
  return items;
}

type Draft = { key: string; system: 'padrao' | 'sun'; date: string; name: string; curves: IvCurve[]; links: Record<string, Link>; devices: DeviceMap; follow: number | null; at: string };

/** Import: drop the exported files (or a folder / zip) → check what was read → link each sample to a batch or stack → save. */
export default function ImportIv({ onClose, onDone, presetLink }: { onClose: () => void; onDone: (ids: number[]) => void; presetLink?: Link }) {
  const [drafts, setDrafts] = useState<Draft[] | null>(null), [info, setInfo] = useState(''), [busy, setBusy] = useState(false), [over, setOver] = useState(false), [err, setErr] = useState('');
  const [targets, setTargets] = useState<{ batches: { id: number; code: string; name: string }[]; stacks: { id: number; name: string }[]; sets: { id: number; name: string; stabilityOf: number | null }[] }>({ batches: [], stacks: [], sets: [] });
  const [vis, setVis] = useState<'shared' | 'private'>('shared'), filesIn = useRef<HTMLInputElement>(null), dirIn = useRef<HTMLInputElement>(null);
  useEffect(() => {
    Promise.all([api<any[]>('/batches'), api<any[]>('/presets?segment=stk'), api<any[]>('/iv')]).then(([b, s, v]) => setTargets({ batches: b.map((x) => ({ id: x.id, code: x.code, name: x.name })), stacks: s.map((x) => ({ id: x.id, name: x.name })), sets: v.map((x) => ({ id: x.id, name: x.name, stabilityOf: x.stabilityOf ?? null })) })).catch(() => {});
  }, []);

  const read = async (items: { name: string; file: File }[]) => {
    setBusy(true); setErr('');
    try {
      const files = await collect(items), r = parseIvFiles(files);
      if (!r.curves.length) { setErr(`No J–V curves found in ${files.length} file${files.length === 1 ? '' : 's'}. Supported: the 8-pixel system's "J-V Data.csv" exports and the 1.5 × 2.5 system's "-JV-…-Sun-….txt" files.`); setBusy(false); return; }
      const by = new Map<string, Draft>();
      for (const c of r.curves) {
        const key = `${c.system}|${c.date}`;
        if (!by.has(key)) by.set(key, { key, system: c.system, date: c.date, name: `${fdate(c.date)} · ${c.system === 'padrao' ? 'Padrão' : '1.5 × 2.5'}`, curves: [], links: {}, devices: {}, follow: null, at: c.date ? `${c.date}T12:00` : new Date().toISOString().slice(0, 16) });
        const d = by.get(key)!; d.curves.push(c); if (!(c.sample in d.links)) d.links[c.sample] = presetLink ?? null;
      }
      setDrafts([...by.values()]);
      setInfo(`${r.curves.length} curves from ${files.length} files${r.ignored ? ` (${r.ignored} other files ignored)` : ''}${r.warnings.length ? ` · ${r.warnings.join('; ')}` : ''}`);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const clean = (o?: Record<string, number | undefined>) => o && Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number.isFinite(v as number) ? v : null]));
      const ids: number[] = [];
      for (const d of drafts!) {
        const r = await api<{ id: number }>('/iv', 'POST', { name: d.name, date: d.date, system: d.system, visibility: vis, links: d.links, devices: d.devices,
          stability_of: d.follow, measured_at: d.follow ? new Date(d.at).toISOString() : null,
          curves: d.curves.map(({ settings: _s, system: _y, date: _d, inst, ...c }) => ({ ...c, inst: clean(inst) })) });
        ids.push(r.id);
      }
      onDone(ids);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  const up = (key: string, p: Partial<Draft>) => setDrafts(drafts!.map((d) => (d.key === key ? { ...d, ...p } : d)));

  return (
    <Modal onClose={onClose} wide={!!drafts}>
      <header className="modal-head"><h2>Import J–V measurements</h2><div className="grow" /><button className="iconbtn head-close" aria-label="Close" onClick={onClose}>✕</button></header>
      <div className="modal-body">
        {!drafts ? (
          <div className={'drop' + (over ? ' over' : '')} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={async (e) => { e.preventDefault(); setOver(false); await read(await fromDrop(e.dataTransfer)); }}>
            <b>{busy ? 'Reading…' : 'Drop the measurement folder, files or a .zip here'}</b>
            <span className="mut">or</span>
            <span className="inline" style={{ justifyContent: 'center' }}>
              <button className="btn" type="button" onClick={() => filesIn.current?.click()}>Choose files or .zip</button>
              <button className="btn secondary" type="button" onClick={() => dirIn.current?.click()}>Choose a folder</button>
            </span>
            <input ref={filesIn} type="file" multiple accept=".csv,.txt,.zip" hidden onChange={(e) => read([...(e.target.files ?? [])].map((f) => ({ name: f.name, file: f })))} />
            <input ref={dirIn} type="file" hidden {...({ webkitdirectory: '' } as any)} onChange={(e) => read([...(e.target.files ?? [])].map((f) => ({ name: (f as any).webkitRelativePath || f.name, file: f })))} />
            <span className="mut small">8-pixel system (Padrão): the folder with "… J-V Data.csv", "… Metrics.csv" and the Settings folder. 1.5 × 2.5 system: the day folder with "…-JV-Backward-Sun-A1.txt" and "…-Parameters.txt".</span>
          </div>
        ) : (
          <div className="import">
            <p className="mut small">{info}</p>
            {drafts.map((d) => <DraftCard key={d.key} d={d} targets={targets} up={(p) => up(d.key, p)} />)}
          </div>
        )}
        {err && <p className="err">{err}</p>}
      </div>
      {drafts && (
        <footer className="modal-foot">
          <button className="link" onClick={() => setDrafts(null)}>Choose other files</button>
          <div className="grow" />
          <label className="inline small">Visible to <select value={vis} onChange={(e) => setVis(e.target.value as any)}><option value="shared">everyone</option><option value="private">only me</option></select></label>
          <button className="btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : `Save ${drafts.length > 1 ? drafts.length + ' measurements' : 'measurement'}`}</button>
        </footer>
      )}
    </Modal>
  );
}

function DraftCard({ d, targets, up }: { d: Draft; targets: { batches: { id: number; code: string; name: string }[]; stacks: { id: number; name: string }[]; sets: { id: number; name: string; stabilityOf: number | null }[] }; up: (p: Partial<Draft>) => void }) {
  const samples = useMemo(() => [...new Set(d.curves.map((c) => c.sample))].map((s) => {
    const cs = d.curves.filter((c) => c.sample === s), ms = cs.map((c) => ivMetrics(c.V, c.J, c.pin));
    return { s, subs: new Set(cs.map((c) => c.substrate)).size, px: new Set(cs.map((c) => c.substrate + '|' + c.pixel)).size, ok: ms.filter((m) => m.status === 'ok').length, n: ms.length, best: Math.max(0, ...ms.filter((m) => m.status === 'ok').map((m) => m.pce)) };
  }), [d.curves]);
  const val = (l: Link) => (l ? `${l.kind}:${l.id}` : '');
  const devs = useMemo(() => [...new Set(d.curves.map((c) => c.sample + '|' + c.substrate))].map((k) => {
    const [sample, substrate] = k.split('|'), ms = d.curves.filter((c) => c.sample === sample && c.substrate === substrate).map((c) => ivMetrics(c.V, c.J, c.pin));
    return { sample, substrate, best: Math.max(0, ...ms.filter((m) => m.status === 'ok').map((m) => m.pce)) };
  }), [d.curves]);
  return (
    <section className="group">
      <div className="inline"><input className="title-input" value={d.name} aria-label="Name" onChange={(e) => up({ name: e.target.value })} /><span className="mut small">{SYSTEM[d.system]} · {d.date || 'no date in the file names'}</span></div>
      <div className="scroll"><table>
        <thead><tr><th>Sample (from the file names)</th><th>Substrates</th><th>Curves</th><th>Working</th><th>Best PCE</th><th>Is in the app as</th></tr></thead>
        <tbody>{samples.map((r) => (
          <tr key={r.s}>
            <td><b>{r.s.replace(/_/g, ' ')}</b></td><td>{r.subs}</td><td>{r.n}</td><td>{r.ok}</td><td>{r.best ? r.best.toFixed(2) + ' %' : '—'}</td>
            <td><select aria-label={`Link ${r.s}`} value={val(d.links[r.s] ?? null)} onChange={(e) => { const [k, id] = e.target.value.split(':'); up({ links: { ...d.links, [r.s]: k ? { kind: k as 'batch' | 'stack', id: +id } : null } }); }}>
              <option value="">Not linked</option>
              {targets.batches.length > 0 && <optgroup label="Batches">{targets.batches.map((b) => <option key={'b' + b.id} value={`batch:${b.id}`}>{b.code}{b.name ? ` · ${b.name}` : ''}</option>)}</optgroup>}
              {targets.stacks.length > 0 && <optgroup label="Stacks">{targets.stacks.map((s) => <option key={'s' + s.id} value={`stack:${s.id}`}>{s.name}</option>)}</optgroup>}
            </select></td>
          </tr>
        ))}</tbody>
      </table></div>
      <p className="mut small">Linked samples are grouped by their batch or stack in the statistics, and drawn with the batch's mask.</p>
      <div className="stab-row">
        <label className="inline small"><input type="checkbox" checked={d.follow !== null} disabled={!targets.sets.length} onChange={(e) => up({ follow: e.target.checked ? targets.sets.find((x) => !x.stabilityOf)?.id ?? targets.sets[0]?.id ?? null : null })} /> Stability test: a later reading of devices measured before</label>
        {d.follow !== null && <>
          <select aria-label="First measurement of the series" value={d.follow} onChange={(e) => up({ follow: +e.target.value })}>{targets.sets.filter((x) => !x.stabilityOf).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          <label className="inline small">measured at <input type="datetime-local" value={d.at} onChange={(e) => up({ at: e.target.value })} /></label>
          <span className="mut small">Pixels are matched to the first measurement by sample, substrate and pixel. Follow-ups stay out of the statistics.</span>
        </>}
      </div>
      <details className="devices-box" open>
        <summary>Devices for the plots and device groups</summary>
        <DeviceTable rows={devs} value={d.devices} groups={[]} onChange={(p) => up({ devices: { ...d.devices, ...p } })}
          fallback={(s) => { const l = d.links[s]; return l ? (l.kind === 'batch' ? targets.batches.find((b) => b.id === l.id)?.code : targets.stacks.find((x) => x.id === l.id)?.name) ?? s : s.replace(/_/g, ' '); }} />
      </details>
    </section>
  );
}
