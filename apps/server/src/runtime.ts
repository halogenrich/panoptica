/**
 * The runtime (0.52): the Node PANOPTICA runs on. Until 0.51 an in-app update replaced the app and never Node, so an install's
 * Node changed only when a newer PANOPTICA Setup was run over it. Since 0.52 a release also carries Node as a file of its own,
 * panoptica-node-<version>-win-x64.zip (tools/runtime-file.mjs: node.exe and its licence, signed like the packages), and an
 * install made by Setup on Windows downloads it with the update when the release's Node is not the one it runs.
 *
 * The app does the work it can do while running: it checks the file (SHA-256 and PANOPTICA's signature), unpacks it into
 * updates/runtime/ and makes PANOPTICA.exe there (brand.ts). The update script (update.bat) then only moves folders: the old
 * runtime aside (node.old), the new one in place, PANOPTICA started; when it does not start in time, the old runtime goes back.
 * A swap that does not happen is told to the admins: refused here before anything changes (the update installs the app and
 * keeps Node), or given up by the update script, which leaves updates/runtime-failed.txt for the app to read when it starts.
 * Manual installs (zip and start scripts) keep the computer's own Node: nothing here applies to them.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { ROOT } from './config.js';
import { setupInstall } from './licence.js';
import { signedByPanoptica } from './signature.js';
import { brandRuntime } from './brand.js';

/** The release file that carries Node: panoptica-node-26.13.1-win-x64.zip → 26.13.1. */
export const RUNTIME_FILE = /^panoptica-node-(\d+\.\d+\.\d+)-win-x64\.zip$/;
const DIR = () => process.env.UPDATES_DIR || join(ROOT, 'updates');
/** The new runtime, ready for the update script: node.exe, LICENSE, PANOPTICA.exe and `version`. */
export const runtimeDir = () => join(DIR(), 'runtime');
/** The runtime file itself and its signature, kept so the update script checks it again before swapping. */
export const runtimeZip = () => join(DIR(), 'runtime.zip');

/**
 * Whether updates change this install's Node: an install made by Setup, on Windows. The tests run the checks of this file on
 * Linux with PANOPTICA_TEST_RUNTIME (the swap itself is tested on Windows by the Installer workflow).
 */
export const swapsRuntime = () =>
  setupInstall() &&
  (process.platform === 'win32' || (process.env.PANOPTICA_TEST === '1' && process.env.PANOPTICA_TEST_RUNTIME === '1'));

/** The Node this server runs on. */
export const runningNode = () => process.versions.node;

/** The version of the runtime prepared in updates/runtime, if one is ready. */
export function preparedRuntime(): string | undefined {
  const d = runtimeDir();
  if (!['node.exe', 'PANOPTICA.exe', 'version'].every((f) => existsSync(join(d, f))) || !existsSync(runtimeZip()))
    return undefined;
  return readFileSync(join(d, 'version'), 'utf8').trim() || undefined;
}

/** Forgets a prepared runtime (a new download, or one that is not needed). */
export function clearRuntime() {
  rmSync(runtimeDir(), { recursive: true, force: true });
  for (const f of [runtimeZip(), runtimeZip() + '.sig']) rmSync(f, { force: true });
}

/**
 * Checks the runtime file and prepares updates/runtime from it. Throws, with the reason in words, when it cannot: then nothing
 * is kept and the update goes on without changing Node.
 */
export function prepareRuntime(zip: Buffer, sum: string, sig: string, node: string, appVersion: string) {
  clearRuntime();
  if (!/^[0-9a-f]{64}$/.test(sum) || createHash('sha256').update(zip).digest('hex') !== sum)
    throw new Error('the Node file does not match its checksum');
  if (!signedByPanoptica(zip, sig)) throw new Error('the Node file is not signed by PANOPTICA');
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(zip), { filter: (f) => ['node/node.exe', 'node/LICENSE'].includes(f.name) });
  } catch {
    throw new Error('the Node file cannot be read');
  }
  if (!files['node/node.exe']) throw new Error('the Node file holds no node.exe');
  const d = runtimeDir();
  mkdirSync(d, { recursive: true });
  let branding = false;
  try {
    writeFileSync(join(d, 'node.exe'), files['node/node.exe']);
    if (files['node/LICENSE']) writeFileSync(join(d, 'LICENSE'), files['node/LICENSE']);
    branding = true;
    // the icon Setup left next to its helper (installer/panoptica.ico, beside the app's folder)
    brandRuntime(
      join(d, 'node.exe'),
      join(d, 'PANOPTICA.exe'),
      join(ROOT, '..', 'installer', 'panoptica.ico'),
      appVersion,
    );
    branding = false;
    writeFileSync(runtimeZip(), zip);
    writeFileSync(runtimeZip() + '.sig', sig.trim() + '\n');
    // written last: the update script swaps only a runtime that is complete
    writeFileSync(join(d, 'version'), node + '\n');
  } catch (e) {
    clearRuntime();
    throw new Error(
      branding
        ? 'its node.exe is not Node for Windows'
        : `the new Node could not be written in the updates folder (${(e as Error).message})`,
      { cause: e },
    );
  }
}

/** What the update script left when it did not change Node (updates/runtime-failed.txt); read once, at start. */
export type RuntimeFailure = { to: string; from: string; reason: 'refused' | 'locked' | 'start' | string; at: string };
export function takeRuntimeFailure(): RuntimeFailure | undefined {
  const f = join(DIR(), 'runtime-failed.txt');
  if (!existsSync(f)) return undefined;
  try {
    const kv = Object.fromEntries(
      readFileSync(f, 'utf8')
        .split(/\r?\n/)
        .map((l) => l.match(/^\s*(\w+)=(.*?)\s*$/))
        .filter((m): m is RegExpMatchArray => !!m)
        .map((m) => [m[1], m[2]]),
    );
    return { to: kv.to ?? '', from: kv.from ?? runningNode(), reason: kv.reason ?? '', at: new Date().toISOString() };
  } finally {
    try {
      unlinkSync(f);
    } catch {
      /* read again at the next start: told twice rather than never */
    }
  }
}

/** The update script's reason, in words for the admins. */
export const failureText = (f: RuntimeFailure) =>
  f.reason === 'start'
    ? `PANOPTICA did not start on Node ${f.to}, so the update put Node ${f.from} back`
    : f.reason === 'locked'
      ? `Node ${f.to} could not replace Node ${f.from}: its files were in use`
      : `the Node ${f.to} file was refused when the update checked it again`;
