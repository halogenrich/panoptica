import { useContext, useEffect, useRef, useState } from 'react';
import { SUBSTRATES, type Rect, type SubKey } from '@psc/core';
import { api } from '../api';
import { trashed } from '../lib/trash';
import { PrefCtx } from '../ctx';

export type Chemical = { id: number; name: string; role: string; f: string; M: number; d: number | null; pur: number; brand: string };
export const ROLES = ['salt', 'solvent', 'etl', 'htl', 'additive', 'organic', 'metal', 'other'];

export function useChems() {
  const [c, setC] = useState<Chemical[]>([]);
  useEffect(() => { api<Chemical[]>('/chemicals').then(setC); }, []);
  return c;
}

type P = { id: number; name: string; visibility: string; owner: string; mine: number; data: any };

/** Save / load / delete presets for one segment (own + shared). */
export function PresetBar({ segment, data, onLoad }: { segment: string; data: unknown; onLoad: (d: any) => void }) {
  const [list, setList] = useState<P[]>([]), [name, setName] = useState(''), [vis, setVis] = useState<string>(useContext(PrefCtx).prefs.vis), [sel, setSel] = useState(''), [msg, setMsg] = useState('');
  const load = () => api<P[]>('/presets?segment=' + segment).then(setList);
  useEffect(() => { load(); }, [segment]);
  const cur = list.find((p) => String(p.id) === sel);
  const save = async () => {
    const n = name.trim(); if (!n) return;
    const ex = list.find((p) => p.mine && p.name === n);
    try { await api(ex ? '/presets/' + ex.id : '/presets', ex ? 'PUT' : 'POST', { segment, name: n, visibility: vis, data }); setMsg('Saved'); load(); }
    catch (e) { setMsg((e as Error).message); }
  };
  return (
    <section className="group">
      <h3>Presets</h3>
      <div className="inline">
        <select value={sel} onChange={(e) => setSel(e.target.value)}>
          <option value="">Choose preset…</option>
          {list.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.mine ? p.visibility : p.owner}</option>)}
        </select>
        <button className="link" disabled={!cur} onClick={() => { if (cur) { onLoad(cur.data); setName(cur.name); } }}>Load</button>
        <button className="link" disabled={!cur || !cur.mine} onClick={async () => { if (cur) { await api('/presets/' + cur.id, 'DELETE'); trashed('preset', cur.id, cur.name); setSel(''); load(); } }}>Delete</button>
      </div>
      <div className="inline">
        <input placeholder="Preset name" value={name} onChange={(e) => setName(e.target.value)} />
        <select value={vis} onChange={(e) => setVis(e.target.value)}><option value="private">Private</option><option value="shared">Shared</option></select>
        <button className="btn" onClick={save}>Save</button>{msg && <span className="mut">{msg}</span>}
      </div>
    </section>
  );
}

export type Step = { s: string; m: number };

/**
 * Drag-to-reorder for a list: give each row `rowRef(i)` and its handle `handle(i)`. Works with mouse, touch and pen;
 * with the handle focused, the arrow keys move the row.
 */
export function useReorder<T>(list: T[], onChange: (l: T[]) => void) {
  const [drag, setDrag] = useState<number | null>(null);
  const rows = useRef<(HTMLElement | null)[]>([]), cur = useRef<number | null>(null), latest = useRef(list);
  latest.current = list;
  const move = (from: number, to: number) => {
    const l = [...latest.current], [x] = l.splice(from, 1); l.splice(to, 0, x); latest.current = l; onChange(l);
  };
  const handle = (i: number) => ({
    className: 'drag-handle', role: 'button', tabIndex: 0, 'aria-label': `Move step ${i + 1} (drag, or arrow keys)`, title: 'Drag to reorder',
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); cur.current = i; setDrag(i); },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const from = cur.current; if (from === null) return;
      const mids = rows.current.slice(0, latest.current.length).map((r) => { const b = r?.getBoundingClientRect(); return b ? b.top + b.height / 2 : 0; });
      let to = mids.filter((m) => e.clientY > m).length; if (to > from) to -= 1; // index among the rows without the dragged one
      to = Math.max(0, Math.min(latest.current.length - 1, to));
      if (to !== from) { move(from, to); cur.current = to; setDrag(to); }
    },
    onPointerUp: () => { cur.current = null; setDrag(null); },
    onPointerCancel: () => { cur.current = null; setDrag(null); },
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      const to = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : -1;
      if (to < 0 || to >= list.length) return;
      e.preventDefault(); move(i, to);
      requestAnimationFrame(() => (rows.current[to]?.querySelector('.drag-handle') as HTMLElement | null)?.focus());
    },
  });
  const rowRef = (i: number) => (el: HTMLElement | null) => { rows.current[i] = el; };
  return { drag, handle, rowRef };
}

export const Grip = () => <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">{[3, 8, 13].flatMap((y) => [2.5, 7.5].map((x) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.4" />))}</svg>;

export function StepList({ title, list, options, onChange }: { title: string; list: Step[]; options: string[]; onChange: (l: Step[]) => void }) {
  const up = (i: number, p: Partial<Step>) => onChange(list.map((y, j) => (j === i ? { ...y, ...p } : y)));
  const { drag, handle, rowRef } = useReorder(list, onChange);
  return (
    <section className="group">
      <h3>{title}</h3>
      {list.map((x, i) => (
        <div className={'row step-row' + (drag === i ? ' dragging' : '')} key={i} ref={rowRef(i)}>
          <span className="inline">{list.length > 1 && <span {...handle(i)}><Grip /></span>}<span className="mut">{i + 1}</span>
            <select value={x.s} onChange={(e) => up(i, { s: e.target.value })}>{options.map((o) => <option key={o}>{o}</option>)}</select></span>
          <span className="inline"><input type="number" min="0" value={x.m} onChange={(e) => up(i, { m: +e.target.value || 0 })} /> min
            <button className="link" onClick={() => onChange(list.filter((_, j) => j !== i))}>Remove</button></span>
        </div>
      ))}
      <button className="link" onClick={() => onChange([...list, { s: options[0], m: 10 }])}>+ Add step</button>
    </section>
  );
}

/** Substrate drawing: glass, ITO, optional scrape zone and metal contact. Legend lists only the colors present. */
export function SubstrateImg({ sub, metal = [], scrape = [], k = 12, so = 0.6, legend: showLegend = true, mc = ['#2ea043', '#888'] }: { sub: SubKey; metal?: Rect[]; scrape?: Rect[]; k?: number; so?: number; legend?: boolean; mc?: [string, string] }) {
  const S = SUBSTRATES[sub];
  const r = (x: Rect, c: string, o: number, key: string, st = '#888') => <rect key={key} x={x[0] * k} y={x[1] * k} width={x[2] * k} height={x[3] * k} fill={c} opacity={o} stroke={st} strokeWidth=".5" />;
  const legend = ['blue ITO', 'grey ITO-free glass', metal.length && 'metal contact', scrape.length && 'red scrape zone'].filter(Boolean).join(' · ');
  return (
    <figure style={{ margin: 0 }}>
      <svg width={S.w * k} height={S.h * k} viewBox={`0 0 ${S.w * k} ${S.h * k}`} style={{ maxWidth: '100%', height: 'auto' }}>
        {r([0, 0, S.w, S.h], 'var(--sep)', 1, 'g')}{r(S.ito, '#5b8def', 0.6, 'i')}
        {scrape.map((x, i) => r(x, '#e5484d', so, 's' + i))}{metal.map((x, i) => r(x, mc[0], 1, 'm' + i, mc[1]))}
      </svg>
      {showLegend && <figcaption className="mut small">{legend}</figcaption>}
    </figure>
  );
}

export const mmss = (s: number) => (isFinite(s) ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : '—');
export function Num({ v, on, w }: { v: number; on: (n: number) => void; w?: number }) {
  const [txt, setTxt] = useState(String(v ?? '')), last = useRef(v);
  useEffect(() => { if (v !== last.current) { last.current = v; setTxt(String(v ?? '')); } }, [v]);
  return <input inputMode="decimal" value={txt} style={w ? { width: w } : undefined}
    onChange={(e) => { const t = e.target.value.replace(',', '.'); setTxt(t); const n = parseFloat(t); if (isFinite(n)) { last.current = n; on(n); } else if (t === '') { last.current = 0; on(0); } }} />;
}
export const Check = ({ v, on }: { v: boolean; on: (b: boolean) => void }) => <input type="checkbox" checked={v} onChange={(e) => on(e.target.checked)} />;
