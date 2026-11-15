import { X509Certificate } from 'node:crypto';
import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttp, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { createServer as createTcp, type AddressInfo } from 'node:net';
import { hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { connect, createServer as createTls, type SecureContextOptions } from 'node:tls';
import type { FastifyInstance } from 'fastify';
import { NetworkIn } from '@psc/schema';
import { addressProblem, cleanAddress, defaultPort, isIp, labUrl, type NetOpen } from '@psc/core';
import { db } from './db.js';
import { CONFIG_DIR, readConfig, trayDir, writeConfig } from './config.js';
import { isLocal } from './security.js';
import { notify } from './social.js';

/**
 * Network settings (0.51): who can open PANOPTICA (the computer that runs it, or the network), the lab's address (the name IT
 * gave the computer: shown on the sign-in screen and used in every copied link), the port, and HTTPS with a certificate from
 * IT. They are this computer's, so they live in config/network.json, not in the database: a backup restored on another
 * computer does not bring another computer's port or certificate.
 *
 * Until they are saved, PANOPTICA listens as it was started (PORT and HOST, 3000 and this computer alone unless the start
 * script says otherwise): installs made before 0.51 and manual installs keep port 3000 until an admin changes it. PANOPTICA
 * Setup writes the file for a new install: the network, port 80, so the first setup can be done from another computer with
 * the setup code, and the Network step of the first setup then decides.
 *
 * A change applies at once, without stopping PANOPTICA: the new address is listened on first, then the old one is closed. If
 * the certificate is not right (its key does not match, it expired, it does not cover the lab's address) or the port cannot
 * be used, the change is refused and the settings stay as they were. Settings are changed only on the computer that runs
 * PANOPTICA: the certificate's key never travels on the network, and nobody locks themselves out from elsewhere.
 *
 * With HTTPS, port 80 answers too and sends people to the HTTPS address. On an install made by Setup (Windows), the firewall
 * rule follows the setting. Admins are told 30 days, and again 7 days, before the certificate expires.
 */
type Saved = {
  open?: NetOpen;
  address?: string;
  port?: number;
  https?: boolean;
  /** the certificate kept in config/: PEM (tls-cert.pem, tls-key.pem) or a PFX file (tls-cert.pfx.b64) with its password */
  cert?: 'pem' | 'pfx';
  pass?: string;
};
export type Net = { open: NetOpen; host: string; address: string; port: number; https: boolean };
type Cert = { subject: string; names: string[]; from: string; to: string; fp: string };
type Handler = (req: IncomingMessage, res: ServerResponse) => void;
type Input = ReturnType<typeof NetworkIn.parse>;

const FILES = { pem: 'tls-cert.pem', key: 'tls-key.pem', pfx: 'tls-cert.pfx.b64' } as const;
const saved = () => readConfig<Saved>('network.json', {});
const envTls = () => (process.env.TLS_CERT && process.env.TLS_KEY ? true : false);
const wide = (host: string) => host === '0.0.0.0' || host === '::';

/** The settings in force: what was saved, else how PANOPTICA was started. */
export function settings(): Net {
  const s = saved(),
    envHost = process.env.HOST || '127.0.0.1',
    open = s.open ?? (wide(envHost) ? 'network' : 'computer');
  return {
    open,
    host: s.open ? (s.open === 'network' ? '0.0.0.0' : '127.0.0.1') : envHost,
    address: s.address ?? '',
    port: s.port ?? +(process.env.PORT || 3000),
    https: s.https ?? envTls(),
  };
}

/** The certificate and key to serve with: the ones kept in config/, or the files the start script names (TLS_CERT, TLS_KEY). */
function material(s: Saved): SecureContextOptions {
  if (s.https === undefined && envTls())
    return { cert: readFileSync(process.env.TLS_CERT!), key: readFileSync(process.env.TLS_KEY!) };
  if (s.cert === 'pfx')
    return {
      pfx: Buffer.from(readFileSync(join(CONFIG_DIR, FILES.pfx), 'utf8'), 'base64'),
      passphrase: s.pass ?? '',
    };
  return { cert: readFileSync(join(CONFIG_DIR, FILES.pem)), key: readFileSync(join(CONFIG_DIR, FILES.key)) };
}

/**
 * The certificate a server with this certificate and key presents, read the way a browser gets it: a connection on this
 * computer. It fails when the files cannot be read, the key does not belong to the certificate or the password is wrong, which
 * is everything the real server would fail on.
 */
function leaf(opts: SecureContextOptions): Promise<X509Certificate> {
  return new Promise((res, rej) => {
    let srv: ReturnType<typeof createTls>;
    try {
      srv = createTls(opts);
    } catch (e) {
      return rej(e);
    }
    const done = (x?: X509Certificate, e?: unknown) => {
      clearTimeout(t);
      srv.close();
      if (x) res(x);
      else rej(e ?? new Error('no certificate'));
    };
    const t = setTimeout(() => done(undefined, new Error('the certificate could not be read in time')), 8000);
    srv.on('error', (e) => done(undefined, e));
    srv.on('tlsClientError', () => {});
    srv.listen(0, '127.0.0.1', () => {
      const c = connect(
        { host: '127.0.0.1', port: (srv.address() as AddressInfo).port, rejectUnauthorized: false },
        () => {
          const x = c.getPeerX509Certificate();
          c.destroy();
          done(x);
        },
      );
      c.on('error', (e) => done(undefined, e));
    });
  });
}
/** Why a certificate and key could not be used, in words for the person who chose the files. */
function unreadable(e: unknown): string {
  const m = String((e as Error)?.message ?? e);
  if (/mac verify failure|bad decrypt|wrong password|invalid password|pkcs12/i.test(m))
    return 'the certificate file could not be opened with this password';
  if (/key values mismatch|key type mismatch|x509.*mismatch/i.test(m))
    return 'the key file does not belong to this certificate';
  if (/ENOENT/.test(m))
    return 'the certificate kept on this computer is missing: choose the certificate and its key again';
  return 'the certificate or its key could not be read: they must be PEM files (-----BEGIN…), or one PFX file';
}
const dmy = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
const describe = (x: X509Certificate): Cert => {
  const alt = (x.subjectAltName ?? '')
    .split(',')
    .map((n) => n.trim().replace(/^(DNS|IP Address):/, ''))
    .filter(Boolean);
  const cn = /(?:^|\n)CN=([^\n]+)/.exec(x.subject)?.[1] ?? '';
  return {
    subject: cn || alt[0] || '',
    names: alt.length ? alt : cn ? [cn] : [],
    from: new Date(x.validFrom).toISOString(),
    to: new Date(x.validTo).toISOString(),
    fp: x.fingerprint256,
  };
};
/** What is wrong with a certificate for this address, or '' when browsers will accept it there. */
function certProblem(x: X509Certificate, address: string): string {
  const c = describe(x),
    now = Date.now();
  if (now < new Date(c.from).getTime()) return `the certificate is not valid before ${dmy(new Date(c.from))}`;
  if (now > new Date(c.to).getTime()) return `the certificate expired on ${dmy(new Date(c.to))}`;
  if (!(isIp(address) ? x.checkIP(address) : x.checkHost(address)))
    return `the certificate is for ${c.names.join(', ') || 'another name'}, not for ${address}`;
  return '';
}
const daysLeft = (c: Cert) => Math.ceil((new Date(c.to).getTime() - Date.now()) / 864e5);

// ---- listening
type Live = {
  net: Net;
  servers: Server[];
  /** the port and scheme in use: the settings', unless that could not be done (see `note`) */
  port: number;
  https: boolean;
  cert: Cert | null;
  /** port 80 sends people on to HTTPS */
  redirect: boolean;
  /** why PANOPTICA is not listening as its settings say, or '' */
  note: string;
};
let handler: Handler = (_q, r) => r.writeHead(503).end(),
  version = '',
  log: (m: string) => void = () => {},
  live: Live = {
    net: { open: 'computer', host: '127.0.0.1', address: '', port: 3000, https: false },
    servers: [],
    port: 3000,
    https: false,
    cert: null,
    redirect: false,
    note: '',
  };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Listens, waiting a moment when the port is one this process just let go. */
async function listenOn(s: Server, port: number, host: string, tries = 1) {
  for (let i = 1; ; i++)
    try {
      await new Promise<void>((res, rej) => {
        const fail = (e: Error) => rej(e);
        s.once('error', fail);
        s.listen(port, host, () => {
          s.off('error', fail);
          res();
        });
      });
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE' || i >= tries) throw e;
      await sleep(150);
    }
}
const portWords = (e: unknown, port: number) =>
  (e as NodeJS.ErrnoException).code === 'EADDRINUSE'
    ? `port ${port} is used by another program on this computer`
    : (e as NodeJS.ErrnoException).code === 'EACCES'
      ? `this computer does not let PANOPTICA use port ${port} (ports below 1024 need an administrator)`
      : `port ${port} cannot be used (${(e as Error).message})`;

/** Starts listening as `net` says. At the first start a port that cannot be used falls back to 3000, so PANOPTICA still opens. */
async function up(net: Net, tls: SecureContextOptions | null, cert: Cert | null, first: boolean, own = false) {
  const make = () => {
    const s = tls ? createHttps(tls, (q, r) => handler(q, r)) : createHttp((q, r) => handler(q, r));
    // a request that is not HTTP gets a short answer, as Fastify's own server gives
    s.on('clientError', (_e, socket) => {
      if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      else socket.destroy();
    });
    s.keepAliveTimeout = 72_000;
    return s as Server;
  };
  let main = make(),
    port = net.port,
    note = '';
  try {
    await listenOn(main, port, net.host, own ? 20 : 1);
  } catch (e) {
    if (!first || port === 3000) throw new Error(portWords(e, port), { cause: e });
    note = `${portWords(e, port)}, so PANOPTICA is on port 3000`.replace(/^./, (c) => c.toUpperCase());
    main = make();
    port = 3000;
    await listenOn(main, port, net.host);
  }
  const servers = [main];
  // with HTTPS, port 80 sends people on to it (when nothing else has that port)
  let redirect = false;
  if (tls && port !== 80) {
    const r = createHttp((q, res) => {
      const name = live.net.address || String(q.headers.host ?? '').replace(/:\d+$/, '');
      res.writeHead(301, { location: `https://${name}${port === 443 ? '' : ':' + port}${q.url ?? '/'}` }).end();
    });
    try {
      await listenOn(r, 80, net.host, own ? 20 : 1);
      servers.push(r);
      redirect = true;
    } catch {
      /* port 80 is someone else's: people type https:// */
    }
  }
  live = { net, servers, port, https: !!tls, cert, redirect, note: note || live.note };
  if (!note && !first) live.note = '';
  status();
  firewall();
  certWatch();
}

/** For the tray icon and Setup, on an install made by Setup: where PANOPTICA answers on this computer (tray/server.json). */
function status() {
  const d = trayDir();
  if (!d) return;
  const f = join(d, 'server.json');
  try {
    if (!existsSync(d)) return;
    writeFileSync(
      f,
      JSON.stringify({
        pid: process.pid,
        port: live.port,
        https: live.https,
        version,
        local: localUrl(),
        url: publicUrl(),
        at: new Date().toISOString(),
      }),
    );
  } catch (e) {
    log(`could not write ${f}: ${(e as Error).message}`);
  }
}

/**
 * Windows, on an install made by Setup (it runs as the system): the firewall rule lets the network reach the port in use, or
 * is removed when only this computer may open PANOPTICA. Tests record the commands instead of running them.
 */
function firewall() {
  const test = process.env.PANOPTICA_TEST === '1' ? process.env.PANOPTICA_TEST_FIREWALL : '',
    rule = process.env.PANOPTICA_TASK || 'PANOPTICA';
  if (!test && !(process.platform === 'win32' && process.env.PANOPTICA_TASK)) return;
  const ports = live.net.open === 'network' ? [live.port, ...(live.redirect ? [80] : [])] : [],
    del = ['advfirewall', 'firewall', 'delete', 'rule', `name=${rule}`],
    add = [
      'advfirewall',
      'firewall',
      'add',
      'rule',
      `name=${rule}`,
      'dir=in',
      'action=allow',
      'protocol=TCP',
      `localport=${ports.join(',')}`,
    ];
  if (test)
    return appendFileSync(test, [del, ...(ports.length ? [add] : [])].map((c) => c.join(' ')).join('\n') + '\n');
  execFile('netsh', del, () => {
    if (ports.length)
      execFile('netsh', add, (e) =>
        log(e ? `firewall rule not added: ${e.message}` : `firewall: the network may open port ${ports.join(' and ')}`),
      );
    else log('firewall: only this computer may open PANOPTICA');
  });
}

/** Tells the admins once when the certificate has 30 days left, once at 7, and once when it has expired. */
function certWatch() {
  const c = live.cert;
  if (!c || !live.https) return;
  const d = daysLeft(c),
    level = d <= 0 ? 'expired' : d <= 7 ? '7' : d <= 30 ? '30' : '';
  if (!level) return;
  const key = `${c.fp}:${level}`,
    was = (db.prepare("SELECT value FROM meta WHERE key='cert_warned'").get() as { value: string } | undefined)?.value;
  if (was === key) return;
  db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('cert_warned',?)").run(key);
  const on = dmy(new Date(c.to)),
    fix = 'Ask IT for a new one and add it in Admin settings › Network, on the computer that runs PANOPTICA.';
  notify(
    (db.prepare("SELECT id FROM users WHERE role='admin' AND active=1 AND deleted=0").all() as { id: number }[]).map(
      (a) => a.id,
    ),
    'certificate',
    level === 'expired'
      ? `The HTTPS certificate expired on ${on}: browsers now warn everyone who opens PANOPTICA. ${fix}`
      : `The HTTPS certificate expires on ${on} (${d} ${d === 1 ? 'day' : 'days'} left). ${fix}`,
    { view: 'network', id: 0 },
  );
}

/** Starts PANOPTICA's listeners with the settings in force. `routing` is the app (Fastify's router). */
export async function startNetwork(routing: Handler, v: string, logger: (m: string) => void) {
  handler = routing;
  version = v;
  log = logger;
  const net = settings();
  let tls: SecureContextOptions | null = null,
    cert: Cert | null = null,
    note = '';
  if (net.https)
    try {
      tls = material(saved());
      cert = describe(await leaf(tls));
    } catch (e) {
      // a certificate that cannot be read must not keep the lab out: PANOPTICA answers without it, and says so
      tls = null;
      note = `HTTPS is off: ${unreadable(e)}`;
    }
  live.note = note;
  await up(net, tls, cert, true);
  setInterval(certWatch, 12 * 3600e3).unref();
  return live;
}
/** The port PANOPTICA answers on, and whether with HTTPS. */
export const listening = () => ({ port: live.port, https: live.https, open: live.net.open, note: live.note });
/** The lab's address as people open it ('' when the lab has not given one). */
export const publicUrl = () => labUrl({ address: live.net.address, port: live.port, https: live.https });
/** Where this computer itself opens PANOPTICA. */
export const localUrl = () =>
  // the certificate's name, when the network reaches it (this computer too); with this computer alone, localhost
  live.https && live.net.address && live.net.open === 'network'
    ? publicUrl()
    : `${live.https ? 'https' : 'http'}://localhost${live.port === defaultPort(live.https) ? '' : ':' + live.port}`;

// ---- changing the settings
type Plan = {
  saved: Saved;
  files: Partial<Record<keyof typeof FILES, string>>;
  net: Net;
  tls: SecureContextOptions | null;
  cert: Cert | null;
};

/** Checks new settings without applying them: the plan to apply, or what is wrong, in words. */
export async function planNetwork(input: Input): Promise<{ ok: true; plan: Plan } | { ok: false; error: string }> {
  const fail = (error: string) => ({ ok: false as const, error }),
    cur = saved(),
    now = settings();
  const address = cleanAddress(input.address),
    bad = addressProblem(address);
  if (bad) return fail(bad);
  const https = input.https,
    port = input.port ?? defaultPort(https),
    // the same choice keeps the way it listens now (a start script may have asked for IPv6 too)
    host = input.open === now.open ? now.host : input.open === 'network' ? '0.0.0.0' : '127.0.0.1';
  const next: Saved = { open: input.open, address, port, https };
  const files: Plan['files'] = {};
  let tls: SecureContextOptions | null = null,
    cert: Cert | null = null;
  if (https) {
    if (!address) return fail('HTTPS needs the lab’s address: the certificate is made for that name');
    if (input.cert && 'pem' in input.cert) {
      tls = { cert: input.cert.pem, key: input.cert.key };
      files.pem = input.cert.pem;
      files.key = input.cert.key;
      next.cert = 'pem';
    } else if (input.cert) {
      tls = { pfx: Buffer.from(input.cert.pfx, 'base64'), passphrase: input.cert.pass };
      files.pfx = input.cert.pfx;
      next.cert = 'pfx';
      next.pass = input.cert.pass;
    } else if (cur.cert || (cur.https === undefined && envTls())) {
      next.cert = cur.cert;
      next.pass = cur.pass;
      if (!cur.cert) next.https = undefined; // still the start script's files
      try {
        tls = material(cur);
      } catch (e) {
        return fail(unreadable(e));
      }
    } else return fail('choose the certificate file and its key');
    let x: X509Certificate;
    try {
      x = await leaf(tls);
    } catch (e) {
      return fail(unreadable(e));
    }
    const wrong = certProblem(x, address);
    if (wrong) return fail(wrong);
    cert = describe(x);
  } else if (cur.cert) {
    // the certificate stays on file, for turning HTTPS on again
    next.cert = cur.cert;
    next.pass = cur.pass;
  }
  // a port PANOPTICA does not hold yet must be free
  const mine = live.servers.length && host === live.net.host && (port === live.port || (live.redirect && port === 80));
  if (!mine) {
    const probe = createTcp();
    try {
      await listenOn(probe as unknown as Server, port, host);
    } catch (e) {
      return fail(portWords(e, port));
    } finally {
      await new Promise((r) => probe.close(() => r(null)));
    }
  }
  return { ok: true, plan: { saved: next, files, net: { open: input.open, host, address, port, https }, tls, cert } };
}

/**
 * Applies checked settings: saves them and listens again. The connections already open stay a moment (the answer to this
 * very request travels on one), then close. If listening fails after all, the old settings come back.
 */
export async function applyNetwork(p: Plan) {
  const before = {
    saved: saved(),
    had: existsSync(join(CONFIG_DIR, 'network.json')),
    files: Object.fromEntries(
      Object.values(FILES).map((f) => [
        f,
        existsSync(join(CONFIG_DIR, f)) ? readFileSync(join(CONFIG_DIR, f), 'utf8') : null,
      ]),
    ),
    live,
  };
  const write = () => {
    writeConfig('network.json', p.saved);
    for (const [k, v] of Object.entries(p.files)) writeConfig(FILES[k as keyof typeof FILES], v);
  };
  const same =
    p.net.port === live.port &&
    p.net.host === live.net.host &&
    p.net.https === live.https &&
    (p.cert?.fp ?? '') === (live.cert?.fp ?? '') &&
    !Object.keys(p.files).length;
  write();
  if (same) {
    // only who it is for or its address changed: nothing to listen on again
    live = { ...live, net: p.net, note: '' };
    status();
    firewall();
    return;
  }
  const old = live.servers;
  old.forEach((s) => s.close());
  try {
    await up(p.net, p.tls, p.cert, false, true);
  } catch (e) {
    // back to how it was
    if (before.had) writeConfig('network.json', before.saved);
    else rmSync(join(CONFIG_DIR, 'network.json'), { force: true });
    for (const [f, text] of Object.entries(before.files))
      if (text === null) rmSync(join(CONFIG_DIR, f), { force: true });
      else writeConfig(f, text);
    const b = before.live;
    let tls: SecureContextOptions | null = null;
    try {
      tls = b.https ? material(before.saved) : null;
    } catch {
      /* it listened without HTTPS then, too */
    }
    await up({ ...b.net, port: b.port }, tls, b.cert, false, true);
    throw e;
  } finally {
    setTimeout(() => old.forEach((s) => s.closeAllConnections()), 2500).unref();
  }
  log(`network settings changed: ${p.net.open === 'network' ? 'the network' : 'this computer'}, ${localUrl()}`);
}

export function registerNetwork(
  app: FastifyInstance,
  auth: (need?: any) => any,
  bad: (reply: any, p: any) => any,
  setupNeeded: () => boolean,
) {
  const view = (req: any) => {
    const s = settings();
    return {
      // for the phone invitation, as before 0.51
      lan: wide(live.net.host),
      port: live.port,
      host: hostname(),
      addresses: Object.entries(networkInterfaces()).flatMap(([name, list]) =>
        (list ?? [])
          .filter((a) => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'))
          .map((a) => ({ name, address: a.address })),
      ),
      // the settings (0.51)
      open: live.net.open,
      address: live.net.address,
      https: live.https,
      /** the lab's address as people open it, '' without one; and where this computer opens PANOPTICA */
      url: publicUrl(),
      local: localUrl(),
      /** what the settings ask for, when PANOPTICA could not do it (see `note`) */
      wanted: { port: s.port, https: s.https },
      note: live.note,
      redirect: live.redirect,
      certificate: live.cert && {
        subject: live.cert.subject,
        names: live.cert.names,
        to: live.cert.to,
        days: daysLeft(live.cert),
      },
      /** a certificate is on file (HTTPS can be turned on again without choosing it) */
      hasCert: !!saved().cert || envTls(),
      /** the settings are changed on the computer that runs PANOPTICA */
      here: isLocal(req),
      /** an install made by Setup: the firewall rule follows the setting */
      firewall: process.platform === 'win32' && !!process.env.PANOPTICA_TASK,
    };
  };
  app.get('/api/network', { preHandler: auth() }, async (req) => view(req));
  /** On this computer only; an admin, or whoever does the first setup here. */
  const here = async (req: any, reply: any) => {
    if (!isLocal(req))
      return reply.code(403).send({ error: 'network settings are changed on the computer that runs PANOPTICA' });
    if (!setupNeeded()) return auth(true)(req, reply);
  };
  const body = { preHandler: here, bodyLimit: 1024 * 1024 };
  /** Checks settings and changes nothing: the first setup asks before going on, so a problem shows at the Network step. */
  app.post('/api/network/check', body, async (req: any, reply) => {
    const p = NetworkIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const r = await planNetwork(p.data);
    if (!r.ok) return reply.code(400).send({ error: r.error });
    const { net, cert } = r.plan;
    return {
      ok: true,
      url: labUrl(net),
      certificate: cert && { subject: cert.subject, names: cert.names, to: cert.to, days: daysLeft(cert) },
    };
  });
  app.put('/api/network', body, async (req: any, reply) => {
    if (setupNeeded()) return reply.code(409).send({ error: 'finish the first setup first' });
    const p = NetworkIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const r = await planNetwork(p.data);
    if (!r.ok) return reply.code(400).send({ error: r.error });
    try {
      await applyNetwork(r.plan);
    } catch (e) {
      return reply.code(400).send({ error: `${(e as Error).message}; the settings stay as they were` });
    }
    return view(req);
  });
}
