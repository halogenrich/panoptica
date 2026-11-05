import { useEffect, useRef, useState } from 'react';

/**
 * Undo/redo for an editor whose value lives outside it. `apply(next, commit)` records the current value first when commit is true
 * (start of a gesture or a discrete edit); continuous drags pass commit=false after their first step.
 */
export function useHistory<T>(value: T, setValue: (v: T) => void) {
  const past = useRef<T[]>([]),
    future = useRef<T[]>([]),
    cur = useRef(value),
    [, tick] = useState(0);
  cur.current = value;
  const apply = (next: T, commit = true) => {
    if (commit) {
      past.current.push(cur.current);
      if (past.current.length > 200) past.current.shift();
      future.current = [];
      tick((n) => n + 1);
    }
    setValue(next);
  };
  const undo = () => {
    const p = past.current.pop();
    if (p === undefined) return;
    future.current.push(cur.current);
    setValue(p);
    tick((n) => n + 1);
  };
  const redo = () => {
    const f = future.current.pop();
    if (f === undefined) return;
    past.current.push(cur.current);
    setValue(f);
    tick((n) => n + 1);
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (
        !(e.ctrlKey || e.metaKey) ||
        (e.target as HTMLElement)?.tagName === 'INPUT' ||
        (e.target as HTMLElement)?.tagName === 'TEXTAREA'
      )
        return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
  return { apply, undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0 };
}
