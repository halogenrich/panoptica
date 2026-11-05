import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

/**
 * Web security for every response, and the request checks that do not depend on who is signed in.
 *  - Security headers: a strict Content-Security-Policy (only this app's own scripts; no framing; no plugins), no MIME sniffing,
 *    no referrer to other sites, no camera/microphone/location, and HSTS when the app is reached over HTTPS.
 *  - Cross-site request check: a change (POST/PUT/PATCH/DELETE) is only accepted from a page of this app (Origin header).
 *  - API responses are never cached by the browser or a proxy (they carry lab data).
 */
export const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self' data:",
  "connect-src 'self'", "worker-src 'self' blob:", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function registerSecurity(app: FastifyInstance) {
  app.addHook('onRequest', async (req, reply) => {
    if (!MUTATING.has(req.method) || !req.url.startsWith('/api/')) return;
    const origin = req.headers.origin ?? req.headers.referer;
    if (!origin) return; // non-browser clients (scripts, curl) send neither; browsers always send Origin on these requests
    let host = '';
    try { host = new URL(origin).host; } catch { /* malformed: refused below */ }
    if (!host || host !== req.host) return reply.code(403).send({ error: 'request from another site refused' });
  });
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('content-security-policy', CSP);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'same-origin');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    reply.header('cross-origin-opener-policy', 'same-origin');
    reply.header('cross-origin-resource-policy', 'same-origin');
    if (req.protocol === 'https') reply.header('strict-transport-security', 'max-age=31536000');
    if (req.url.startsWith('/api/') && !reply.getHeader('cache-control')) reply.header('cache-control', 'no-store');
    return payload;
  });
}

/** Sessions are stored as a hash of the cookie value, so a copy of the database (or a backup) cannot be used to sign in. */
export const tokenHash = (t: string) => createHash('sha256').update(t).digest('hex');

/** Simple counter per key (username, address) over a time window: login attempts. */
export class Limiter {
  private m = new Map<string, { n: number; t: number }>();
  constructor(private max: number, private windowMs: number) {}
  blocked(k: string) { const f = this.m.get(k); return !!f && Date.now() - f.t < this.windowMs && f.n >= this.max; }
  hit(k: string) { const f = this.m.get(k), fresh = f && Date.now() - f.t < this.windowMs; this.m.set(k, { n: (fresh ? f!.n : 0) + 1, t: fresh ? f!.t : Date.now() }); }
  clear(k: string) { this.m.delete(k); }
}

/** Passwords: at least 10 characters (a short sentence works well), not a well-known password, not the username or the app's name. */
const COMMON = new Set(`123456789 1234567890 12345678910 0123456789 qwertyuiop qwertyuiop1 1q2w3e4r5t password password1 password12 password123 passw0rd123
  iloveyou12 abc1234567 abcdefghij 1111111111 0000000000 aaaaaaaaaa senha12345 senha123456 minhasenha mudar12345 trocar1234 admin12345 administrator
  welcome123 letmein123 football12 perovskite perovskite1 perovskite123 perovskitelab solarcell1 solarcells unicamp123 unicamp2024 unicamp2025 unicamp2026
  laboratorio laboratory1 changeme123 qwerty1234 qwerty12345 asdfghjkl1 zxcvbnm123 1qaz2wsx3edc`.split(/\s+/).filter(Boolean));
export function weakPassword(pw: string, username = ''): string {
  if (pw.length < 10) return 'password needs at least 10 characters (a short sentence is easy to remember)';
  if (pw.length > 128) return 'password is too long (at most 128 characters)';
  const low = pw.toLowerCase(), u = username.toLowerCase();
  if (COMMON.has(low) || /^(.)\1+$/.test(pw)) return 'this password is too common: choose another one';
  if (u && low.includes(u)) return 'the password must not contain the username';
  if (/^(perovskite ?lab|panoptica)/.test(low) && low.replace(/[^a-z]/g, '').length < 14) return 'choose a password that is not the name of the app';
  return '';
}
