// Diagnostic for CI on Windows: which ways of opening a separate window for a batch file work from a Node server.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const dir = join(tmpdir(), 'probe dir'); // a space, like many Windows paths
mkdirSync(join(dir, 'updates'), { recursive: true });
const bat = join(dir, 'updates', 'run-probe.bat');
writeFileSync(
  bat,
  [
    '@echo off',
    'setlocal enabledelayedexpansion',
    'set "R=%PSC_ROOT%"',
    'cd /d "%R%"',
    '>>"%~2" echo ran args=[%~1] root=[%CD%]',
    'exit /b 0',
    '',
  ].join('\r\n'),
);
const env = { ...process.env, PSC_ROOT: dir };
const v = {
  A_detached_verbatim: (m) =>
    spawn('cmd.exe', ['/c', 'start', '"t"', `"${bat}"`, '"a b"', `"${m}"`], {
      cwd: dir,
      env,
      detached: true,
      stdio: 'ignore',
      windowsVerbatimArguments: true,
    }),
  B_attached_verbatim: (m) =>
    spawn('cmd.exe', ['/c', 'start', '"t"', `"${bat}"`, '"a b"', `"${m}"`], {
      cwd: dir,
      env,
      stdio: 'ignore',
      windowsVerbatimArguments: true,
    }),
  C_detached_nested_cmd: (m) =>
    spawn('cmd.exe', ['/c', 'start', '"t"', 'cmd', '/c', `""${bat}" "a b" "${m}""`], {
      cwd: dir,
      env,
      detached: true,
      stdio: 'ignore',
      windowsVerbatimArguments: true,
    }),
  D_powershell_start_process: (m) =>
    spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Start-Process -FilePath '${bat}' -ArgumentList '"a b"','"${m}"' -WorkingDirectory '${dir}'`,
      ],
      { cwd: dir, env, detached: true, stdio: 'ignore' },
    ),
  E_detached_direct_cmd: (m) =>
    spawn('cmd.exe', ['/d', '/c', `"${bat}"`, '"a b"', `"${m}"`], {
      cwd: dir,
      env,
      detached: true,
      stdio: 'ignore',
      windowsVerbatimArguments: true,
    }),
};
for (const [k, f] of Object.entries(v)) {
  const m = join(dir, `${k}.txt`);
  const c = f(m);
  c.on('error', (e) => console.log(k, 'spawn error', e.message));
  c.unref();
}
await new Promise((r) => setTimeout(r, 8000));
for (const k of Object.keys(v)) {
  const m = join(dir, `${k}.txt`);
  console.log(k.padEnd(28), existsSync(m) ? 'RAN  ' + readFileSync(m, 'utf8').trim() : 'did not run');
}
