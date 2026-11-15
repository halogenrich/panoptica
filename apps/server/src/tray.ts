import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { trayDir } from './config.js';
import { isLocal } from './security.js';
import { audit } from './audit.js';
import { backupNow } from './backup.js';
import { checkNow, newer } from './updates.js';

/**
 * The tray icon on the computer that runs PANOPTICA (0.51, Windows; `installer/tray`): a small program started when someone
 * signs in there. It shows whether PANOPTICA is running and offers Check for updates and Make a backup, which need no sign-in:
 * whoever sits at the server computer may do them. They are asked here with a token PANOPTICA writes next to the tray program
 * at each start (tray/token: readable by the people of that computer, never sent anywhere else), and only from that computer.
 * Installing an update stays an admin's action in the app.
 */
let token = '';

export function registerTray(app: FastifyInstance, version: string) {
  const dir = trayDir();
  if (!dir) return;
  token = randomBytes(24).toString('hex');
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'token'), token);
  } catch (e) {
    app.log.warn(`the tray icon cannot ask for backups and updates: ${(e as Error).message}`);
    token = '';
    return;
  }
  const ok = (req: any) => {
    const t = Buffer.from(String(req.headers['x-tray-token'] ?? '')),
      k = Buffer.from(token);
    return isLocal(req) && !!token && t.length === k.length && timingSafeEqual(t, k);
  };
  const gate = async (req: any, reply: any) => {
    if (!ok(req)) return reply.code(403).send({ error: 'only the tray icon on the computer that runs PANOPTICA' });
  };
  app.post('/api/tray/backup', { preHandler: gate }, async (_req, reply) => {
    try {
      const f = await backupNow('manual');
      audit({
        username: 'server computer',
        action: 'Made a backup from the tray icon on the server computer',
        target: f.name,
      });
      return { name: f.name, size: f.size };
    } catch (e) {
      return reply.code(500).send({ error: (e as Error).message });
    }
  });
  app.post('/api/tray/updates', { preHandler: gate }, async () => {
    const st = await checkNow(version);
    audit({ username: 'server computer', action: 'Checked for updates from the tray icon on the server computer' });
    return {
      current: version,
      latest: st.latest?.version ?? null,
      available: !!st.latest && newer(st.latest.version, version),
      error:
        st.error === 'fetch failed'
          ? 'GitHub could not be reached: is this computer on the internet?'
          : (st.error ?? ''),
    };
  });
}
