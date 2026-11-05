import { useEffect, useRef, useState } from 'react';

export type Cmd = { id: string; label: string; hint?: string; run: () => void };

/** Search and quick navigation (Ctrl+K on desktop, "Menu" sheet on phones). Navigation commands filter locally; items found by name come from `search`. */
export default function Palette({ cmds, search, onClose }: { cmds: Cmd[]; search?: (q: string) => Promise<Cmd[]>; onClose: () => void }) {
  const [q, setQ] = useState(''), [i, setI] = useState(0), [found, setFound] = useState<Cmd[]>([]), ref = useRef<HTMLInputElement>(null);
  const list = [...cmds.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())), ...(q.length > 1 ? found : [])];
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => {
    if (!search || q.length < 2) { setFound([]); return; }
    let live = true;
    const t = setTimeout(() => search(q).then((r) => live && setFound(r)).catch(() => {}), 200);
    return () => { live = false; clearTimeout(t); };
  }, [q]);
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setI(Math.min(i + 1, list.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setI(Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && list[i]) { list[i].run(); onClose(); }
    else if (e.key === 'Escape') onClose();
  };
  return (
    <div className="scrim" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input ref={ref} placeholder="Search presets, batches, chemicals, or go to…" value={q} onChange={(e) => { setQ(e.target.value); setI(0); }} onKeyDown={key} />
        {list.map((c, j) => (
          <button key={c.id} className={'pitem' + (j === i ? ' on' : '')} onMouseEnter={() => setI(j)} onClick={() => { c.run(); onClose(); }}>
            {c.label}<span className="mut">{c.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
