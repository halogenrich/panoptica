import { useEffect, useState } from 'react';
import { api } from '../api';

export type Note = { id: number; kind: 'record' | 'fork' | 'comment' | 'reply'; text: string; link: { view: string; id: number }; actor: string; read: boolean; created_at: string };
const ICON: Record<string, string> = { record: '🏆', fork: '🧬', comment: '💬', reply: '↩︎', batch: '▶︎' };
const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso.replace(' ', 'T') + 'Z').getTime()) / 1000;
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`;
};

/** Unread count and list, refreshed every minute (and when the bell opens). */
export function useNotifications() {
  const [d, setD] = useState<{ unread: number; items: Note[] }>({ unread: 0, items: [] });
  const load = () => api<{ unread: number; items: Note[] }>('/notifications').then(setD).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, []);
  return { ...d, load, read: (ids?: number[]) => api('/notifications/read', 'POST', ids ? { ids } : {}).then(load) };
}

/** The bell's list: lab records, protocols based on yours, comments and replies. Click one to open what it is about. */
export function NotificationList({ n, onOpen }: { n: ReturnType<typeof useNotifications>; onOpen: (link: Note['link']) => void }) {
  useEffect(() => { n.load(); }, []);
  return (
    <div className="notify">
      <div className="inline"><b>Notifications</b><div className="grow" />{n.unread > 0 && <button className="link small" onClick={() => n.read()}>Mark all as read</button>}</div>
      {n.items.length === 0 ? <p className="mut small">Nothing yet. You are told here when someone breaks the lab record, makes a protocol based on yours, or comments on your work.</p>
        : <ul>{n.items.map((x) => (
          <li key={x.id}><button className={'notify-item' + (x.read ? '' : ' unread')} onClick={() => { if (!x.read) n.read([x.id]); onOpen(x.link); }}>
            <span className="notify-icon" aria-hidden>{ICON[x.kind] ?? '•'}</span><span><span className="notify-text">{x.text}</span><span className="mut small">{ago(x.created_at)}</span></span>
          </button></li>))}</ul>}
    </div>
  );
}
