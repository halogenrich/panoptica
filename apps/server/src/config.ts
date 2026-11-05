import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** App root (next to start.bat) and the folder for this computer's secrets: never in backups, updates or the GitHub repository. */
export const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
export const CONFIG_DIR = resolve(process.env.CONFIG_DIR || join(ROOT, 'config'));

export function readConfig<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(join(CONFIG_DIR, name), 'utf8')) as T;
  } catch {
    return fallback;
  }
}
/** Written readable by this user only (on Windows the folder inherits the user's profile permissions). */
export function writeConfig(name: string, value: unknown) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const f = join(CONFIG_DIR, name);
  writeFileSync(f, typeof value === 'string' ? value : JSON.stringify(value, null, 2), { mode: 0o600 });
  try {
    chmodSync(f, 0o600);
  } catch {
    /* Windows */
  }
}
export const hasConfig = (name: string) => existsSync(join(CONFIG_DIR, name));
