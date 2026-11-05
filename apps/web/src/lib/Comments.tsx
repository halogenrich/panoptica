import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { fmtDate } from './ui';
import Avatar from './Avatar';
const EmojiPicker = lazy(() => import('./EmojiPicker'));

type C = { id: number; parent_id: number | null; author: string; authorId: number; photoV?: number | null; professor: boolean; private: boolean; mine: boolean; created_at: string; edited_at: string | null; deleted: boolean; text: string; canDelete: boolean;
  reactions: { emoji: string; n: number; mine: boolean; who: string[] }[] };
const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso.replace(' ', 'T') + (iso.includes('Z') || iso.includes('+') ? '' : 'Z')).getTime()) / 1000;
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : s < 7 * 86400 ? `${Math.floor(s / 86400)} d ago` : fmtDate(iso);
};

/** Comment count for a tab label. */
export function useCommentCount(kind: 'preset' | 'batch', id: number) {
  const [n, setN] = useState(0);
  useEffect(() => { api<{ n: number }>(`/comments-count/${kind}/${id}`).then((r) => setN(r.n)).catch(() => {}); }, [kind, id]);
  return n;
}

function Composer({ onSend, placeholder, initial = '', onCancel, autoFocus, privateTo }: { onSend: (t: string, priv: boolean) => Promise<unknown>; placeholder: string; initial?: string; onCancel?: () => void; autoFocus?: boolean; privateTo?: string }) {
  const [t, setT] = useState(initial), [busy, setBusy] = useState(false), [err, setErr] = useState(''), [priv, setPriv] = useState(false);
  const send = () => { if (!t.trim()) return; setBusy(true); onSend(t.trim(), priv).then(() => { setT(''); setErr(''); setPriv(false); }).catch((e) => setErr(e.message)).finally(() => setBusy(false)); };
  return (
    <div className="composer">
      <textarea value={t} placeholder={placeholder} autoFocus={autoFocus} rows={2} onChange={(e) => setT(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }} />
      <div className="inline">
        <button className="btn" disabled={busy || !t.trim()} onClick={send}>{initial ? 'Save' : priv ? 'Send privately' : 'Send'}</button>
        {privateTo !== undefined && <label className="inline small" title="Only you and the owner see it, with its replies"><input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} /> Private, only for {privateTo || 'the owner'}</label>}
        {onCancel && <button className="link" onClick={onCancel}>Cancel</button>}
        <span className="mut small">Ctrl + Enter to send</span>
        {err && <span className="err small">{err}</span>}
      </div>
    </div>
  );
}

/** Comments on a stack, protocol (recipe or design) or batch: write, reply, react. The owner is notified of new comments, authors of replies. */
export default function Comments({ kind, id }: { kind: 'preset' | 'batch'; id: number }) {
  const [data, setData] = useState<{ items: C[]; owner: string; canPrivate: boolean } | null>(null), [err, setErr] = useState(''), [reply, setReply] = useState<number | null>(null), [edit, setEdit] = useState<number | null>(null), [pick, setPick] = useState<number | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const load = () => api<{ items: C[]; owner: string; canPrivate: boolean }>(`/comments/${kind}/${id}`).then(setData).catch((e) => setErr(e.message));
  const list = data?.items ?? null;
  useEffect(() => { load(); }, [kind, id]);
  const post = (text: string, parent_id?: number, priv = false) => api(`/comments/${kind}/${id}`, 'POST', { text, parent_id, private: priv || undefined }).then(() => { setReply(null); load(); });
  const react = (c: C, emoji: string) => api(`/comments/${c.id}/react`, 'POST', { emoji }).then(() => { setPick(null); load(); }).catch((e) => setErr(e.message));
  const del = (c: C) => window.confirm('Delete this comment?') && api(`/comments/${c.id}`, 'DELETE').then(load).catch((e) => setErr(e.message));
  if (!list) return <p className="mut">{err || 'Loading comments…'}</p>;
  // the Professor's comments come first (then in time order); replies stay in time order
  const kids = (pid: number | null) => { const k = list.filter((c) => c.parent_id === pid); return pid === null ? [...k.filter((c) => c.professor && !c.deleted), ...k.filter((c) => !(c.professor && !c.deleted))] : k; };
  const node = (c: C, depth: number): React.ReactNode => {
    const children = kids(c.id);
    if (c.deleted && !children.length) return null;
    return (
      <li key={c.id} className={'comment' + (c.professor && !c.deleted ? ' prof' : '')}>
        <div className="c-body">
        <div className="c-head">{!c.deleted && <Avatar id={c.authorId} name={c.author} photoV={c.photoV} size={24} />}<b>{c.deleted ? 'Comment deleted' : c.author}</b>
          {!c.deleted && c.professor && <span className="c-badge">Professor</span>}{c.private && depth === 0 && <span className="c-badge priv">Private</span>}
          {!c.deleted && <span className="mut small">{ago(c.created_at)}{c.edited_at ? ' · edited' : ''}</span>}</div>
        {edit === c.id
          ? <Composer initial={c.text} placeholder="" autoFocus onCancel={() => setEdit(null)} onSend={(t) => api(`/comments/${c.id}`, 'PATCH', { text: t }).then(() => { setEdit(null); load(); })} />
          : !c.deleted && <p className="c-text">{c.text}</p>}
        {!c.deleted && edit !== c.id && (
          <div className="c-actions">
            {c.reactions.map((r) => <button key={r.emoji} className={'react' + (r.mine ? ' on' : '')} title={r.who.join(', ')} aria-pressed={r.mine} onClick={() => react(c, r.emoji)}>{r.emoji} {r.n}</button>)}
            <span className="react-pick">
              <button className="link small" aria-label="Add a reaction" onClick={(e) => { anchor.current = e.currentTarget; setPick(pick === c.id ? null : c.id); }}>☺︎+</button>
              {pick === c.id && <Suspense fallback={null}><EmojiPicker anchor={anchor.current} onPick={(e) => { react(c, e); setPick(null); }} onClose={() => setPick(null)} /></Suspense>}
            </span>
            <button className="link small" onClick={() => setReply(reply === c.id ? null : c.id)}>Reply</button>
            {c.mine && <button className="link small" onClick={() => setEdit(c.id)}>Edit</button>}
            {c.canDelete && <button className="link small danger-link" onClick={() => del(c)}>Delete</button>}
          </div>
        )}
        </div>
        {reply === c.id && <Composer placeholder={`Reply to ${c.author}…`} autoFocus onCancel={() => setReply(null)} onSend={(t) => post(t, c.id)} />}
        {children.length > 0 && <ul className={'c-list' + (depth >= 2 ? ' flat' : '')}>{children.map((x) => node(x, depth + 1))}</ul>}
      </li>
    );
  };
  return (
    <section className="comments">
      {err && <p className="err small">{err}</p>}
      {list.filter((c) => !c.deleted).length === 0 && <p className="mut">No comments yet. Questions, tips and results about this go here; the owner is notified.</p>}
      <ul className="c-list c-root">{kids(null).map((c) => node(c, 0))}</ul>
      <Composer placeholder="Write a comment…" privateTo={data?.canPrivate ? data.owner : undefined} onSend={(t, priv) => post(t, undefined, priv)} />
    </section>
  );
}
