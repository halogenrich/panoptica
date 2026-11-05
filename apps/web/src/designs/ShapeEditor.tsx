import { useEffect, useState, type ReactNode } from 'react';
import { SHAPE_LABEL, moveShape, newId, type Shape, type ShapeKind } from '@psc/core';
import { Seg } from '../lib/ui';
import Canvas, { type Tool } from './Canvas';
import type { Layer, Marker } from './DesignSvg';

/**
 * Toolbar + canvas for one editable layer of shapes. Keyboard: Delete, arrows (Shift = ×10), Ctrl+D duplicate.
 * Undo/redo is owned by the caller (`undo`, `redo`) because the whole design is one history.
 */
export default function ShapeEditor({ w, h, marker, background, shapes, color, onChange, sel, setSel, undo, redo, canUndo, canRedo, right, labels }: {
  w: number; h: number; marker?: Marker; background?: Layer[]; shapes: Shape[]; color: string;
  onChange: (s: Shape[], commit: boolean) => void; sel: string | null; setSel: (id: string | null) => void;
  undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean; right?: ReactNode; labels?: { at: [number, number]; text: string }[];
}) {
  const [tool, setTool] = useState<Tool>('select'), [snap, setSnap] = useState(0.5);
  const selected = shapes.find((s) => s.id === sel);
  const dup = () => { if (!selected) return; const c = { ...moveShape(selected, snap || 1, snap || 1), id: newId() }; onChange([...shapes, c], true); setSel(c.id); };
  const del = () => { if (!selected) return; onChange(shapes.filter((s) => s.id !== sel), true); setSel(null); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = (e.target as HTMLElement)?.tagName;
      if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA' || !selected) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); del(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); dup(); }
      else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const s = (e.shiftKey ? 10 : 1) * (snap || 0.1), dx = e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0, dy = e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0;
        onChange(shapes.map((x) => (x.id === sel ? moveShape(x, dx, dy) : x)), true);
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  return (
    <div className="designer-main">
      <div className="toolbar">
        <Seg value={tool} on={setTool} small opts={[['select', 'Select'], ...(Object.keys(SHAPE_LABEL) as ShapeKind[]).map((k) => [k, SHAPE_LABEL[k]] as [Tool, string])]} />
        <label className="inline small">Snap <select value={snap} onChange={(e) => setSnap(+e.target.value)}>
          <option value={1}>1 mm</option><option value={0.5}>0.5 mm</option><option value={0.1}>0.1 mm</option><option value={0}>Off</option></select></label>
        <div className="grow" />
        <button className="link" disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)">Undo</button>
        <button className="link" disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Y)">Redo</button>
        <button className="link" disabled={!selected} onClick={dup} title="Duplicate (Ctrl+D)">Duplicate</button>
        <button className="link" disabled={!selected} onClick={del} title="Delete">Delete</button>
        {right}
      </div>
      <Canvas w={w} h={h} marker={marker} background={background} shapes={shapes} color={color} selected={sel} onSelect={setSel} tool={tool} setTool={setTool} snap={snap} onChange={onChange} labels={labels} />
    </div>
  );
}
