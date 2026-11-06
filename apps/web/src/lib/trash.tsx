import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

/**
 * Deleting moves things to the trash. After a delete, a toast offers Undo for a few seconds; the Trash page (Library › Trash)
 * restores anything for 30 days.
 */
type Toast = { id: number; text: string; undo?: () => Promise<unknown> };
let seq = 0;
const listeners = new Set<(t: Toast) => void>();
export function showToast(text: string, undo?: () => Promise<unknown>) {
  const t = { id: ++seq, text, undo };
  listeners.forEach((l) => l(t));
}
/** Lists reload on this event: after an undo or a restore here, or a change made by someone else (live updates, lib/live.ts). */
export const refreshAll = () => window.dispatchEvent(new Event('psc-refresh'));
/**
 * Reloads with `load` when something it shows changed. `topics` narrows it to some kinds of change ("calendar", "batches",
 * "presets", "inventory", "iv", "comments", "notifications", "users"); without topics it reloads on any change.
 * Several changes in a row cause one reload.
 */
export function useRefresh(load: () => void, topics?: string[]) {
  const ref = useRef(load);
  ref.current = load;
  const key = topics?.join(',') ?? '';
  useEffect(() => {
    let t = 0;
    const f = (e: Event) => {
      const got: string[] | undefined = (e as CustomEvent).detail?.topics;
      if (got && topics && !got.includes('all') && !got.some((x) => topics.includes(x))) return;
      window.clearTimeout(t);
      t = window.setTimeout(() => ref.current(), 200);
    };
    window.addEventListener('psc-refresh', f);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('psc-refresh', f);
    };
  }, [key]);
}

/** Called after a delete succeeded: toast with Undo (restores from the trash). */
export function trashed(kind: 'preset' | 'batch' | 'iv', id: number, name: string) {
  showToast(`“${name}” moved to the trash`, () => api(`/trash/${kind}/${id}/restore`, 'POST').then(refreshAll));
}

export function Toaster() {
  const [t, setT] = useState<Toast | null>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const l = (x: Toast) => setT(x);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  useEffect(() => {
    if (!t) return;
    const h = setTimeout(() => setT((c) => (c?.id === t.id ? null : c)), t.undo ? 9000 : 4500);
    return () => clearTimeout(h);
  }, [t]);
  if (!t) return null;
  return (
    <div className="toast with-action" role="status">
      <span>{t.text}</span>
      {t.undo && (
        <button
          className="link"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            t.undo!()
              .then(() => setT({ id: ++seq, text: 'Restored' }))
              .catch((e) => setT({ id: ++seq, text: e.message }))
              .finally(() => setBusy(false));
          }}
        >
          Undo
        </button>
      )}
    </div>
  );
}
