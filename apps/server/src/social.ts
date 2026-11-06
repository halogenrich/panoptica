import type { FastifyInstance } from 'fastify';
import { CommentIn, ReactIn } from '@psc/schema';
import { db, tx, perms } from './db.js';

type U = { id: number; name: string; username: string; role: 'admin' | 'member'; all?: boolean; professor?: boolean };
const canSee = (u: U, r: { owner_id: number; visibility: string }) =>
  r.owner_id === u.id || r.visibility === 'shared' || !!u.all;

// ------------------------------------------------------------------ notifications
/** Where a notification leads in the app: a preset (by segment), a batch or a measurement. */
export type Link = { view: string; id: number };
export function notify(userIds: number[], kind: string, text: string, link: Link, actor = '') {
  const ins = db.prepare('INSERT INTO notifications(user_id,kind,text,link,actor) VALUES(?,?,?,?,?)');
  for (const id of new Set(userIds)) ins.run(id, kind, text, JSON.stringify(link), actor);
}
const activeUsers = () =>
  (db.prepare('SELECT id FROM users WHERE active=1 AND deleted=0').all() as { id: number }[]).map((r) => r.id);

/** A new measurement with a better cell than any before (per J–V system, since the systems measure different cell sizes). */
export function checkRecord(setId: number, by: U) {
  const s = db.prepare('SELECT system,name FROM iv_sets WHERE id=?').get(setId) as { system: string; name: string };
  const best = (where: string, ...args: number[]) =>
    (
      db
        .prepare(
          `SELECT MAX(json_extract(c.metrics,'$.pce')) AS p FROM iv_curves c JOIN iv_sets s ON s.id=c.set_id
    WHERE json_extract(c.metrics,'$.status')='ok' AND (c.use=1 OR (c.use IS NULL AND (c.kind IS NULL OR c.kind<>'check'))) AND s.deleted_at IS NULL AND s.stability_of IS NULL AND s.system=? AND ${where}`,
        )
        .get(s.system, ...args) as { p: number | null }
    ).p;
  const now = best('s.id=?', setId),
    before = best('s.id<>?', setId);
  if (now === null || before === null || now <= before + 1e-9) return null; // the first measurement of a system sets no "record"
  const sys = s.system === 'padrao' ? '8-pixel system' : '1.5 × 2.5 system';
  notify(
    activeUsers(),
    'record',
    `New lab record on the ${sys}: ${now.toFixed(2)} % by ${by.name} (previous ${before.toFixed(2)} %)`,
    { view: 'iv', id: setId },
    by.name,
  );
  return { now, before };
}

/** Someone made a new preset based on yours (a new version or a duplicate). */
export function notifyFork(newId: number, parentId: number, by: U) {
  const p = db.prepare('SELECT owner_id,name,segment FROM presets WHERE id=?').get(parentId) as
    { owner_id: number; name: string; segment: string } | undefined;
  const n = db.prepare('SELECT name,segment FROM presets WHERE id=?').get(newId) as { name: string; segment: string };
  if (!p || p.owner_id === by.id) return;
  notify(
    [p.owner_id],
    'fork',
    `${by.name} made “${n.name}” based on your “${p.name}”`,
    { view: n.segment, id: newId },
    by.name,
  );
}

// ------------------------------------------------------------------ comment targets
type Target = { owner_id: number; visibility: string; name: string; link: Link };
function target(kind: string, id: number): Target | null {
  if (kind === 'preset') {
    const r = db
      .prepare('SELECT owner_id,visibility,name,segment FROM presets WHERE id=? AND deleted_at IS NULL')
      .get(id) as any;
    return r ? { owner_id: r.owner_id, visibility: r.visibility, name: r.name, link: { view: r.segment, id } } : null;
  }
  if (kind === 'batch') {
    const r = db
      .prepare('SELECT owner_id,visibility,code,name FROM batches WHERE id=? AND deleted_at IS NULL')
      .get(id) as any;
    return r
      ? {
          owner_id: r.owner_id,
          visibility: r.visibility,
          name: `batch ${r.code}${r.name ? ' · ' + r.name : ''}`,
          link: { view: 'batches', id },
        }
      : null;
  }
  return null;
}

/**
 * Comments on one target that this user may read. A private comment (from the Professor) and its replies are seen only by the
 * owner of the stack or batch and the author of the private comment.
 */
type CRow = { id: number; parent_id: number | null; user_id: number; private: number; [k: string]: any };
function readable(rows: CRow[], uid: number, owner: number) {
  const by = new Map(rows.map((c) => [c.id, c]));
  const root = (c: CRow) => {
    let r = c;
    for (let i = 0; r.parent_id && by.has(r.parent_id) && i < 100; i++) r = by.get(r.parent_id)!;
    return r;
  };
  return rows.filter((c) => {
    if (!c.private) return true;
    const r = root(c);
    return uid === owner || uid === r.user_id;
  });
}

// ------------------------------------------------------------------ mentions
/** Users named as `@username` in a comment text (a trailing . or - is punctuation, not part of the name). */
export function mentionsIn(text: string) {
  const out = new Set<string>();
  for (const m of text.matchAll(/(^|[^\w@.])@([a-zA-Z0-9._-]{3,40})/g))
    out.add(m[2].replace(/[.-]+$/, '').toLowerCase());
  return [...out].filter((n) => n.length >= 3);
}
/** Active users who can open the target; with `who`, the subset of those usernames. */
function readers(t: Target, who?: string[]) {
  const rows = db
    .prepare('SELECT id,username,name,role,photo_v AS photoV FROM users WHERE active=1 AND deleted=0 ORDER BY name')
    .all() as { id: number; username: string; name: string; role: string; photoV: number }[];
  return rows.filter(
    (u) =>
      (!who || who.includes(u.username.toLowerCase())) &&
      canSee({ id: u.id, all: u.role === 'admin' || perms(u.id).professor } as U, t),
  );
}
/** Mentioned users who can read this comment (a private thread is read only by the owner and the Professor who started it). */
function mentionTargets(text: string, t: Target, kind: string, tid: number, cid: number, by: number) {
  const names = mentionsIn(text);
  if (!names.length) return [];
  const all = db
    .prepare('SELECT id,parent_id,user_id,private FROM comments WHERE target=? AND target_id=?')
    .all(kind, tid) as CRow[];
  return readers(t, names)
    .filter((u) => u.id !== by && readable(all, u.id, t.owner_id).some((c) => c.id === cid))
    .map((u) => u.id);
}

// ------------------------------------------------------------------ trash
const TRASH_DAYS = 30;
type TrashKind = 'preset' | 'batch' | 'iv' | 'cmp';
const TABLE: Record<TrashKind, string> = { preset: 'presets', batch: 'batches', iv: 'iv_sets', cmp: 'comparisons' };

/** Permanently removes one trashed item (what the old delete did). */
function purgeOne(kind: TrashKind, id: number) {
  tx(() => {
    if (kind === 'preset') {
      const r = db.prepare('SELECT parent_id FROM presets WHERE id=?').get(id) as
        { parent_id: number | null } | undefined;
      if (!r) return;
      db.prepare('UPDATE presets SET parent_id=? WHERE parent_id=?').run(r.parent_id, id); // keep the family tree connected
      db.prepare("DELETE FROM comments WHERE target='preset' AND target_id=?").run(id);
      db.prepare('DELETE FROM presets WHERE id=?').run(id);
    } else if (kind === 'batch') {
      db.prepare("DELETE FROM comments WHERE target='batch' AND target_id=?").run(id);
      db.prepare('DELETE FROM batches WHERE id=?').run(id);
    } else if (kind === 'cmp') db.prepare('DELETE FROM comparisons WHERE id=?').run(id);
    else db.prepare('DELETE FROM iv_sets WHERE id=?').run(id);
  });
}
export function purgeTrash() {
  const cut = new Date(Date.now() - TRASH_DAYS * 864e5).toISOString();
  for (const k of Object.keys(TABLE) as TrashKind[])
    for (const r of db
      .prepare(`SELECT id FROM ${TABLE[k]} WHERE deleted_at IS NOT NULL AND deleted_at < ?`)
      .all(cut) as { id: number }[])
      purgeOne(k, r.id);
}

export function registerSocial(app: FastifyInstance, auth: (admin?: boolean) => any, bad: (reply: any, p: any) => any) {
  // ---- comments ----
  app.get('/api/comments/:kind/:id', { preHandler: auth() }, async (req: any, reply) => {
    const t = target(req.params.kind, +req.params.id);
    if (!t || !canSee(req.user, t)) return reply.code(404).send({ error: 'not found' });
    const rows = readable(
      db
        .prepare(
          `SELECT c.id,c.parent_id,c.text,c.deleted,c.created_at,c.edited_at,c.user_id,c.private,u.name AS author,u.photo_v AS photoV FROM comments c JOIN users u ON u.id=c.user_id
      WHERE c.target=? AND c.target_id=? ORDER BY c.id`,
        )
        .all(req.params.kind, +req.params.id) as CRow[],
      req.user.id,
      t.owner_id,
    );
    const prof = new Map<number, boolean>(),
      isProf = (id: number) => {
        if (!prof.has(id)) prof.set(id, perms(id).professor);
        return prof.get(id)!;
      };
    const rx = db
      .prepare(
        `SELECT r.comment_id,r.emoji,r.user_id,u.name FROM reactions r JOIN users u ON u.id=r.user_id JOIN comments c ON c.id=r.comment_id WHERE c.target=? AND c.target_id=? ORDER BY r.rowid`,
      )
      .all(req.params.kind, +req.params.id) as any[];
    const owner = db.prepare('SELECT name FROM users WHERE id=?').get(t.owner_id) as { name: string } | undefined;
    return {
      owner: owner?.name ?? '',
      canPrivate: !!req.user.professor && t.owner_id !== req.user.id,
      items: rows.map((c) => ({
        id: c.id,
        parent_id: c.parent_id,
        author: c.author,
        authorId: c.user_id,
        photoV: c.photoV,
        professor: isProf(c.user_id),
        private: !!c.private,
        mine: c.user_id === req.user.id,
        created_at: c.created_at,
        edited_at: c.edited_at,
        deleted: !!c.deleted,
        text: c.deleted ? '' : c.text,
        canDelete: c.user_id === req.user.id || req.user.role === 'admin',
        // in the order each emoji was first used on this comment
        reactions: [...new Set(rx.filter((r) => r.comment_id === c.id).map((r) => r.emoji as string))].map((e) => {
          const by = rx.filter((r) => r.comment_id === c.id && r.emoji === e);
          return {
            emoji: e,
            n: by.length,
            mine: by.some((r) => r.user_id === req.user.id),
            who: by.map((r) => r.name),
          };
        }),
      })),
    };
  });
  /** People who can open the item, for @mentions (the signed-in user is marked `me`). */
  app.get('/api/comments/:kind/:id/people', { preHandler: auth() }, async (req: any, reply) => {
    const t = target(req.params.kind, +req.params.id);
    if (!t || !canSee(req.user, t)) return reply.code(404).send({ error: 'not found' });
    return readers(t).map((u) => ({
      id: u.id,
      username: u.username,
      name: u.name,
      photoV: u.photoV,
      me: u.id === req.user.id,
    }));
  });
  app.post('/api/comments/:kind/:id', { preHandler: auth() }, async (req: any, reply) => {
    const t = target(req.params.kind, +req.params.id);
    if (!t || !canSee(req.user, t)) return reply.code(404).send({ error: 'not found' });
    const p = CommentIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    let parent: { user_id: number; private: number } | undefined;
    if (p.data.parent_id) {
      parent = db
        .prepare('SELECT user_id,private FROM comments WHERE id=? AND target=? AND target_id=?')
        .get(p.data.parent_id, req.params.kind, +req.params.id) as any;
      if (!parent) return reply.code(400).send({ error: 'the comment you reply to is gone' });
      const all = db
        .prepare('SELECT id,parent_id,user_id,private FROM comments WHERE target=? AND target_id=?')
        .all(req.params.kind, +req.params.id) as CRow[];
      if (!readable(all, req.user.id, t.owner_id).some((c) => c.id === p.data.parent_id))
        return reply.code(400).send({ error: 'the comment you reply to is gone' });
    }
    // a private comment is the Professor's choice; replies in a private thread stay private
    if (p.data.private && !req.user.professor)
      return reply.code(403).send({ error: 'only the Professor can write private comments' });
    if (p.data.private && t.owner_id === req.user.id)
      return reply.code(400).send({ error: 'a private comment goes to the owner; this is your own' });
    const priv = parent ? parent.private : p.data.private ? 1 : 0;
    const r = db
      .prepare('INSERT INTO comments(target,target_id,user_id,parent_id,text,private) VALUES(?,?,?,?,?,?)')
      .run(req.params.kind, +req.params.id, req.user.id, p.data.parent_id ?? null, p.data.text, priv);
    const snippet = p.data.text.length > 80 ? p.data.text.slice(0, 79) + '…' : p.data.text,
      cid = Number(r.lastInsertRowid);
    // a mention replaces the reply or comment notice for the person mentioned
    const named = mentionTargets(p.data.text, t, req.params.kind, +req.params.id, cid, req.user.id);
    notify(named, 'mention', `${req.user.name} mentioned you on “${t.name}”: ${snippet}`, t.link, req.user.name);
    if (parent && parent.user_id !== req.user.id && !named.includes(parent.user_id))
      notify(
        [parent.user_id],
        'reply',
        `${req.user.name} replied to your comment on “${t.name}”: ${snippet}`,
        t.link,
        req.user.name,
      );
    if (t.owner_id !== req.user.id && t.owner_id !== parent?.user_id && !named.includes(t.owner_id))
      notify(
        [t.owner_id],
        'comment',
        `${req.user.name} ${priv ? 'left you a private comment on' : 'commented on'} your “${t.name}”: ${snippet}`,
        t.link,
        req.user.name,
      );
    return { id: cid };
  });
  app.patch('/api/comments/:cid', { preHandler: auth() }, async (req: any, reply) => {
    const c = db
      .prepare('SELECT user_id,text,target,target_id FROM comments WHERE id=? AND deleted=0')
      .get(+req.params.cid) as any;
    if (!c) return reply.code(404).send({ error: 'not found' });
    if (c.user_id !== req.user.id) return reply.code(403).send({ error: 'only the author can edit a comment' });
    const p = CommentIn.pick({ text: true }).safeParse(req.body);
    if (!p.success) return bad(reply, p);
    db.prepare('UPDATE comments SET text=?,edited_at=CURRENT_TIMESTAMP WHERE id=?').run(p.data.text, +req.params.cid);
    // people newly mentioned by the edit are told; those named before were told already
    const t = target(c.target, c.target_id);
    if (t) {
      const before = new Set(mentionsIn(c.text)),
        added = mentionsIn(p.data.text).filter((n) => !before.has(n));
      if (added.length) {
        const ids = mentionTargets(
          added.map((n) => '@' + n).join(' '),
          t,
          c.target,
          c.target_id,
          +req.params.cid,
          req.user.id,
        );
        const snippet = p.data.text.length > 80 ? p.data.text.slice(0, 79) + '…' : p.data.text;
        notify(ids, 'mention', `${req.user.name} mentioned you on “${t.name}”: ${snippet}`, t.link, req.user.name);
      }
    }
    return { ok: true };
  });
  app.delete('/api/comments/:cid', { preHandler: auth() }, async (req: any, reply) => {
    const c = db.prepare('SELECT user_id FROM comments WHERE id=?').get(+req.params.cid) as any;
    if (!c) return reply.code(404).send({ error: 'not found' });
    if (c.user_id !== req.user.id && req.user.role !== 'admin')
      return reply.code(403).send({ error: 'not your comment' });
    // replies stay readable under a "comment deleted" placeholder
    db.prepare("UPDATE comments SET deleted=1,text='' WHERE id=?").run(+req.params.cid);
    db.prepare('DELETE FROM reactions WHERE comment_id=?').run(+req.params.cid);
    return { ok: true };
  });
  app.post('/api/comments/:cid/react', { preHandler: auth() }, async (req: any, reply) => {
    const c = db.prepare('SELECT target,target_id FROM comments WHERE id=? AND deleted=0').get(+req.params.cid) as any;
    const t = c && target(c.target, c.target_id);
    if (!t || !canSee(req.user, t)) return reply.code(404).send({ error: 'not found' });
    const all = db
      .prepare('SELECT id,parent_id,user_id,private FROM comments WHERE target=? AND target_id=?')
      .all(c.target, c.target_id) as CRow[];
    if (!readable(all, req.user.id, t.owner_id).some((x) => x.id === +req.params.cid))
      return reply.code(404).send({ error: 'not found' });
    const p = ReactIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const had = db
      .prepare('SELECT 1 FROM reactions WHERE comment_id=? AND user_id=? AND emoji=?')
      .get(+req.params.cid, req.user.id, p.data.emoji);
    if (had)
      db.prepare('DELETE FROM reactions WHERE comment_id=? AND user_id=? AND emoji=?').run(
        +req.params.cid,
        req.user.id,
        p.data.emoji,
      );
    else
      db.prepare('INSERT INTO reactions(comment_id,user_id,emoji) VALUES(?,?,?)').run(
        +req.params.cid,
        req.user.id,
        p.data.emoji,
      );
    return { on: !had };
  });
  /** Number of comments per target, for the comment buttons. */
  app.get('/api/comments-count/:kind/:id', { preHandler: auth() }, async (req: any) => {
    const t = target(req.params.kind, +req.params.id);
    if (!t) return { n: 0 };
    const all = db
      .prepare('SELECT id,parent_id,user_id,private,deleted FROM comments WHERE target=? AND target_id=?')
      .all(req.params.kind, +req.params.id) as CRow[];
    return { n: readable(all, req.user.id, t.owner_id).filter((c) => !c.deleted).length };
  });

  // ---- notifications ----
  app.get('/api/notifications', { preHandler: auth() }, async (req: any) => {
    const rows = db
      .prepare(
        'SELECT id,kind,text,link,actor,read,created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50',
      )
      .all(req.user.id) as any[];
    return {
      unread: (db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND read=0').get(req.user.id) as any)
        .n,
      items: rows.map((r) => ({ ...r, link: JSON.parse(r.link), read: !!r.read })),
    };
  });
  app.post('/api/notifications/read', { preHandler: auth() }, async (req: any) => {
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).map(Number).filter(Number.isFinite) : null;
    if (ids)
      for (const id of ids) db.prepare('UPDATE notifications SET read=1 WHERE id=? AND user_id=?').run(id, req.user.id);
    else db.prepare('UPDATE notifications SET read=1 WHERE user_id=?').run(req.user.id);
    return { ok: true };
  });

  // ---- trash ----
  app.get('/api/trash', { preHandler: auth() }, async (req: any) => {
    const mine = '(x.owner_id=@uid OR @admin=1)';
    const q = (sql: string) =>
      db.prepare(sql).all({ uid: req.user.id, admin: req.user.role === 'admin' ? 1 : 0 }) as any[];
    const items = [
      ...q(
        `SELECT 'preset' AS kind,x.id,x.name,x.segment,x.deleted_at,u.name AS owner FROM presets x JOIN users u ON u.id=x.owner_id WHERE x.deleted_at IS NOT NULL AND ${mine}`,
      ),
      ...q(
        `SELECT 'batch' AS kind,x.id,x.code || CASE WHEN x.name<>'' THEN ' · ' || x.name ELSE '' END AS name,'batches' AS segment,x.deleted_at,u.name AS owner FROM batches x JOIN users u ON u.id=x.owner_id WHERE x.deleted_at IS NOT NULL AND ${mine}`,
      ),
      ...q(
        `SELECT 'cmp' AS kind,x.id,x.name,'cmp' AS segment,x.deleted_at,u.name AS owner FROM comparisons x JOIN users u ON u.id=x.owner_id WHERE x.deleted_at IS NOT NULL AND ${mine}`,
      ),
      ...q(
        `SELECT 'iv' AS kind,x.id,x.name,'iv' AS segment,x.deleted_at,u.name AS owner FROM iv_sets x JOIN users u ON u.id=x.owner_id WHERE x.deleted_at IS NOT NULL AND ${mine}`,
      ),
    ].sort((a, b) => String(b.deleted_at).localeCompare(String(a.deleted_at)));
    return {
      days: TRASH_DAYS,
      items: items.map((i) => ({
        ...i,
        purge_at: new Date(new Date(i.deleted_at).getTime() + TRASH_DAYS * 864e5).toISOString(),
      })),
    };
  });
  const trashed = (req: any, reply: any) => {
    const k = req.params.kind as TrashKind;
    if (!(k in TABLE)) {
      reply.code(404).send({ error: 'not found' });
      return null;
    }
    const r = db
      .prepare(`SELECT owner_id FROM ${TABLE[k]} WHERE id=? AND deleted_at IS NOT NULL`)
      .get(+req.params.id) as any;
    if (!r) {
      reply.code(404).send({ error: 'not in the trash' });
      return null;
    }
    if (r.owner_id !== req.user.id && req.user.role !== 'admin') {
      reply.code(403).send({ error: 'not yours' });
      return null;
    }
    return k;
  };
  app.post('/api/trash/:kind/:id/restore', { preHandler: auth() }, async (req: any, reply) => {
    const k = trashed(req, reply);
    if (!k) return;
    db.prepare(`UPDATE ${TABLE[k]} SET deleted_at=NULL WHERE id=?`).run(+req.params.id);
    return { ok: true };
  });
  app.delete('/api/trash/:kind/:id', { preHandler: auth() }, async (req: any, reply) => {
    const k = trashed(req, reply);
    if (!k) return;
    purgeOne(k, +req.params.id);
    return { ok: true };
  });
  purgeTrash();
  setInterval(purgeTrash, 6 * 3600 * 1000).unref();
}
