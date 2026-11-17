import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Me } from '../ctx';
import { MODULES } from '../modules/installed';
import type { PhoneProps, PhoneTab } from '../modules/types';
import Avatar from '../lib/Avatar';
import Outcomes from '../lib/Outcomes';
import CompleteProfile from '../views/CompleteProfile';
import { Toaster } from '../lib/trash';
import { NotificationList, useNotifications } from '../lib/Notifications';
import { Bell, CalendarIcon, Flask, Today as TodayIcon } from '../Icons';
import Today from './Today';
import Find from './Find';
import Schedule from './Schedule';

/**
 * The phone layout (0.55): made for the three jobs people do away from a desk (follow the procedure, find a reagent, check
 * and book equipment), not the desktop pages shrunk. A bar at the bottom with Today, the modules' tabs (Run sheet), Inventory
 * and Schedule; notifications and the account at the top; "Full app" for everything else. Targets are 48 px or more, so it
 * works with gloves; the bars keep clear of the iPhone's home indicator and notch (safe areas).
 */
const CORE: PhoneTab[] = [
  { key: 'today', label: 'Today', Icon: TodayIcon, render: Today },
  { key: 'find', label: 'Inventory', Icon: Flask, render: Find },
  { key: 'book', label: 'Schedule', Icon: CalendarIcon, render: Schedule },
];
const TAB_KEY = 'psc-phone-tab';

export default function PhoneApp({ me, onFull, onLogout }: { me: Me; onFull: () => void; onLogout: () => void }) {
  const [installed, setInstalled] = useState<string[] | null>(null);
  useEffect(() => {
    api<{ modules?: string[] }>('/version')
      .then((v) => v.modules && setInstalled(v.modules))
      .catch(() => {});
  }, []);
  const mods = MODULES.filter((m) => !installed || installed.includes(m.id)),
    tabs = [CORE[0], ...mods.flatMap((m) => (m.phone?.tab ? [m.phone.tab] : [])), CORE[1], CORE[2]],
    views: Record<string, string> = Object.assign(
      { cal: 'book', chem: 'find' },
      ...mods.map((m) => m.phone?.views ?? {}),
    );
  const [tab, setTab] = useState(() => {
    try {
      return sessionStorage.getItem(TAB_KEY) || 'today';
    } catch {
      return 'today';
    }
  });
  const [ids, setIds] = useState<Record<string, number | null>>({}),
    [pop, setPop] = useState<'' | 'bell' | 'me'>(''),
    // drawn again when a tab is tapped while open: back to its start
    [round, setRound] = useState(0);
  const notes = useNotifications();
  const go: PhoneProps['go'] = (k, id = null) => {
    setTab(k);
    setIds((x) => ({ ...x, [k]: id }));
    setPop('');
    try {
      sessionStorage.setItem(TAB_KEY, k);
    } catch {
      /* private window */
    }
    window.scrollTo(0, 0);
  };
  const cur = tabs.find((t) => t.key === tab) ?? tabs[0];
  const view = (v: string, id: number | null = null) => {
    if (views[v]) return go(views[v], id);
    onFull(); // a page the phone layout does not have: the full app opens it
  };
  const openLink = (l: { view: string; id: number | null }) => view(l.view, l.id);
  return (
    <div className="phone">
      <header className="ph-top">
        <h1>{cur.label}</h1>
        <button
          className="ph-icon"
          aria-label={`Notifications${notes.unread ? `, ${notes.unread} unread` : ''}`}
          onClick={() => setPop(pop === 'bell' ? '' : 'bell')}
        >
          <Bell size={22} />
          {notes.unread > 0 && <span className="bell-n">{notes.unread > 9 ? '9+' : notes.unread}</span>}
        </button>
        <button className="ph-icon" aria-label="Account" onClick={() => setPop(pop === 'me' ? '' : 'me')}>
          <Avatar id={me.id} name={me.name} photoV={me.photoV} size={32} />
        </button>
      </header>
      <main className="ph-main" key={cur.key + ':' + round}>
        {cur.key === 'today' ? (
          <Today
            me={me}
            go={go}
            view={view}
            openId={null}
            parts={mods.flatMap((m) => (m.phone?.Today ? [{ id: m.id, Part: m.phone.Today }] : []))}
          />
        ) : (
          <cur.render me={me} go={go} view={view} openId={ids[cur.key] ?? null} />
        )}
      </main>
      <nav className="ph-bar" aria-label="Sections">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={t.key === cur.key ? 'on' : ''}
            aria-current={t.key === cur.key ? 'page' : undefined}
            onClick={() => {
              if (t.key === cur.key) setRound((r) => r + 1);
              go(t.key);
            }}
          >
            <t.Icon size={24} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      {pop && (
        <div className="popwrap" onClick={() => setPop('')}>
          <div className="pop ph-pop" onClick={(e) => e.stopPropagation()}>
            {pop === 'bell' ? (
              <NotificationList n={notes} onOpen={openLink} />
            ) : (
              <>
                <div className="me-head">
                  <Avatar id={me.id} name={me.name} photoV={me.photoV} size={40} />
                  <div className="grow">
                    <b>{me.name}</b>
                    <div className="mut">@{me.username}</div>
                  </div>
                </div>
                <p className="mut small">Recipes, measurements, settings and everything else are in the full app.</p>
                <button className="btn secondary ph-wide" onClick={onFull}>
                  Open the full app
                </button>
                <button className="btn secondary ph-wide" onClick={onLogout}>
                  Sign out
                </button>
              </>
            )}
          </div>
        </div>
      )}
      <Toaster />
      <Outcomes after={Object.assign({}, ...mods.map((m) => m.afterOutcome ?? {}))} />
      <CompleteProfile />
      {mods.map((m) => m.Overlay && <m.Overlay key={m.id} />)}
    </div>
  );
}
