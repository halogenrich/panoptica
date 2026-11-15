// The builder's page (0.50), for PANOPTICA staff only: `npm run builder` opens it in the browser of the computer it runs on.
// A form makes a lab's licence and install sheet (the same code as the command line, licence.mjs), and a folder that the
// person chooses keeps every licence issued, so a lab that lost its file gets the same one again and a lab that upgrades
// gets a new one under the same lab id.
//
//   node tools/builder/ui.mjs [--data folder] [--port N] [--no-open] [--pub file]
//
// Nothing is hosted: it answers only on 127.0.0.1, only to its own page (Host and Origin are checked, so no other site open
// in the browser can use it). The private key is chosen in the form for each licence, sent to this process, used to sign and
// let go: it is never written, and neither is where it is. The only thing remembered between runs is the list's folder
// (`.panoptica-builder.json` in the home folder; `--data` skips it).
//   --pub    the public key the licences are checked against (tests); release.pub otherwise
import { execFile, spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeLicence, moduleName, presentModules, problem, TIERS, KEY_FOREIGN, KEY_UNREADABLE } from './licence.mjs';
import { isList, keep, kept, labs, openFolder } from './store.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const args = process.argv.slice(2),
  opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
  present = presentModules(root),
  pubPem = readFileSync(opt('--pub') ?? join(root, 'release.pub'), 'utf8');

// ---- the list's folder: from --data, else the one chosen last time
const settingsFile = process.env.PANOPTICA_BUILDER_SETTINGS ?? join(homedir(), '.panoptica-builder.json');
let folder = null;
try {
  if (opt('--data')) folder = openFolder(opt('--data'), root);
  else {
    const last = JSON.parse(readFileSync(settingsFile, 'utf8')).folder;
    if (isList(last)) folder = last;
  }
} catch (e) {
  if (opt('--data')) {
    console.error('builder: ' + e.message);
    process.exit(1);
  }
}
const remember = () => {
  if (opt('--data')) return;
  try {
    writeFileSync(settingsFile, JSON.stringify({ folder }) + '\n');
  } catch {
    /* asked again next time */
  }
};

// ---- the system's own folder chooser, where there is one (the page cannot learn a folder's path by itself)
const run = (cmd, a) =>
  new Promise((done) => execFile(cmd, a, { windowsHide: true }, (err, out) => done(err ? '' : String(out).trim())));
const PROMPT = 'Folder for the list of licences';
const choosers = {
  darwin: () => run('osascript', ['-e', `POSIX path of (choose folder with prompt "${PROMPT}")`]),
  win32: () =>
    run('powershell', [
      '-NoProfile',
      '-STA',
      '-Command',
      `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = '${PROMPT}'; $d.ShowNewFolderButton = $true; if ($d.ShowDialog() -eq 'OK') { [Console]::OutputEncoding = [Text.Encoding]::UTF8; Write-Output $d.SelectedPath }`,
    ]),
  linux: () => run('zenity', ['--file-selection', '--directory', '--title', PROMPT]),
};
const canBrowse =
  process.platform === 'linux'
    ? !!process.env.DISPLAY && !!(await run('which', ['zenity']))
    : process.platform in choosers;

// ---- the page: the app's own styles and components (Dialog, Seg, box-form), bundled when the builder starts
let js, css;
try {
  const { build } = await import('esbuild');
  const r = await build({
    entryPoints: [join(root, 'tools/builder/web/main.tsx')],
    bundle: true,
    write: false,
    outdir: 'out',
    entryNames: 'app',
    format: 'esm',
    jsx: 'automatic',
    minify: true,
    alias: { '@web': join(root, 'apps/web/src') },
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });
  js = r.outputFiles.find((f) => f.path.endsWith('.js')).text;
  css = r.outputFiles.find((f) => f.path.endsWith('.css')).text;
} catch (e) {
  console.error('builder: the page could not be built (run `npm install` in the repository first)\n' + e.message);
  process.exit(1);
}
const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>PANOPTICA · Licence builder</title>
    <link rel="stylesheet" href="/app.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/app.js"></script>
  </body>
</html>
`;

// ---- the install sheet as a page to print: the sheet is Markdown this builder wrote itself (licence.mjs), so only what it
// uses is read: titles, numbered and plain lists, bold and code
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
function sheetPage(md) {
  const out = [];
  let list = '', // 'ol' | 'ul' | ''
    item = null, // paragraphs of the list item being read
    para = [];
  const endPara = () => {
    if (!para.length) return;
    (item ?? out).push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const endItem = () => {
    endPara();
    if (item) out.push(`<li>${item.join('')}</li>`);
    item = null;
  };
  const endList = () => {
    endItem();
    if (list) out.push(`</${list}>`);
    list = '';
  };
  for (const line of md.split('\n')) {
    const h = /^(#{1,2}) (.*)$/.exec(line),
      li = /^(\d+\.|-) (.*)$/.exec(line);
    if (h) {
      endList();
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
    } else if (li) {
      const kind = li[1] === '-' ? 'ul' : 'ol';
      if (list !== kind) {
        endList();
        out.push(`<${kind}>`);
        list = kind;
      } else endItem();
      item = [];
      para = [li[2]];
    } else if (!line.trim()) endPara();
    else if (/^\s/.test(line) && list) para.push(line.trim());
    else {
      if (list && !para.length) endList(); // an unindented line after a blank one leaves the list
      para.push(line.trim());
    }
  }
  endList();
  endPara();
  const title = /^# (.*)$/m.exec(md)?.[1] ?? 'Install sheet';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <link rel="stylesheet" href="/app.css" />
  </head>
  <body class="sheet-page">
    <div class="sheet-bar"><button class="btn" id="print">Print sheet</button></div>
    <article class="sheet">${out.join('\n')}</article>
    <script type="module" src="/sheet.js"></script>
  </body>
</html>
`;
}

// ---- answers
const state = () => {
  if (folder && !isList(folder)) folder = null; // moved or deleted while the builder ran
  return {
    version,
    folder,
    canBrowse,
    modules: present.map((id) => ({ id, name: moduleName(id) })),
    tiers: TIERS,
    labs: folder ? labs(folder) : [],
  };
};
const send = (res, status, body, type = 'application/json; charset=utf-8', extra = {}) => {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy':
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
    ...extra,
  });
  res.end(data);
};
const refuse = (res, status, error) => send(res, status, { error });
const bodyOf = (req) =>
  new Promise((ok, no) => {
    let s = '';
    req.setEncoding('utf8');
    req.on('data', (d) => {
      s += d;
      if (s.length > 65536) no(new Error('too long'));
    });
    req.on('end', () => {
      try {
        ok(s ? JSON.parse(s) : {});
      } catch {
        no(new Error('not JSON'));
      }
    });
    req.on('error', no);
  });
const text = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

let port = 0;
const server = createServer(async (req, res) => {
  try {
    // only its own page, on this computer: a page of another site cannot reach it under another name (DNS rebinding) or
    // post to it (Origin)
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!hosts.includes(req.headers.host ?? '')) return refuse(res, 403, 'The builder answers only on this computer.');
    const url = new URL(req.url, 'http://x'),
      path = url.pathname;
    if (req.method !== 'GET') {
      if (
        !hosts.some((h) => req.headers.origin === 'http://' + h) ||
        !/^application\/json/.test(req.headers['content-type'] ?? '')
      )
        return refuse(res, 403, 'The builder answers only to its own page.');
    }

    if (req.method === 'GET' && path === '/') return send(res, 200, html, 'text/html; charset=utf-8');
    if (req.method === 'GET' && path === '/app.js') return send(res, 200, js, 'text/javascript; charset=utf-8');
    if (req.method === 'GET' && path === '/sheet.js')
      return send(
        res,
        200,
        "document.getElementById('print').onclick = () => print();\n",
        'text/javascript; charset=utf-8',
      );
    if (req.method === 'GET' && path === '/app.css') return send(res, 200, css, 'text/css; charset=utf-8');
    if (req.method === 'GET' && path === '/api/state') return send(res, 200, state());

    if (req.method === 'POST' && path === '/api/folder/browse') {
      await bodyOf(req);
      if (!canBrowse) return refuse(res, 501, 'Type the folder’s path.');
      return send(res, 200, { path: await choosers[process.platform]() }); // '' when the chooser was closed
    }
    if (req.method === 'POST' && path === '/api/folder') {
      const b = await bodyOf(req);
      try {
        folder = openFolder(b.path, root);
      } catch (e) {
        return refuse(res, 400, e.message);
      }
      remember();
      return send(res, 200, state());
    }

    if (req.method === 'POST' && path === '/api/licences') {
      if (!folder || !isList(folder)) return refuse(res, 409, 'Choose the folder for the list of licences first.');
      const b = await bodyOf(req);
      const tier = Number(b.tier),
        ask = {
          lab: text(b.lab),
          acronym: text(b.acronym),
          modules: Array.isArray(b.modules) ? [...new Set(b.modules.map(String))] : [],
          tier,
          users: tier === 3 ? Number(b.users) : TIERS[tier],
        };
      const wrong = problem(ask, present);
      if (wrong) return refuse(res, 400, wrong);
      // a new licence for a lab in the list keeps its lab id and has no setup code (that lab is set up already)
      let labId;
      if (b.labId !== undefined) {
        labId = labs(folder).find((l) => l.labId === b.labId)?.labId;
        if (!labId) return refuse(res, 404, 'That lab is not in the list.');
      }
      if (typeof b.key !== 'string' || !b.key.trim()) return refuse(res, 400, 'Choose the signing key file.');
      let made;
      try {
        made = makeLicence({ ...ask, keyPem: b.key, pubPem, labId, setup: !labId, version });
      } catch (e) {
        return refuse(
          res,
          400,
          e.message === KEY_FOREIGN
            ? 'That key is not PANOPTICA’s signing key. Nothing was made.'
            : e.message === KEY_UNREADABLE
              ? 'That file is not a signing key (an Ed25519 private key in PEM). Nothing was made.'
              : e.message,
        );
      }
      keep(folder, made);
      return send(res, 200, { id: made.id, labId: made.labId, code: made.code, ...state() });
    }

    const file = /^\/api\/licences\/(L-\d{6}-[0-9a-f]{4})\/(licence\.json|install-sheet\.md|sheet)$/.exec(path);
    if (req.method === 'GET' && file) {
      const data = folder && kept(folder, file[1], file[2] === 'sheet' ? 'install-sheet.md' : file[2]);
      if (!data) return refuse(res, 404, 'That file is not in the list’s folder.');
      if (file[2] === 'sheet') return send(res, 200, sheetPage(data), 'text/html; charset=utf-8');
      return send(res, 200, data, file[2].endsWith('.json') ? 'application/json' : 'text/markdown; charset=utf-8', {
        'content-disposition': `attachment; filename="${file[2]}"`,
      });
    }
    refuse(res, 404, 'Not found.');
  } catch (e) {
    refuse(res, 400, e.message === 'too long' ? 'That is too long.' : 'That could not be read.');
  }
});

server.listen(Number(opt('--port') ?? 0), '127.0.0.1', () => {
  port = server.address().port;
  const url = `http://127.0.0.1:${port}/`;
  console.log(`PANOPTICA licence builder: ${url}\nClose this window (or press Ctrl+C) to stop it.`);
  if (args.includes('--no-open')) return;
  const [cmd, a] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  spawn(cmd, a, { stdio: 'ignore', detached: true })
    .on('error', () => {})
    .unref();
});
