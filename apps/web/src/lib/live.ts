/**
 * Live updates from the server (see apps/server/src/events.ts). One event stream per visible tab; a hidden tab closes it
 * (browsers allow only a few open connections per site) and reloads everything when it becomes visible again.
 * Each message names what changed; pages listening with useRefresh(load, topics) reload when one of their topics is named.
 */
export const TAB = Math.random().toString(36).slice(2, 10); // sent with every request, so this tab ignores its own changes

export const emit = (topics: string[]) => {
  window.dispatchEvent(new CustomEvent('psc-refresh', { detail: { topics } }));
  if (topics.some((t) => t === 'batches' || t === 'calendar' || t === 'all'))
    window.dispatchEvent(new Event('psc-batches'));
};

let es: EventSource | null = null,
  started = false,
  lost = false;
function open() {
  if (es || document.visibilityState === 'hidden') return;
  es = new EventSource('/api/events');
  es.onmessage = (m) => {
    try {
      const d = JSON.parse(m.data) as { topics: string[]; tab: string };
      if (d.tab !== TAB) emit(d.topics);
    } catch {
      /* not ours */
    }
  };
  es.onopen = () => {
    if (lost) emit(['all']); // missed messages while the server was away (restart, update): reload everything once
    lost = false;
  };
  es.onerror = () => {
    lost = true; // the browser reconnects by itself
  };
}
function close() {
  es?.close();
  es = null;
}
/** Starts live updates after sign-in; stops on sign-out. */
export function live(on: boolean) {
  if (!on) {
    close();
    return;
  }
  if (!started) {
    started = true;
    document.addEventListener('visibilitychange', () => {
      if (!started) return;
      if (document.visibilityState === 'hidden') close();
      else if (!es) {
        open();
        emit(['all']);
      }
    });
  }
  open();
}
export function stopLive() {
  started = false;
  close();
}
