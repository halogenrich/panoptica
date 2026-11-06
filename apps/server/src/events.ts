import type { FastifyInstance } from 'fastify';

/**
 * Live updates. Every signed-in page keeps one Server-Sent Events stream open (GET /api/events). After any accepted change,
 * all pages receive a small message naming what kind of thing changed ("calendar", "batches"…) and reload what they show
 * from the normal, permission-checked endpoints. The message carries no data, so it cannot leak anything.
 * The tab that made the change is named in the message (x-tab header) and ignores it: it already shows the change.
 */
type Client = { send: (s: string) => void };
const clients = new Set<Client>();

/** API area → what pages should reload. Changes to bookings also move batches between Planned, Running and Done. */
const TOPICS: [RegExp, string[]][] = [
  [/^\/api\/(bookings|equipment|schedule|calendar)/, ['calendar', 'batches']],
  [/^\/api\/batches/, ['batches', 'calendar']],
  [/^\/api\/(presets|runs)/, ['presets', 'batches']],
  [/^\/api\/(chemicals|storage|shelves|containers|inventory)/, ['inventory']],
  [/^\/api\/iv/, ['iv', 'comparisons']],
  [/^\/api\/comparisons/, ['comparisons']],
  [/^\/api\/(comments|reactions|notifications)/, ['comments', 'notifications']],
  [/^\/api\/(users|tags|me)/, ['users']],
  [/^\/api\/trash/, ['all']],
];
const QUIET = /^\/api\/(presence|prefs|login|logout|events|updates|backups|audit|fun|settings)/;

export function broadcast(topics: string[], tab = '') {
  const msg = `data: ${JSON.stringify({ topics, tab })}\n\n`;
  for (const c of clients) c.send(msg);
}

export function registerEvents(app: FastifyInstance, auth: (need?: any) => any) {
  app.get('/api/events', { preHandler: auth() }, (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no', // nginx: pass events through at once
      'x-content-type-options': 'nosniff',
    });
    res.write('retry: 3000\n\n');
    const c: Client = { send: (s) => res.write(s) };
    clients.add(c);
    const beat = setInterval(() => res.write(': still here\n\n'), 25_000); // keeps proxies from closing an idle stream
    req.raw.on('close', () => {
      clearInterval(beat);
      clients.delete(c);
    });
  });
  app.addHook('onResponse', async (req: any, reply) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || reply.statusCode >= 400) return;
    const url: string = req.routeOptions?.url ?? req.url;
    if (!url.startsWith('/api/') || QUIET.test(url)) return;
    const topics = TOPICS.find(([r]) => r.test(url))?.[1] ?? ['all'];
    broadcast(topics, String(req.headers['x-tab'] ?? ''));
  });
}
