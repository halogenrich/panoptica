import { useEffect, useState } from 'react';
import { api } from '../api';
import { Eye } from '../Icons';

export type Prof = { id: number; name: string };

/**
 * Who with the Professor tag is online. Every open tab checks in every 15 s (this is also how the server knows who is online)
 * and says goodbye when it closes, so the list empties within seconds of her signing out or closing the app.
 */
export function usePresence() {
  const [on, setOn] = useState<Prof[]>([]);
  useEffect(() => {
    let stop = false;
    const poll = () =>
      api<{ professors: Prof[] }>('/presence')
        .then((r) => {
          if (!stop) setOn(r.professors);
        })
        .catch(() => {});
    poll();
    const t = setInterval(poll, 15_000),
      vis = () => document.visibilityState === 'visible' && poll();
    const bye = () => navigator.sendBeacon?.('/api/presence/leave');
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('pagehide', bye);
    return () => {
      stop = true;
      clearInterval(t);
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('pagehide', bye);
    };
  }, []);
  return on;
}

/** The eye left of search, while the Professor is online (a funny setting). */
export default function PresenceEye({ on }: { on: Prof[] }) {
  if (!on.length) return null;
  const who = on.map((p) => p.name).join(' and ');
  return (
    <span className="iconbtn eye-btn" role="img" aria-label={`${who} is online`} title={`${who} is online`}>
      <Eye />
    </span>
  );
}
