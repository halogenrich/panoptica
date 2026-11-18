import { Suspense, lazy, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { LabCtx, PrefCtx, type Me, type Prefs } from './ctx';
import { Wordmark } from './start/parts';
import CompleteProfile from './views/CompleteProfile';
import Avatar from './lib/Avatar';
import PresenceEye, { usePresence } from './lib/Presence';
import NewsTicker from './lib/NewsTicker';
import Outcomes from './lib/Outcomes';
import Profile from './views/Profile';
import { Bell, Logout, Menu, Search, Trash as TrashIcon } from './Icons';
import Palette, { type Cmd } from './views/Palette';
import Inventory from './views/Inventory';
import Calendar from './views/Calendar';
import AdminScreen from './views/AdminScreen';
import { EquipmentUse, LabOverview, Progress, Students, seesAll } from './views/Overview';
import Users from './views/Users';
import Help from './views/Help';
import Trash from './views/Trash';
import { Toaster } from './lib/trash';
import { NotificationList, useNotifications } from './lib/Notifications';
import EquipmentPage from './views/Equipment';
import { parseRoute, pushRoute } from './lib/route';
import { MODULES } from './modules/installed';
import type { Group, Page } from './modules/types';
const Invite = lazy(() => import('./lib/Invite'));

/**
 * The core's own pages (0.42). A module may show one of them in its own group (Electronic Devices puts the Calendar under
 * Fabrication); otherwise the Calendar comes right after the Overview and the lab's shared resources (Lab) sit at the bottom.
 */
const CORE: Record<string, Page> = {
  cal: {
    key: 'cal',
    label: 'Calendar',
    render: (p) => {
      // a module's tray when the Calendar was opened with its parameter (Electronic Devices: { schedule: batch id })
      const t = p.modules.find((m) => m.calendarTray && p.extra[m.calendarTray.param]);
      return (
        <Calendar
          open={p.open}
          tray={t ? { Tray: t.calendarTray!.Tray, id: p.extra[t.calendarTray!.param] as number } : null}
        />
      );
    },
  },
  chem: {
    key: 'chem',
    label: 'Inventory',
    render: (p) => (
      <Inventory
        canEdit={p.me.role === 'admin' || !!p.me.inventory}
        openId={p.openId}
        dups={(p.extra.dups as number) ?? 0}
      />
    ),
  },
  eq: { key: 'eq', label: 'Equipment', render: (p) => <EquipmentPage openId={p.openId} onOpen={p.onOpen} /> },
};
const SPECIAL: Record<string, string> = {
  // the Overview section (0.60); `dash` stays the Lab page's key, so links made before still open it
  dash: 'Lab overview',
  students: 'Students',
  progress: 'My progress',
  equse: 'Equipment use',
  labscreen: 'Lab screen',
  users: 'Admin settings',
  trash: 'Trash',
  help: 'Help',
  profile: 'Profile',
};
const OVERVIEW_KEYS = new Set(['dash', 'students', 'progress', 'equse', 'labscreen']);
type MenuGroup = { group: string; tab?: string; pages: Page[]; bottom?: boolean };
/** The side menu from the core and the installed modules, in the modules' order; phone tabs are the groups that ask for one. */
function menuOf(mods: typeof MODULES): MenuGroup[] {
  const placed = new Set(mods.flatMap((m) => m.groups.flatMap((g) => g.pages.filter((x) => typeof x === 'string'))));
  const own = (g: Group): MenuGroup => ({
    ...g,
    pages: g.pages.map((x) => (typeof x === 'string' ? CORE[x] : x)).filter((x): x is Page => !!x),
  });
  return [
    ...(placed.has('cal') ? [] : [{ group: '', pages: [CORE.cal] }]),
    ...mods.flatMap((m) => m.groups.map(own)),
    { group: 'Lab', pages: [CORE.chem, CORE.eq].filter((x) => !placed.has(x.key)), bottom: true },
  ].filter((g) => g.pages.length);
}

function Seg<T extends string>({ value, opts, on }: { value: T; opts: [T, string][]; on: (v: T) => void }) {
  return (
    <div className="seg">
      {opts.map(([k, l]) => (
        <button key={k} className={k === value ? 'on' : ''} onClick={() => on(k)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export default function Shell({ me, onLogout, onPhone }: { me: Me; onLogout: () => void; onPhone?: () => void }) {
  const { prefs, set } = useContext(PrefCtx),
    { lab } = useContext(LabCtx);
  // the modules the server has (until it says, every module this build has)
  const [installed, setInstalled] = useState<string[] | null>(null);
  const mods = MODULES.filter((m) => !installed || installed.includes(m.id)),
    menu0 = menuOf(mods),
    PAGES: Record<string, Page> = Object.fromEntries(menu0.flatMap((g) => g.pages.map((x) => [x.key, x]))),
    LABEL: Record<string, string> = {
      ...Object.fromEntries(Object.values(PAGES).map((x) => [x.key, x.label])),
      ...SPECIAL,
    },
    KEYS = new Set(Object.keys(LABEL)),
    TABS = menu0.filter((g) => g.tab).map((g) => ({ key: g.group, label: g.tab!, items: g.pages.map((x) => x.key) })),
    parts = mods.filter((m) => m.overview).map((m) => ({ ...m.overview!, id: m.id }));
  /** The Overview section (0.60): what this person may open in it. */
  const overview = [
    { key: 'dash', label: 'Lab' },
    ...(seesAll(me) || (me.supervises ?? 0) > 0 ? [{ key: 'students', label: 'Students' }] : []),
    { key: 'progress', label: 'My progress' },
    ...(seesAll(me) ? [{ key: 'equse', label: 'Equipment use' }] : []),
    ...(me.role === 'admin' ? [{ key: 'labscreen', label: 'Lab screen' }] : []),
  ];
  // the address (#/batches/12) says what to open, also on the first load: a link sent by someone else
  const start = (() => {
    const r = parseRoute();
    // #/updates and #/network (0.51: the tray icon opens Updates) are tabs of Admin settings
    if (r && (r.view === 'updates' || r.view === 'network') && me.role === 'admin') {
      try {
        localStorage.setItem('psc-admin-tab', r.view);
      } catch {
        /* private window */
      }
      return { view: 'users', id: null };
    }
    if (!r || !KEYS.has(r.view)) return null;
    if (!overview.some((x) => x.key === r.view) && OVERVIEW_KEYS.has(r.view)) return null;
    if (r.view === 'users' && me.role !== 'admin') return null;
    return r;
  })();
  const first = menu0.find((g) => g.group)?.pages[0]?.key ?? 'dash';
  const [view, setView] = useState<string>(start?.view ?? first),
    // the item open on each page, and what else a page was opened with (the calendar's batch to schedule)
    [ids, setIds] = useState<Record<string, number | null>>(start ? { [start.view]: start.id } : {}),
    [extras, setExtras] = useState<Record<string, Record<string, unknown>>>({}),
    [nav, setNav] = useState(0),
    [pal, setPal] = useState(false),
    [pop, setPop] = useState<'' | 'bell' | 'me'>(''),
    [ver, setVer] = useState(''),
    [menu, setMenu] = useState(false),
    [invite, setInvite] = useState(false),
    [lastIn, setLastIn] = useState<Record<string, string>>({});
  useEffect(() => {
    api<{ version: string; modules?: string[] }>('/version')
      .then((v) => {
        setVer(v.version);
        if (v.modules) setInstalled(v.modules);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(false);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPal((p) => !p);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  // the page's address follows the page (open items add their id themselves, lib/route.ts)
  useEffect(() => {
    if (parseRoute()?.view !== view) pushRoute(view);
  }, [view]);
  // Back and Forward: open what the address says (the page is drawn again so open sheets follow)
  const keysRef = useRef(KEYS);
  keysRef.current = KEYS;
  useEffect(() => {
    const f = () => {
      const r = parseRoute();
      if (!r || !keysRef.current.has(r.view)) return;
      setView(r.view);
      setIds((x) => ({ ...x, [r.view]: r.id }));
      setPop('');
      setMenu(false);
      setNav((n) => n + 1);
    };
    window.addEventListener('popstate', f);
    return () => window.removeEventListener('popstate', f);
  }, []);
  const notes = useNotifications(),
    profs = usePresence();

  /** Opens a page and an item on it (search results, notifications, links between pages). */
  const go = (k: string, id: number | null = null, extra: Record<string, unknown> = {}) => {
    setView(k);
    setIds((x) => ({ ...x, [k]: id }));
    setExtras((x) => ({ ...x, [k]: extra }));
    setPop('');
    setMenu(false);
  };
  const openLink = (l: { view: string; id: number | null }) => {
    setPop('');
    if (l.view === 'users' || l.view === 'requests' || l.view === 'network') {
      try {
        // an Admin settings tab: access requests, the network (certificate notices, 0.51), else updates
        localStorage.setItem('psc-admin-tab', l.view === 'users' ? 'updates' : l.view);
      } catch {
        /* ignore */
      }
      go('users');
      return;
    }
    // possible duplicate substances (0.54): Inventory › Substances, with the review open
    if (l.view === 'duplicates') {
      go('chem', null, { dups: Date.now() });
      return;
    }
    if (KEYS.has(l.view)) go(l.view, l.id);
  };
  const tabOf = (k: string) => TABS.find((t) => t.items.includes(k));
  useEffect(() => {
    const t = tabOf(view);
    if (t) setLastIn((l) => ({ ...l, [t.key]: view }));
  }, [view]);
  /** One search over everything the person may open; results of modules this app does not show are left out. */
  const search = async (q: string): Promise<Cmd[]> => {
    const r = await api<{
      hits: { key: string; label: string; hint: string; link: { view: string; id: number | null } }[];
    }>('/search?q=' + encodeURIComponent(q));
    return r.hits
      .filter((h) => KEYS.has(h.link.view))
      .map((h) => ({ id: h.key, label: h.label, hint: h.hint, run: () => go(h.link.view, h.link.id) }));
  };
  const cmds: Cmd[] = [
    ...menu0.flatMap((g) => g.pages).map((x) => ({ id: x.key, label: x.label, hint: 'Go to', run: () => go(x.key) })),
    ...(me.role === 'admin' ? [{ id: 'users', label: 'Admin settings', hint: 'Go to', run: () => go('users') }] : []),
    ...overview.map((x) => ({
      id: x.key,
      label: x.key === 'dash' ? 'Lab overview' : x.label,
      hint: 'Go to',
      run: () => go(x.key),
    })),
    { id: 'trash', label: 'Trash', hint: 'Go to', run: () => go('trash') },
    { id: 'help', label: 'Help', hint: 'Go to', run: () => go('help') },
    { id: 'profile', label: 'Edit profile', hint: 'Go to', run: () => go('profile') },
    { id: 'out', label: 'Sign out', run: onLogout },
  ];
  // someone else's progress belongs under Students, not My progress
  const other = view === 'progress' && !!ids.progress && ids.progress !== me.id;
  const ovOn = (k: string) => (other ? k === 'students' : view === k);
  const page = () => {
    switch (view) {
      case 'dash':
        return <LabOverview open={go} parts={parts} />;
      case 'students':
        return <Students parts={parts} onOpen={(id) => go('progress', id, { from: 'students' })} />;
      case 'progress': {
        const id = ids.progress ?? me.id;
        return (
          <Progress
            id={id}
            parts={parts}
            open={go}
            onBack={id !== me.id && overview.some((x) => x.key === 'students') ? () => go('students') : undefined}
          />
        );
      }
      case 'equse':
        return <EquipmentUse />;
      case 'labscreen':
        return <AdminScreen />;
      case 'users':
        return <Users meId={me.id} />;
      case 'help':
        return <Help />;
      case 'trash':
        return <Trash admin={me.role === 'admin'} />;
      case 'profile':
        return <Profile onInvite={() => setInvite(true)} />;
    }
    return PAGES[view]?.render({
      me,
      openId: ids[view] ?? null,
      onOpen: (id) => setIds((x) => ({ ...x, [view]: id })),
      open: go,
      extra: extras[view] ?? {},
      modules: mods,
    });
  };
  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <Wordmark lab={lab?.name} size="s" />
        </div>
        <h1>{other ? 'Progress' : LABEL[view]}</h1>
        {prefs.news ? (
          <NewsTicker
            name={me.name.replace(/^(Prof\.?|Dr\.?)\s+/i, '').split(/\s+/)[0]}
            profs={!me.professor && prefs.eye ? profs : []}
          />
        ) : (
          <div className="grow" />
        )}
        {!me.professor && prefs.eye && <PresenceEye on={profs} />}
        <button className="searchbtn" onClick={() => setPal(true)}>
          <Search size={16} />
          <span>Search</span>
          <kbd>Ctrl K</kbd>
        </button>
        <button
          className={'iconbtn help-btn' + (view === 'help' ? ' on' : '')}
          aria-label="Help"
          title="Help and quick start"
          onClick={() => go('help')}
        >
          ?
        </button>
        <button
          className="iconbtn bell"
          aria-label={`Notifications${notes.unread ? `, ${notes.unread} unread` : ''}`}
          onClick={() => setPop(pop === 'bell' ? '' : 'bell')}
        >
          <Bell />
          {notes.unread > 0 && <span className="bell-n">{notes.unread > 9 ? '9+' : notes.unread}</span>}
        </button>
        <button className="avatar" aria-label="Profile" onClick={() => setPop(pop === 'me' ? '' : 'me')}>
          <Avatar id={me.id} name={me.name} photoV={me.photoV} />
        </button>
        <button className="iconbtn hide-phone" aria-label="Sign out" title="Sign out" onClick={onLogout}>
          <Logout />
        </button>
      </header>
      <nav className="side">
        <div>
          <div className="glabel">Overview</div>
          {overview.map((x) => (
            <button key={x.key} className={'navitem' + (ovOn(x.key) ? ' on' : '')} onClick={() => go(x.key)}>
              {x.label}
            </button>
          ))}
        </div>
        {menu0.map((g) => (
          <div key={g.group || 'main'} style={g.bottom ? { marginTop: 'auto' } : undefined}>
            {g.group && <div className="glabel">{g.group}</div>}
            {g.pages.map((x) => (
              <button key={x.key} className={'navitem' + (view === x.key ? ' on' : '')} onClick={() => go(x.key)}>
                {x.label}
              </button>
            ))}
          </div>
        ))}
        <div className="side-foot">
          <button className={'navitem' + (view === 'trash' ? ' on' : '')} onClick={() => go('trash')}>
            <TrashIcon size={16} /> Trash
          </button>
        </div>
      </nav>
      <main className="content">
        {(tabOf(view)?.items.length ?? 0) > 1 && (
          <div className="subnav phone-only" role="tablist" aria-label={tabOf(view)!.label}>
            {tabOf(view)!.items.map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={view === k}
                className={'chip' + (view === k ? ' on' : '')}
                onClick={() => go(k)}
              >
                {LABEL[k]}
              </button>
            ))}
          </div>
        )}
        <div key={view + ':' + nav} className="page">
          {page()}
        </div>
      </main>
      <div className="tabbar">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={'navitem' + (t.items.includes(view) ? ' on' : '')}
            onClick={() => go(lastIn[t.key] ?? t.items[0])}
          >
            {t.label}
          </button>
        ))}
        <button className={'navitem' + (!tabOf(view) ? ' on' : '')} onClick={() => setMenu(true)} aria-label="Menu">
          <Menu size={20} />
        </button>
      </div>
      {pop && (
        <div className="popwrap" onClick={() => setPop('')}>
          <div className="pop" onClick={(e) => e.stopPropagation()}>
            {pop === 'bell' ? (
              <NotificationList n={notes} onOpen={openLink} />
            ) : (
              <>
                <div className="me-head">
                  <Avatar id={me.id} name={me.name} photoV={me.photoV} size={40} />
                  <div className="grow">
                    <b>{me.name}</b>
                    <div className="mut">
                      @{me.username}
                      {me.tags?.length ? ' · ' + me.tags.map((t) => t.name).join(', ') : ''}
                    </div>
                  </div>
                  <button className="link small" onClick={() => go('profile')}>
                    Edit profile
                  </button>
                </div>
                <div>
                  <div className="mut">Theme</div>
                  <Seg<Prefs['theme']>
                    value={prefs.theme}
                    opts={[
                      ['system', 'System'],
                      ['light', 'Light'],
                      ['dark', 'Dark'],
                    ]}
                    on={(v) => set({ theme: v })}
                  />
                </div>
                {/* 0.55.4: on a phone that chose the full app, the way back is here, in reach; a phone needs no invitation */}
                {onPhone ? (
                  <button
                    className="btn secondary"
                    onClick={() => {
                      setPop('');
                      onPhone();
                    }}
                  >
                    Phone layout
                  </button>
                ) : (
                  <button
                    className="btn secondary"
                    onClick={() => {
                      setPop('');
                      setInvite(true);
                    }}
                  >
                    Invite a phone (QR code)
                  </button>
                )}
                {me.role === 'admin' && (
                  <button className="btn" onClick={() => go('users')}>
                    Admin settings
                  </button>
                )}
                <div className="mut" style={{ fontSize: 12 }}>
                  Version {ver}
                </div>
              </>
            )}
          </div>
        </div>
      )}
      <Toaster />
      <Outcomes after={Object.assign({}, ...mods.map((m) => m.afterOutcome ?? {}))} />
      <CompleteProfile />
      {mods.map((m) => m.Overlay && <m.Overlay key={m.id} />)}
      {invite && (
        <Suspense fallback={null}>
          <Invite onClose={() => setInvite(false)} />
        </Suspense>
      )}
      {menu && (
        <div
          className="scrim"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setMenu(false);
          }}
        >
          <nav className="navsheet" aria-label="All sections">
            <div className="grabber" />
            <button
              className="searchrow"
              onClick={() => {
                setMenu(false);
                setPal(true);
              }}
            >
              <Search size={16} /> Search
            </button>
            <div>
              <div className="glabel">Overview</div>
              {overview.map((x) => (
                <button key={x.key} className={'navitem' + (ovOn(x.key) ? ' on' : '')} onClick={() => go(x.key)}>
                  {x.label}
                </button>
              ))}
            </div>
            {menu0.map((g) => (
              <div key={g.group || 'main'}>
                {g.group && <div className="glabel">{g.group}</div>}
                {g.pages.map((x) => (
                  <button key={x.key} className={'navitem' + (view === x.key ? ' on' : '')} onClick={() => go(x.key)}>
                    {x.label}
                  </button>
                ))}
              </div>
            ))}
            <div className="glabel">Account</div>
            {me.role === 'admin' && (
              <button className={'navitem' + (view === 'users' ? ' on' : '')} onClick={() => go('users')}>
                Admin settings
              </button>
            )}
            <button className={'navitem' + (view === 'profile' ? ' on' : '')} onClick={() => go('profile')}>
              Edit profile
            </button>
            <button className={'navitem' + (view === 'trash' ? ' on' : '')} onClick={() => go('trash')}>
              Trash
            </button>
            <button className={'navitem' + (view === 'help' ? ' on' : '')} onClick={() => go('help')}>
              Help
            </button>
            {onPhone && (
              <button className="navitem" onClick={onPhone}>
                Phone layout
              </button>
            )}
            <button className="navitem" onClick={onLogout}>
              Sign out
            </button>
          </nav>
        </div>
      )}
      {pal && <Palette cmds={cmds} search={search} onClose={() => setPal(false)} />}
    </div>
  );
}
