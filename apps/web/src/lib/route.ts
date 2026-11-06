import { useEffect } from 'react';
import { showToast } from './trash';

/**
 * Every page and item has its own address: `#/batches/12`, `#/iv/5`, `#/cmp/3`, `#/s1/7` (a recipe), `#/chem/9` (a container).
 * The address follows what is open, so it can be copied, bookmarked or sent, and the browser's back and forward buttons work.
 * The hash form keeps it working on any computer that serves the app, with no server routes.
 */
export type Route = { view: string; id: number | null };

export function parseRoute(hash = window.location.hash): Route | null {
  const m = hash.match(/^#\/([a-z0-9]+)(?:\/(\d+))?\/?$/i);
  return m ? { view: m[1], id: m[2] ? +m[2] : null } : null;
}
export const routeHash = (view: string, id?: number | null) => `#/${view}${id ? '/' + id : ''}`;
/** The full address of an item, as people open it (the address this browser uses for the app). */
export const itemUrl = (view: string, id?: number | null) =>
  window.location.origin + window.location.pathname + routeHash(view, id);

/** Adds a history entry for the route, unless the address already is that. */
export function pushRoute(view: string, id?: number | null) {
  const h = routeHash(view, id);
  if (window.location.hash !== h) window.history.pushState(null, '', h);
}

/** While an item is open its address points to it; when it closes the address goes back to its page. */
export function useItemRoute(view: string, id: number | null | undefined) {
  useEffect(() => {
    if (!id) return;
    pushRoute(view, id);
    return () => {
      // closed by the app (not by Back, which already changed the address): back to the page's own address
      if (window.location.hash === routeHash(view, id)) pushRoute(view);
    };
  }, [view, id]);
}

/** Copies text; works on plain-HTTP lab addresses too, where the clipboard API is not available. */
export async function copyText(text: string) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall back below */
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

export const copyLink = (view: string, id: number, what: string) =>
  copyText(itemUrl(view, id)).then((ok) =>
    showToast(ok ? `Link to ${what} copied` : `Copy this link: ${itemUrl(view, id)}`),
  );
