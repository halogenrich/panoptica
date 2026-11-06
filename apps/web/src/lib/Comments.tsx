import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useRefresh } from './trash';
import { api } from '../api';
import { fmtDate } from './ui';
import Avatar from './Avatar';
const EmojiPicker = lazy(() => import('./EmojiPicker'));

type C = {
  id: number;
  parent_id: number | null;
  author: string;
  authorId: number;
  photoV?: number | null;
  professor: boolean;
  private: boolean;
  mine: boolean;
  created_at: string;
  edited_at: string | null;
  deleted: boolean;
  text: string;
  canDelete: boolean;
  reactions: { emoji: string; n: number; mine: boolean; who: string[] }[];
};
const ago = (iso: string) => {
  const s =
    (Date.now() - new Date(iso.replace(' ', 'T') + (iso.includes('Z') || iso.includes('+') ? '' : 'Z')).getTime()) /
    1000;
  return s < 60
    ? 'just now'
    : s < 3600
      ? `${Math.floor(s / 60)} min ago`
      : s < 86400
        ? `${Math.floor(s / 3600)} h ago`
        : s < 7 * 86400
          ? `${Math.floor(s / 86400)} d ago`
          : fmtDate(iso);
};

/** Comment count for a tab label. */
export function useCommentCount(kind: 'preset' | 'batch', id: number) {
  const [n, setN] = useState(0);
  useEffect(() => {
    api<{ n: number }>(`/comments-count/${kind}/${id}`)
      .then((r) => setN(r.n))
      .catch(() => {});
  }, [kind, id]);
  return n;
}

/** Someone who can open the item, offered after "@". */
export type Person = { id: number; username: string; name: string; photoV?: number | null; me?: boolean };
const MENTION = /(^|[^\w@.])@([a-zA-Z0-9._-]{3,40})/g;

/** Comment text with `@username` shown as the person's name (only for people who can open the item). */
function withMentions(text: string, people: Person[]) {
  const by = new Map(people.map((p) => [p.username.toLowerCase(), p]));
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION)) {
    const raw = m[2],
      name = raw.replace(/[.-]+$/, ''),
      p = by.get(name.toLowerCase());
    if (!p) continue;
    const at = m.index! + m[1].length;
    out.push(text.slice(last, at));
    out.push(
      <span key={at} className={'mention' + (p.me ? ' me' : '')} title={'@' + p.username}>
        @{p.name}
      </span>,
    );
    last = at + 1 + name.length;
  }
  out.push(text.slice(last));
  return out;
}

function Composer({
  onSend,
  placeholder,
  initial = '',
  onCancel,
  autoFocus,
  privateTo,
  people = [],
}: {
  onSend: (t: string, priv: boolean) => Promise<unknown>;
  placeholder: string;
  initial?: string;
  onCancel?: () => void;
  autoFocus?: boolean;
  privateTo?: string;
  people?: Person[];
}) {
  const [t, setT] = useState(initial),
    [busy, setBusy] = useState(false),
    [err, setErr] = useState(''),
    [priv, setPriv] = useState(false),
    // the "@word" being typed: where its @ is, the text after it, and the highlighted suggestion
    [m, setM] = useState<{ at: number; q: string; i: number } | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const track = (v: string, caret: number) => {
    const x = v.slice(0, caret).match(/(^|[^\w@.])@([a-zA-Z0-9._-]{0,40})$/);
    setM(x ? { at: caret - x[2].length - 1, q: x[2].toLowerCase(), i: 0 } : null);
  };
  const hits = m
    ? people
        .filter(
          (p) =>
            !p.me &&
            (p.username.toLowerCase().startsWith(m.q) ||
              p.name
                .toLowerCase()
                .split(/\s+/)
                .some((w) => w.startsWith(m.q))),
        )
        .slice(0, 6)
    : [];
  const choose = (p: Person) => {
    if (!m || !ta.current) return;
    const end = ta.current.selectionStart,
      ins = '@' + p.username + ' ';
    setT(t.slice(0, m.at) + ins + t.slice(end));
    setM(null);
    const pos = m.at + ins.length;
    requestAnimationFrame(() => {
      ta.current?.focus();
      ta.current?.setSelectionRange(pos, pos);
    });
  };
  const send = () => {
    if (!t.trim()) return;
    setBusy(true);
    onSend(t.trim(), priv)
      .then(() => {
        setT('');
        setErr('');
        setPriv(false);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <div className="composer">
      <textarea
        ref={ta}
        value={t}
        placeholder={placeholder}
        autoFocus={autoFocus}
        rows={2}
        role="combobox"
        aria-expanded={hits.length > 0}
        aria-autocomplete="list"
        onChange={(e) => {
          setT(e.target.value);
          track(e.target.value, e.target.selectionStart);
        }}
        onClick={(e) => track(t, e.currentTarget.selectionStart)}
        onBlur={() => setTimeout(() => setM(null), 150)}
        onKeyDown={(e) => {
          if (m && hits.length) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const n = hits.length;
              setM({ ...m, i: (m.i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n });
              return;
            }
            if ((e.key === 'Enter' && !e.ctrlKey && !e.metaKey) || e.key === 'Tab') {
              e.preventDefault();
              choose(hits[Math.min(m.i, hits.length - 1)]);
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              setM(null);
              return;
            }
          }
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            send();
          }
        }}
      />
      {hits.length > 0 && m && (
        <ul className="mention-menu" role="listbox" aria-label="Mention someone">
          {hits.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={i === m.i}
              className={i === m.i ? 'on' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(p);
              }}
              onMouseEnter={() => setM({ ...m, i })}
            >
              <Avatar id={p.id} name={p.name} photoV={p.photoV} size={22} />
              <span>{p.name}</span>
              <span className="mut small">@{p.username}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="inline">
        <button className="btn" disabled={busy || !t.trim()} onClick={send}>
          {initial ? 'Save' : priv ? 'Send privately' : 'Send'}
        </button>
        {privateTo !== undefined && (
          <label className="inline small" title="Only you and the owner see it, with its replies">
            <input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} /> Private, only for{' '}
            {privateTo || 'the owner'}
          </label>
        )}
        {onCancel && (
          <button className="link" onClick={onCancel}>
            Cancel
          </button>
        )}
        <span className="mut small">{people.length > 1 ? '@ to mention someone · ' : ''}Ctrl + Enter to send</span>
        {err && <span className="err small">{err}</span>}
      </div>
    </div>
  );
}

/** Comments on a stack, protocol (recipe or design) or batch: write, reply, react. The owner is notified of new comments, authors of replies. */
export default function Comments({ kind, id }: { kind: 'preset' | 'batch'; id: number }) {
  const [data, setData] = useState<{ items: C[]; owner: string; canPrivate: boolean } | null>(null),
    [err, setErr] = useState(''),
    [reply, setReply] = useState<number | null>(null),
    [edit, setEdit] = useState<number | null>(null),
    [pick, setPick] = useState<number | null>(null),
    [people, setPeople] = useState<Person[]>([]);
  const anchor = useRef<HTMLElement | null>(null);
  useEffect(() => {
    api<Person[]>(`/comments/${kind}/${id}/people`)
      .then(setPeople)
      .catch(() => setPeople([]));
  }, [kind, id]);
  const load = () =>
    api<{ items: C[]; owner: string; canPrivate: boolean }>(`/comments/${kind}/${id}`)
      .then(setData)
      .catch((e) => setErr(e.message));
  const list = data?.items ?? null;
  useEffect(() => {
    load();
  }, [kind, id]);
  useRefresh(load, ['comments']);
  const post = (text: string, parent_id?: number, priv = false) =>
    api(`/comments/${kind}/${id}`, 'POST', { text, parent_id, private: priv || undefined }).then(() => {
      setReply(null);
      load();
    });
  const react = (c: C, emoji: string) =>
    api(`/comments/${c.id}/react`, 'POST', { emoji })
      .then(() => {
        setPick(null);
        load();
      })
      .catch((e) => setErr(e.message));
  const del = (c: C) =>
    window.confirm('Delete this comment?') &&
    api(`/comments/${c.id}`, 'DELETE')
      .then(load)
      .catch((e) => setErr(e.message));
  if (!list) return <p className="mut">{err || 'Loading comments…'}</p>;
  // the Professor's comments come first (then in time order); replies stay in time order
  const kids = (pid: number | null) => {
    const k = list.filter((c) => c.parent_id === pid);
    return pid === null
      ? [...k.filter((c) => c.professor && !c.deleted), ...k.filter((c) => !(c.professor && !c.deleted))]
      : k;
  };
  const node = (c: C, depth: number): React.ReactNode => {
    const children = kids(c.id);
    if (c.deleted && !children.length) return null;
    return (
      <li key={c.id} className={'comment' + (c.professor && !c.deleted ? ' prof' : '')}>
        <div className="c-body">
          <div className="c-head">
            {!c.deleted && <Avatar id={c.authorId} name={c.author} photoV={c.photoV} size={24} />}
            <b>{c.deleted ? 'Comment deleted' : c.author}</b>
            {!c.deleted && c.professor && <span className="c-badge">Professor</span>}
            {c.private && depth === 0 && <span className="c-badge priv">Private</span>}
            {!c.deleted && (
              <span className="mut small">
                {ago(c.created_at)}
                {c.edited_at ? ' · edited' : ''}
              </span>
            )}
          </div>
          {edit === c.id ? (
            <Composer
              initial={c.text}
              placeholder=""
              autoFocus
              people={people}
              onCancel={() => setEdit(null)}
              onSend={(t) =>
                api(`/comments/${c.id}`, 'PATCH', { text: t }).then(() => {
                  setEdit(null);
                  load();
                })
              }
            />
          ) : (
            !c.deleted && <p className="c-text">{withMentions(c.text, people)}</p>
          )}
          {!c.deleted && edit !== c.id && (
            <div className="c-actions">
              {c.reactions.map((r) => (
                <button
                  key={r.emoji}
                  className={'react' + (r.mine ? ' on' : '')}
                  title={r.who.join(', ')}
                  aria-pressed={r.mine}
                  onClick={() => react(c, r.emoji)}
                >
                  {r.emoji} {r.n}
                </button>
              ))}
              <span className="react-pick">
                <button
                  className="link small"
                  aria-label="Add a reaction"
                  onClick={(e) => {
                    anchor.current = e.currentTarget;
                    setPick(pick === c.id ? null : c.id);
                  }}
                >
                  ☺︎+
                </button>
                {pick === c.id && (
                  <Suspense fallback={null}>
                    <EmojiPicker
                      anchor={anchor.current}
                      onPick={(e) => {
                        react(c, e);
                        setPick(null);
                      }}
                      onClose={() => setPick(null)}
                    />
                  </Suspense>
                )}
              </span>
              <button className="link small" onClick={() => setReply(reply === c.id ? null : c.id)}>
                Reply
              </button>
              {c.mine && (
                <button className="link small" onClick={() => setEdit(c.id)}>
                  Edit
                </button>
              )}
              {c.canDelete && (
                <button className="link small danger-link" onClick={() => del(c)}>
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
        {reply === c.id && (
          <Composer
            placeholder={`Reply to ${c.author}…`}
            autoFocus
            people={c.private ? [] : people}
            onCancel={() => setReply(null)}
            onSend={(t) => post(t, c.id)}
          />
        )}
        {children.length > 0 && (
          <ul className={'c-list' + (depth >= 2 ? ' flat' : '')}>{children.map((x) => node(x, depth + 1))}</ul>
        )}
      </li>
    );
  };
  return (
    <section className="comments">
      {err && <p className="err small">{err}</p>}
      {list.filter((c) => !c.deleted).length === 0 && (
        <p className="mut">
          No comments yet. Questions, tips and results about this go here; the owner is notified, and anyone you mention
          with @.
        </p>
      )}
      <ul className="c-list c-root">{kids(null).map((c) => node(c, 0))}</ul>
      <Composer
        placeholder="Write a comment…"
        people={people}
        privateTo={data?.canPrivate ? data.owner : undefined}
        onSend={(t, priv) => post(t, undefined, priv)}
      />
    </section>
  );
}
