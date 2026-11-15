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
/**
 * The tray icon's folder (0.51): next to the app folder on an install made by PANOPTICA Setup (config/install.json), where
 * PANOPTICA leaves server.json and token for it; PANOPTICA_TRAY_DIR in tests. '' when there is none.
 */
export const trayDir = () =>
  process.env.PANOPTICA_TEST === '1' && process.env.PANOPTICA_TRAY_DIR
    ? process.env.PANOPTICA_TRAY_DIR
    : hasConfig('install.json') && existsSync(join(ROOT, '..', 'tray'))
      ? join(ROOT, '..', 'tray')
      : '';
