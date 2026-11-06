import { TAB } from './lib/live';

export async function api<T = any>(path: string, method = 'GET', json?: unknown): Promise<T> {
  const r = await fetch('/api' + path, {
    method,
    credentials: 'same-origin',
    headers: { ...(json ? { 'content-type': 'application/json' } : {}), 'x-tab': TAB },
    body: json ? JSON.stringify(json) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || r.statusText);
  return d as T;
}
