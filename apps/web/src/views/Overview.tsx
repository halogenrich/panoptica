import EquipmentArt, { artOf } from '../lib/EquipmentArt';
import { useContext, useEffect, useState } from 'react';
import { useRefresh } from '../lib/trash';
import { api } from '../api';
import Avatar from '../lib/Avatar';
import { Seg } from '../lib/ui';
import { INK, SlideButtons, SlideFrame, useSlide } from './overview/slides';
import { More, Stats, endOf, hrs, periodName, plural, seen, startOf, type Unit } from './overview/parts';
import { MeCtx, type Tag } from '../ctx';
import type { CoreDash, Open, OverviewPart, Stat, Who } from '../modules/types';

/**
 * The Overview section (0.60, Richard: one menu section; each person sees only what they may):
 * - Lab: the lab's numbers for a week or a month and its best work; everyone (the lab screen shows the same). Those who do not
 *   see everything get shared work and their own (the server decides).
 * - Students: one card per person the viewer may follow; a card opens their progress. Professors, admins and Lab managers see
 *   everyone; a supervisor or co-supervisor their own students.
 * - My progress: one person's work over all time, and its slide. Their own for everyone; anyone's from Students.
 * - Equipment use: how busy each instrument was and the steps that did not go as planned (until 0.62 reworks it).
 * The Summary of 0.42 (opening sentences, efficiency over time, Export for a presentation) is gone (Richard, 18 Nov).
 */

/** A module's part of the Overview, with the key its numbers come under (`m.devices`). */
export type Part = OverviewPart & { id: string };
type Person = {
  id: number;
  name: string;
  username: string;
  photoV?: number;
  last_seen: string | null;
  role: string;
  tags: Tag[];
  hours: number;
  supervisor?: string;
  cosupervisor?: string;
  mine?: boolean;
  m: Record<string, any>;
};
type Eq = {
  id: number;
  name: string;
  color: string;
  hours: number;
  use: number;
  bookings: number;
  byUser: { name: string; hours: number }[];
  done: number;
  postponed: number;
  canceled: number;
};
type Dash = CoreDash & {
  people: Person[];
  equipment: Eq[];
  m: Record<string, any>;
};
type PersonPage = {
  id: number;
  name: string;
  username: string;
  photoV?: number;
  last_seen: string | null;
  created_at: string;
  supervisor: string;
  cosupervisor: string;
  tags: Tag[];
  hours: { name: string; color: string; hours: number; n: number }[];
  setbacks: { outcome: string; reason: string; start: string; step: string; equipment: string; subject: string }[];
  m: Record<string, any>;
};

/** Sees every student and the whole lab: admins, professors and Lab managers (the server's rule, 0.60). */
export const seesAll = (me: { role: string; manager?: boolean; professor?: boolean }) =>
  me.role === 'admin' || !!me.manager || !!me.professor;

// ------------------------------------------------------------------ the period (Lab, Equipment use)
/** Week or month, remembered in this browser; ‹ › move by one; "This week" comes back. */
function usePeriod() {
  const [unit, setUnit] = useState<Unit>(() => {
    try {
      return (localStorage.getItem('psc-ov-unit') as Unit) || 'week';
    } catch {
      return 'week';
    }
  });
  const [start, setStart] = useState(() => startOf(new Date(), 'week'));
  const s = startOf(start, unit),
    e = endOf(s, unit),
    label = periodName(s, unit);
  const pick = (u: Unit) => {
    setUnit(u);
    setStart(startOf(start, u));
    try {
      localStorage.setItem('psc-ov-unit', u);
    } catch {
      /* ignore */
    }
  };
  const step = (k: number) =>
    setStart(
      unit === 'month'
        ? new Date(s.getFullYear(), s.getMonth() + k, 1)
        : new Date(s.getFullYear(), s.getMonth(), s.getDate() + 7 * k),
    );
  const bar = (
    <div className="cal-bar">
      <div className="cal-nav">
        <button className="btn secondary" onClick={() => setStart(startOf(new Date(), unit))}>
          This {unit}
        </button>
        <button className="iconbtn" aria-label={`Previous ${unit}`} onClick={() => step(-1)}>
          ‹
        </button>
        <button className="iconbtn" aria-label={`Next ${unit}`} onClick={() => step(1)}>
          ›
        </button>
        <h2 className="cal-title">{label}</h2>
      </div>
      <div className="grow" />
      <Seg
        value={unit}
        on={pick}
        small
        opts={[
          ['week', 'Week'],
          ['month', 'Month'],
        ]}
      />
    </div>
  );
  return { unit, s, e, label, bar };
}
function useDash(scope: string, p: { s: Date; e: Date; unit: Unit }) {
  const [d, setD] = useState<Dash | null>(null),
    [err, setErr] = useState('');
  const load = () =>
    api<Dash>(`/dashboard?from=${p.s.toISOString()}&to=${p.e.toISOString()}&unit=${p.unit}&scope=${scope}`)
      .then(setD)
      .catch((x) => setErr(x.message));
  useEffect(() => {
    setD(null);
    setErr('');
    load();
  }, [p.s.getTime(), p.unit, scope]);
  useRefresh(load, ['batches', 'iv', 'calendar', 'users']);
  return { d, err };
}

// ------------------------------------------------------------------ Lab
const LAB: Who = { subj: 'The lab', title: 'in the lab', record: 'New lab record' };
export function LabOverview({ open, parts }: { open: Open; parts: Part[] }) {
  const p = usePeriod(),
    { d, err } = useDash('lab', p),
    period = p.unit === 'week' ? 'this week' : 'this month';
  const shown = d ? parts.filter((x) => d.m[x.id]) : [];
  const stats: Stat[] = d
    ? [
        ...shown.flatMap((x) => x.stats(d.m[x.id])),
        {
          label: 'Equipment time',
          value: d.lab.hours ? hrs(d.lab.hours) : '0 h',
          note: d.lab.workHours
            ? `${Math.round((d.lab.hours / d.lab.workHours) * 100)} % of the lab’s ${d.lab.workHours} working hours`
            : `booked ${period}`,
        },
      ]
    : [];
  return (
    <div className="ov">
      {p.bar}
      {err && <p className="err">{err}</p>}
      {!d ? (
        !err && <p className="mut">Loading…</p>
      ) : (
        <div className="ov-body">
          <Stats items={stats} />
          {shown.map((x) => x.Lab && <x.Lab key={x.id} m={d.m[x.id]} d={d} who={LAB} label={p.label} open={open} />)}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Students
/** What a person did, in words: each module's part, then equipment time. */
function doing(p: Person, parts: Part[], none: string) {
  const bits = [
    ...parts.flatMap((x) => x.doing(p.m[x.id] ?? {})),
    p.hours ? `${hrs(p.hours)} on equipment` : '',
  ].filter(Boolean);
  return bits.length ? bits.join(' · ') : none;
}
const activeIn = (p: Person, parts: Part[]) =>
  p.hours > 0 || parts.some((x) => (x.active ? x.active(p.m[x.id] ?? {}) : x.doing(p.m[x.id] ?? {}).length > 0));
const supOf = (p: { supervisor?: string; cosupervisor?: string }) =>
  [p.supervisor, p.cosupervisor].map((x) => (x ?? '').trim()).filter(Boolean);

function PersonCard({ p, parts, onOpen }: { p: Person; parts: Part[]; onOpen: (id: number) => void }) {
  const sup = supOf(p);
  return (
    <button className="ov-pcard" onClick={() => onOpen(p.id)}>
      <Avatar id={p.id} name={p.name} photoV={p.photoV} size={40} />
      <span className="ov-pcard-t">
        <b>{p.name}</b>
        <span className="mut small">
          {[p.tags.map((t) => t.name).join(', '), sup.length ? `with ${sup.join(' and ')}` : '']
            .filter(Boolean)
            .join(', ') || `last seen ${seen(p.last_seen)}`}
        </span>
        <span className="ov-pcard-d">{doing(p, parts, 'Nothing in the last 30 days')}</span>
      </span>
      <span className="ov-chev" aria-hidden>
        ›
      </span>
    </button>
  );
}

/** The viewer's own students first; then, for those who see everyone, one section per supervisor; then the rest. */
export function Students({ parts, onOpen }: { parts: Part[]; onOpen: (id: number) => void }) {
  const [list, setList] = useState<Person[] | null>(null),
    [err, setErr] = useState(''),
    { me } = useContext(MeCtx);
  const load = () =>
    api<{ people: Person[] }>('/dashboard/students')
      .then((r) => setList(r.people))
      .catch((e) => setErr(e.message));
  useEffect(() => {
    load();
  }, []);
  useRefresh(load, ['users']);
  if (err) return <p className="err">{err}</p>;
  if (!list) return <p className="mut">Loading…</p>;
  const mine = list.filter((p) => p.mine),
    rest = list.filter((p) => !p.mine),
    bySup = new Map<string, Person[]>();
  for (const p of rest) {
    const k = supOf(p)[0] ?? '';
    bySup.set(k, [...(bySup.get(k) ?? []), p]);
  }
  const sections: [string, Person[]][] = [
    ...(mine.length ? [['Your students', mine] as [string, Person[]]] : []),
    ...[...bySup.entries()]
      .filter(([k]) => k)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [`Supervised by ${k}`, v] as [string, Person[]]),
    ...(bySup.get('') ? [['No supervisor named', bySup.get('')!] as [string, Person[]]] : []),
  ];
  return (
    <div className="ov-body">
      {!list.length && (
        <p className="mut">{seesAll(me) ? 'Nobody else has an account yet.' : 'Nobody names you as supervisor yet.'}</p>
      )}
      {sections.map(([title, people]) => (
        <section key={title} className="ov-sec">
          <h4 className="ov-h">
            {title} <span className="mut">{people.length}</span>
          </h4>
          <div className="ov-people">
            {[...people]
              .sort((a, b) => Number(activeIn(b, parts)) - Number(activeIn(a, parts)))
              .map((p) => (
                <PersonCard key={p.id} p={p} parts={parts} onOpen={onOpen} />
              ))}
          </div>
        </section>
      ))}
      {list.length > 0 && (
        <p className="mut small">What each person did in the last 30 days. Open one to see their progress.</p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ My progress
export function Progress({
  id,
  parts,
  open,
  onBack,
}: {
  id: number;
  parts: Part[];
  open: Open;
  /** opened from Students: the way back */
  onBack?: () => void;
}) {
  const [p, setP] = useState<PersonPage | null>(null),
    [err, setErr] = useState(''),
    [exporting, setExporting] = useState(false);
  const load = () =>
    api<PersonPage>('/dashboard/person/' + id)
      .then(setP)
      .catch((e) => setErr(e.message));
  useEffect(() => {
    setP(null);
    load();
  }, [id]);
  useRefresh(load, ['batches', 'iv', 'calendar']);
  if (err) return <p className="err">{err}</p>;
  if (!p) return <p className="mut">Loading…</p>;
  const shown = parts.filter((x) => p.m[x.id]),
    exporter = shown.find((x) => x.PersonExport),
    sup = supOf(p),
    hours = p.hours.reduce((a, x) => a + x.hours, 0);
  return (
    <div className="ov-body">
      {onBack && (
        <button className="link back" onClick={onBack}>
          ‹ Students
        </button>
      )}
      <header className="ov-person">
        <Avatar id={p.id} name={p.name} photoV={p.photoV} size={56} />
        <div>
          <h2>{p.name}</h2>
          <span className="mut">
            {[p.tags.map((t) => t.name).join(', '), sup.length ? `supervised by ${sup.join(' and ')}` : '']
              .filter(Boolean)
              .join(', ') || `@${p.username}`}
            {' · '}last seen {seen(p.last_seen)}
          </span>
        </div>
        <div className="grow" />
        {exporter && (
          <button className="btn secondary small-btn" onClick={() => setExporting(true)}>
            Export for a presentation
          </button>
        )}
      </header>
      {shown.map((x) => x.Person && <x.Person key={x.id} m={p.m[x.id]} open={open} />)}
      <More title={`Equipment time${hours ? `, ${hrs(hours)}` : ''}`} count={p.hours.length}>
        {p.hours.length ? (
          <div className="bars">
            {p.hours.map((h) => (
              <div key={h.name} className="bar-row" style={{ '--eq': h.color } as React.CSSProperties}>
                <span>{h.name}</span>
                <span className="bar">
                  <i style={{ width: `${(h.hours / Math.max(...p.hours.map((x) => x.hours))) * 100}%` }} />
                </span>
                <span className="mut small">
                  {hrs(h.hours)}, {plural(h.n, 'booking')}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mut">No bookings yet.</p>
        )}
      </More>
      {p.setbacks.length > 0 && <Setbacks list={p.setbacks} title="Postponed or canceled steps" />}
      {exporting && exporter?.PersonExport && (
        <exporter.PersonExport m={p.m[exporter.id]} who={p} onClose={() => setExporting(false)} />
      )}
    </div>
  );
}

function Setbacks({
  list,
  title,
}: {
  list: { outcome: string; reason: string; equipment: string; subject: string; step: string; user?: string }[];
  title: string;
}) {
  return (
    <More title={title} count={list.length}>
      <ul className="ov-list">
        {list.map((x, i) => (
          <li key={i}>
            <span className={'oc oc-' + x.outcome}>{x.outcome === 'postponed' ? 'Postponed' : 'Canceled'}</span>
            <span>
              {x.user ? `${x.user}: ` : ''}
              {x.equipment}
              {x.subject ? `, ${x.subject}` : ''}
              {x.step ? ` (${x.step})` : ''}
            </span>
            <span className="mut small">{x.reason}</span>
          </li>
        ))}
      </ul>
    </More>
  );
}

// ------------------------------------------------------------------ Equipment use
export function EquipmentUse() {
  const p = usePeriod(),
    { d, err } = useDash('lab', p),
    sl = useSlide(),
    { me } = useContext(MeCtx);
  if (!seesAll(me)) return <p className="mut">Admins, professors and Lab managers see equipment use.</p>;
  const max = d ? Math.max(1, ...d.equipment.map((e) => e.hours)) : 1,
    period = p.unit === 'week' ? 'this week' : 'this month',
    g = d?.digest;
  return (
    <div className="ov">
      {p.bar}
      {err && <p className="err">{err}</p>}
      {!d ? (
        !err && <p className="mut">Loading…</p>
      ) : (
        <div className="ov-body">
          <div className="ov-intro">
            <p className="ov-lede">
              {d.lab.hours
                ? `${hrs(d.lab.hours)} of equipment time booked ${period}.`
                : `No equipment booked ${period}.`}
            </p>
            <SlideButtons
              onMake={(as) =>
                sl.make(
                  <SlideFrame
                    svgRef={sl.ref}
                    title="Equipment use"
                    sub={`${p.label}, booked hours (share of the lab's working hours)`}
                  >
                    <g transform="translate(110 320)">
                      {d.equipment.map((e, i) => (
                        <g key={e.id} transform={`translate(0 ${i * 86})`}>
                          <text y={34} fontSize={34} fill={INK}>
                            {e.name}
                          </text>
                          <rect
                            x={640}
                            y={6}
                            width={Math.max(4, (e.hours / max) * 900)}
                            height={40}
                            rx={6}
                            fill={e.color}
                          />
                          <text x={660 + Math.max(4, (e.hours / max) * 900)} y={36} fontSize={30} fill={INK}>
                            {hrs(e.hours)} ({Math.round(e.use * 100)} %)
                          </text>
                        </g>
                      ))}
                    </g>
                  </SlideFrame>,
                  `equipment-${d.from.slice(0, 10)}`,
                  as,
                )
              }
            />
          </div>
          <section className="group">
            <div className="eq-use">
              {d.equipment.map((e) => (
                <div key={e.id} className="eq-use-row" style={{ '--eq': e.color } as React.CSSProperties}>
                  <div className="eq-use-name">
                    <EquipmentArt kind={artOf(e)} size={40} />
                    <b>{e.name}</b>
                  </div>
                  <div
                    className="eq-use-bar"
                    title={`${hrs(e.hours)} booked, ${Math.round(e.use * 100)} % of weekday working hours`}
                  >
                    <i style={{ width: `${(e.hours / max) * 100}%` }} />
                  </div>
                  <div className="eq-use-num">
                    <b>{e.hours ? hrs(e.hours) : '—'}</b>{' '}
                    <span className="mut small">
                      {e.hours ? `busy ${Math.round(e.use * 100)} % of the time` : 'not booked'}
                    </span>
                  </div>
                  {e.byUser.length > 0 && (
                    <div className="eq-use-who mut small">
                      {e.byUser.map((u) => `${u.name.split(' ')[0]} ${hrs(u.hours)}`).join(' · ')}
                      {e.postponed || e.canceled ? ` · ${e.postponed + e.canceled} postponed or canceled` : ''}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <p className="mut small ov-foot">
              Busy = booked time out of the lab's working hours ({d.lab.workHours} h this {d.unit}, set under Lab
              setup).
            </p>
          </section>
          {g && g.setbacks.length > 0 && (
            <Setbacks list={g.setbacks} title={`${plural(g.setbacks.length, 'step')} postponed or canceled`} />
          )}
          {g && g.waiting > 0 && (
            <p className="mut small">
              {g.waiting === 1 ? 'One booked step has ended and its' : `${g.waiting} booked steps have ended and their`}{' '}
              outcome is not filled in yet. The person who booked it is asked when they open the app.
            </p>
          )}
        </div>
      )}
      {sl.holder}
    </div>
  );
}
