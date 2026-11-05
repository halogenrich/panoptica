import { Suspense, lazy, useContext, useEffect, useState } from 'react';
import { api } from './api';
import { PrefCtx, type Me, type Prefs } from './ctx';
import Avatar from './lib/Avatar';
import PresenceEye, { usePresence } from './lib/Presence';
import NewsTicker from './lib/NewsTicker';
import Outcomes from './lib/Outcomes';
import Profile from './views/Profile';
import { Bell, Logout, Menu, Search, Trash as TrashIcon } from './Icons';
import Palette, { type Cmd } from './views/Palette';
import Batches from './views/Batches';
import Library from './lib/Library';
import { KINDS } from './recipes';
import Inventory from './views/Inventory';
import Calendar from './views/Calendar';
import Overview from './views/Overview';
import Users from './views/Users';
import Help from './views/Help';
import Trash from './views/Trash';
import { Toaster } from './lib/trash';
import { NotificationList, useNotifications } from './lib/Notifications';
import IvPage from './iv/IvPage';
const Invite = lazy(() => import('./lib/Invite'));

type Key = 'dash' | 'stk' | 'batches' | 'cal' | 'iv' | 'sub' | 'mask' | 's0' | 's1' | 's2' | 's3' | 's4' | 's5' | 'chem' | 'users' | 'help' | 'trash' | 'profile';
const NAV: { group: string; items: [Key, string][] }[] = [
  { group: '', items: [['stk', 'Stacks'], ['batches', 'Batches'], ['cal', 'Calendar'], ['iv', 'Electric measurements']] },
  { group: 'Designs', items: [['sub', 'Substrates'], ['mask', 'Metal masks']] },
  { group: 'Recipes', items: [['s0', 'Substrate prep'], ['s1', 'Solutions'], ['s2', 'Spin coating'], ['s3', 'Organic evaporation'], ['s4', 'Metal evaporation'], ['s5', 'Evaporated perovskite']] },
  { group: 'Library', items: [['chem', 'Inventory']] },
];
const LABEL: Record<string, string> = { ...Object.fromEntries(NAV.flatMap((g) => g.items)), dash: 'Overview', users: 'Admin settings', trash: 'Trash', help: 'Help', profile: 'Profile' };
/** Phone tab bar: Stacks (stacks and batches), Electric measurements, Recipes (all recipe kinds), then Menu for the rest. */
const TABS: { key: string; label: string; items: Key[] }[] = [
  { key: 'stacks', label: 'Stacks', items: ['stk', 'batches', 'cal'] },
  { key: 'iv', label: 'Electric measurements', items: ['iv'] },
  { key: 'recipes', label: 'Recipes', items: ['s0', 's1', 's2', 's3', 's4', 's5'] },
];
const SHORT: Partial<Record<Key, string>> = { s0: 'Substrate prep', s1: 'Solutions', s2: 'Spin coating', s3: 'Organic evap.', s4: 'Metal evap.', s5: 'Evap. perovskite' };

function Seg<T extends string>({ value, opts, on }: { value: T; opts: [T, string][]; on: (v: T) => void }) {
  return <div className="seg">{opts.map(([k, l]) => <button key={k} className={k === value ? 'on' : ''} onClick={() => on(k)}>{l}</button>)}</div>;
}

const Soon = ({ title, text }: { title: string; text: string }) => <><h2>{title}</h2><section className="group"><p className="mut">{text}</p></section></>;

export default function Shell({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const { prefs, set } = useContext(PrefCtx);
  const [view, setView] = useState<Key>('stk'), [bid, setBid] = useState<number | null>(null), [pal, setPal] = useState(false), [pop, setPop] = useState<'' | 'bell' | 'me'>(''), [ver, setVer] = useState(''), [focus, setFocus] = useState<number | null>(null), [menu, setMenu] = useState(false), [ivId, setIvId] = useState<number | null>(null), [invite, setInvite] = useState(false), [lastIn, setLastIn] = useState<Record<string, Key>>({});
  useEffect(() => { api<{ version: string }>('/version').then((v) => setVer(v.version)).catch(() => {}); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPal((p) => !p); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  const seesOverview = me.role === 'admin' || !!me.professor || !!me.manager;
  const notes = useNotifications(), profs = usePresence(), [schedId, setSchedId] = useState<number | null>(null);
  const openLink = (l: { view: string; id: number }) => {
    setPop('');
    if (l.view === 'users') { try { localStorage.setItem('psc-admin-tab', 'updates'); } catch { /* ignore */ } go('users'); return; }
    if (l.view === 'batches') { setBid(l.id); setView('batches'); } else if (l.view === 'iv') { setIvId(l.id); setView('iv'); } else if (l.view in LABEL) go(l.view as Key, l.id);
  };
  const tabOf = (k: Key) => TABS.find((t) => t.items.includes(k));
  useEffect(() => { const t = tabOf(view); if (t) setLastIn((l) => ({ ...l, [t.key]: view })); }, [view]);
  const go = (k: Key, id: number | null = null) => { setView(k); setFocus(id); if (k === 'batches') setBid(null); if (k === 'iv') setIvId(null); setPop(''); setMenu(false); };
  const search = async (q: string): Promise<Cmd[]> => {
    const r = await api<{ presets: { id: number; segment: string; name: string }[]; batches: { id: number; code: string; name: string }[]; chemicals: { id: number; name: string }[] }>('/search?q=' + encodeURIComponent(q));
    return [
      ...r.presets.map((p) => ({ id: 'p' + p.id, label: p.name, hint: LABEL[p.segment] ?? 'Preset', run: () => go(p.segment as Key, p.id) })),
      ...r.batches.map((b) => ({ id: 'b' + b.id, label: b.code + (b.name ? ' · ' + b.name : ''), hint: 'Batch', run: () => { setBid(b.id); setView('batches'); } })),
      ...r.chemicals.map((c) => ({ id: 'c' + c.id, label: c.name, hint: 'Inventory', run: () => go('chem') })),
    ];
  };
  const cmds: Cmd[] = [...NAV.flatMap((g) => g.items).map(([k, l]) => ({ id: k, label: l, hint: 'Go to', run: () => go(k) })), ...(me.role === 'admin' ? [{ id: 'users', label: 'Admin settings', hint: 'Go to', run: () => go('users') }] : []), ...(me.role === 'admin' || me.professor || me.manager ? [{ id: 'dash', label: 'Overview', hint: 'Go to', run: () => go('dash') }] : []), { id: 'trash', label: 'Trash', hint: 'Go to', run: () => go('trash') }, { id: 'help', label: 'Help', hint: 'Go to', run: () => go('help') }, { id: 'profile', label: 'Edit profile', hint: 'Go to', run: () => go('profile') }, { id: 'out', label: 'Sign out', run: onLogout }];
  const page = () => {
    switch (view) {
      case 'stk': return <Library kind={KINDS.stk} openId={focus} onOpenBatch={(id) => { setBid(id); setView('batches'); }} />;
      case 'batches': return <Batches openId={bid} onOpen={setBid} onOpenIv={(id) => { setIvId(id); setView('iv'); }} onSchedule={(id) => { setSchedId(id); setView('cal'); }} />;
      case 'dash': return <Overview onOpenBatch={(id) => { setBid(id); setView('batches'); }} onOpenIv={(id) => { setIvId(id); setView('iv'); }} />;
      case 'cal': return <Calendar scheduling={schedId} onEndScheduling={(back) => { const id = schedId; setSchedId(null); if (back && id) { setBid(id); setView('batches'); } }} onOpenBatch={(id) => { setBid(id); setView('batches'); }} />;
      case 'iv': return <IvPage openId={ivId} onOpen={setIvId} />;
      case 'sub': return <Library kind={KINDS.sub} openId={focus} />;
      case 'mask': return <Library kind={KINDS.mask} openId={focus} />;
      case 's0': case 's1': case 's2': case 's3': case 's4': return <Library kind={KINDS[view]} openId={focus} />;
      case 's5': return <Soon title="Evaporated perovskite" text="Soon to be added: recipes for perovskite films made by (co-)evaporation of the precursors, with sources, rates and substrate temperature." />;
      case 'chem': return <Inventory canEdit={me.role === 'admin' || !!me.inventory} />;
      case 'users': return <Users meId={me.id} />;
      case 'help': return <Help />;
      case 'trash': return <Trash admin={me.role === 'admin'} />;
      case 'profile': return <Profile onInvite={() => setInvite(true)} />;
    }
  };
  return (
    <div className="app">
      <header className="top">
        <div className="brand">Perovskite Lab</div>
        <h1>{LABEL[view]}</h1>
        {prefs.news ? <NewsTicker name={me.name.replace(/^(Prof\.?|Dr\.?)\s+/i, '').split(/\s+/)[0]} profs={!me.professor && prefs.eye ? profs : []} /> : <div className="grow" />}
        {!me.professor && prefs.eye && <PresenceEye on={profs} />}
        <button className="searchbtn" onClick={() => setPal(true)}><Search size={16} /><span>Search</span><kbd>Ctrl K</kbd></button>
        <button className={'iconbtn help-btn' + (view === 'help' ? ' on' : '')} aria-label="Help" title="Help and quick start" onClick={() => go('help')}>?</button>
        <button className="iconbtn bell" aria-label={`Notifications${notes.unread ? `, ${notes.unread} unread` : ''}`} onClick={() => setPop(pop === 'bell' ? '' : 'bell')}><Bell />{notes.unread > 0 && <span className="bell-n">{notes.unread > 9 ? '9+' : notes.unread}</span>}</button>
        <button className="avatar" aria-label="Profile" onClick={() => setPop(pop === 'me' ? '' : 'me')}><Avatar id={me.id} name={me.name} photoV={me.photoV} /></button>
        <button className="iconbtn hide-phone" aria-label="Sign out" title="Sign out" onClick={onLogout}><Logout /></button>
      </header>
      <nav className="side">
        {seesOverview && <div><button className={'navitem' + (view === 'dash' ? ' on' : '')} onClick={() => go('dash')}>Overview</button></div>}
        {NAV.map((g) => (
          <div key={g.group || 'main'} style={g.group === 'Library' ? { marginTop: 'auto' } : undefined}>
            {g.group && <div className="glabel">{g.group}</div>}
            {g.items.map(([k, l]) => <button key={k} className={'navitem' + (view === k ? ' on' : '')} onClick={() => go(k)}>{l}</button>)}
          </div>
        ))}
        <div className="side-foot"><button className={'navitem' + (view === 'trash' ? ' on' : '')} onClick={() => go('trash')}><TrashIcon size={16} /> Trash</button></div>
      </nav>
      <main className="content">
        {(tabOf(view)?.items.length ?? 0) > 1 && (
          <div className="subnav phone-only" role="tablist" aria-label={tabOf(view)!.label}>
            {tabOf(view)!.items.map((k) => <button key={k} role="tab" aria-selected={view === k} className={'chip' + (view === k ? ' on' : '')} onClick={() => go(k)}>{SHORT[k] ?? LABEL[k]}</button>)}
          </div>
        )}
        <div key={view} className="page">{page()}</div>
      </main>
      <div className="tabbar">
        {TABS.map((t) => <button key={t.key} className={'navitem' + (t.items.includes(view) ? ' on' : '')} onClick={() => go(lastIn[t.key] ?? t.items[0])}>{t.label}</button>)}
        <button className={'navitem' + (!tabOf(view) ? ' on' : '')} onClick={() => setMenu(true)} aria-label="Menu"><Menu size={20} /></button>
      </div>
      {pop && (
        <div className="popwrap" onClick={() => setPop('')}>
          <div className="pop" onClick={(e) => e.stopPropagation()}>
            {pop === 'bell' ? <NotificationList n={notes} onOpen={openLink} /> : (
              <>
                <div className="me-head"><Avatar id={me.id} name={me.name} photoV={me.photoV} size={40} /><div className="grow"><b>{me.name}</b><div className="mut">@{me.username}{me.tags?.length ? ' · ' + me.tags.map((t) => t.name).join(', ') : ''}</div></div>
                  <button className="link small" onClick={() => go('profile')}>Edit profile</button></div>
                <div><div className="mut">Theme</div><Seg<Prefs['theme']> value={prefs.theme} opts={[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]} on={(v) => set({ theme: v })} /></div>
                <button className="btn secondary" onClick={() => { setPop(''); setInvite(true); }}>Invite a phone (QR code)</button>
                {me.role === 'admin' && <button className="btn" onClick={() => go('users')}>Admin settings</button>}
                <div className="mut" style={{ fontSize: 12 }}>Version {ver}</div>
              </>
            )}
          </div>
        </div>
      )}
      <Toaster />
      <Outcomes />
      {invite && <Suspense fallback={null}><Invite onClose={() => setInvite(false)} /></Suspense>}
      {menu && (
        <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setMenu(false); }}>
          <nav className="navsheet" aria-label="All sections">
            <div className="grabber" />
            <button className="searchrow" onClick={() => { setMenu(false); setPal(true); }}><Search size={16} /> Search</button>
            {seesOverview && <button className={'navitem' + (view === 'dash' ? ' on' : '')} onClick={() => go('dash')}>Overview</button>}
            {NAV.map((g) => (
              <div key={g.group || 'main'}>
                {g.group && <div className="glabel">{g.group}</div>}
                {g.items.map(([k, l]) => <button key={k} className={'navitem' + (view === k ? ' on' : '')} onClick={() => go(k)}>{l}</button>)}
              </div>
            ))}
            <div className="glabel">Account</div>
            {me.role === 'admin' && <button className={'navitem' + (view === 'users' ? ' on' : '')} onClick={() => go('users')}>Admin settings</button>}
            <button className={'navitem' + (view === 'profile' ? ' on' : '')} onClick={() => go('profile')}>Edit profile</button>
            <button className={'navitem' + (view === 'trash' ? ' on' : '')} onClick={() => go('trash')}>Trash</button>
            <button className={'navitem' + (view === 'help' ? ' on' : '')} onClick={() => go('help')}>Help</button>
            <button className="navitem" onClick={onLogout}>Sign out</button>
          </nav>
        </div>
      )}
      {pal && <Palette cmds={cmds} search={search} onClose={() => setPal(false)} />}
    </div>
  );
}
