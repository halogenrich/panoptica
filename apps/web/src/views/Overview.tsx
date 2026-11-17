import EquipmentArt, { artOf } from '../lib/EquipmentArt';
import { useContext, useEffect, useState } from 'react';
import { useRefresh } from '../lib/trash';
import { api } from '../api';
import Avatar from '../lib/Avatar';
import { Seg, fmtDate } from '../lib/ui';
import { INK, SlideButtons, SlideFrame, SlideNumbers, useSlide } from './overview/slides';
import { More, Stats, endOf, hrs, periodName, plural, seen, startOf, type Unit } from './overview/parts';
import { MeCtx, type Tag } from '../ctx';
import type { CoreDash, Open, OverviewPart, Who } from '../modules/types';
import { Picker } from './Picker';

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
type Scopes = { lab: boolean; students: number; people: { id: number; name: string }[] };
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
  tags: Tag[];
  hours: { name: string; color: string; hours: number; n: number }[];
  setbacks: { outcome: string; reason: string; start: string; step: string; equipment: string; subject: string }[];
  m: Record<string, any>;
};

/**
 * Overview: everyone's own work, a supervisor's students, or (with Lab overview access) the lab, in a week or a month, in plain words first and details on request.
 * Summary (sentences, key numbers, who was active, details folded), People (cards, one page each) and Equipment (how busy
 * each instrument was). The core part is people, equipment time and steps that did not go as planned; each module adds its own
 * sentences, numbers, charts and details (0.42, modules/types.ts).
 */
export default function Overview({ open, parts }: { open: Open; parts: Part[] }) {
  const [unit, setUnit] = useState<Unit>(() => {
    try {
      return (localStorage.getItem('psc-ov-unit') as Unit) || 'week';
    } catch {
      return 'week';
    }
  });
  const [start, setStart] = useState(() => startOf(new Date(), 'week')),
    [tab, setTab] = useState<'lab' | 'people' | 'equipment'>('lab');
  const { me } = useContext(MeCtx);
  const [d, setD] = useState<Dash | null>(null),
    [err, setErr] = useState(''),
    [person, setPerson] = useState<number | null>(null);
  // whose overview: everyone has their own; supervisors add their students; Lab overview access adds the lab and anyone
  const [scopes, setScopes] = useState<Scopes | null>(null),
    [scope, setScope] = useState('');
  useEffect(() => {
    api<Scopes>('/dashboard/scopes')
      .then((x) => {
        setScopes(x);
        setScope((v) => v || (x.lab ? 'lab' : 'me'));
      })
      .catch((x) => setErr(x.message));
  }, []);
  const s = startOf(start, unit),
    e = endOf(s, unit);
  const loadDash = () => {
    if (!scope) return;
    api<Dash>(`/dashboard?from=${s.toISOString()}&to=${e.toISOString()}&unit=${unit}&scope=${scope}`)
      .then(setD)
      .catch((x) => setErr(x.message));
  };
  useEffect(() => {
    setD(null);
    setErr('');
    loadDash();
  }, [s.getTime(), unit, scope]);
  const one = scope.startsWith('user:') ? scopes?.people.find((p) => 'user:' + p.id === scope) : undefined;
  const who: Who =
    scope === 'lab'
      ? { subj: 'The lab', title: 'in the lab', record: 'New lab record' }
      : scope === 'students'
        ? { subj: 'Your students', title: 'for your students', record: 'New best among your students' }
        : one
          ? { subj: one.name, title: `for ${one.name}`, record: `New best for ${one.name}` }
          : { subj: 'You', title: 'for you', record: 'New personal best' };
  const group = scope === 'lab' || scope === 'students';
  useEffect(() => {
    if (!group && tab === 'people') setTab('lab');
  }, [group]);
  useRefresh(loadDash, ['batches', 'iv', 'calendar', 'users']);
  const pickUnit = (u: Unit) => {
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
  const label = periodName(s, unit);
  return (
    <div className="ov">
      <div className="cal-bar">
        <div className="cal-nav">
          <button className="btn secondary" onClick={() => setStart(startOf(new Date(), unit))}>
            This {unit}
          </button>
          <button className="iconbtn" aria-label="Previous" onClick={() => step(-1)}>
            ‹
          </button>
          <button className="iconbtn" aria-label="Next" onClick={() => step(1)}>
            ›
          </button>
          <h2 className="cal-title">{label}</h2>
        </div>
        <div className="grow" />
        {scopes && (scopes.lab || scopes.students > 0) && (
          <Picker
            className="ov-scope narrow"
            label="Whose overview"
            value={scope}
            onChange={(v) => {
              setPerson(null);
              setScope(v);
            }}
            options={[
              { value: 'me', label: 'Mine' },
              ...(scopes.students > 0 ? [{ value: 'students', label: 'My students' }] : []),
              ...(scopes.lab ? [{ value: 'lab', label: 'The lab' }] : []),
              ...(scopes.lab
                ? scopes.people
                    .filter((p) => p.id !== me.id)
                    .map((p) => ({ value: 'user:' + p.id, label: p.name, group: 'A person' }))
                : []),
            ]}
          />
        )}
        <Seg
          value={unit}
          on={pickUnit}
          small
          opts={[
            ['week', 'Week'],
            ['month', 'Month'],
          ]}
        />
      </div>
      {person === null && (
        <Seg
          value={tab}
          on={setTab}
          small
          opts={
            group
              ? [
                  ['lab', 'Summary'],
                  ['people', 'People'],
                  ['equipment', 'Equipment'],
                ]
              : [
                  ['lab', 'Summary'],
                  ['equipment', 'Equipment'],
                ]
          }
        />
      )}
      {err && <p className="err">{err}</p>}
      {person !== null ? (
        <Person id={person} parts={parts} onBack={() => setPerson(null)} open={open} />
      ) : !d ? (
        <p className="mut">Loading…</p>
      ) : tab === 'lab' ? (
        <Summary d={d} who={who} label={label} parts={parts} onPerson={setPerson} open={open} />
      ) : tab === 'people' ? (
        <People d={d} parts={parts} onPerson={setPerson} />
      ) : (
        <Equipment d={d} label={label} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ pieces
/** What a person did in the period, in words: each module's part, then equipment time. */
function doing(p: Person, parts: Part[]) {
  const bits = [
    ...parts.flatMap((x) => x.doing(p.m[x.id] ?? {})),
    p.hours ? `${hrs(p.hours)} on equipment` : '',
  ].filter(Boolean);
  return bits.length ? bits.join(' · ') : 'Nothing this period';
}
const activeIn = (p: Person, parts: Part[]) =>
  p.hours > 0 || parts.some((x) => (x.active ? x.active(p.m[x.id] ?? {}) : x.doing(p.m[x.id] ?? {}).length > 0));
const PersonCard = ({ p, parts, onPerson }: { p: Person; parts: Part[]; onPerson: (id: number) => void }) => (
  <button className="ov-pcard" onClick={() => onPerson(p.id)}>
    <Avatar id={p.id} name={p.name} photoV={p.photoV} size={40} />
    <span className="ov-pcard-t">
      <b>{p.name}</b>
      <span className="mut small">{p.tags.map((t) => t.name).join(', ') || seen(p.last_seen)}</span>
      <span className="ov-pcard-d">{doing(p, parts)}</span>
    </span>
    <span className="ov-chev" aria-hidden>
      ›
    </span>
  </button>
);

// ------------------------------------------------------------------ Summary (the lab and what happened, in one page)
function Summary({
  d,
  who,
  label,
  parts,
  onPerson,
  open,
}: {
  d: Dash;
  who: Who;
  label: string;
  parts: Part[];
  onPerson: (id: number) => void;
  open: Open;
}) {
  const [exporting, setExporting] = useState(false),
    g = d.digest,
    active = d.people.filter((p) => activeIn(p, parts)),
    period = d.unit === 'week' ? 'this week' : 'this month';
  const props = (x: Part) => ({ m: d.m[x.id], d, who, label, open });
  const shown = parts.filter((x) => d.m[x.id]),
    exporter = shown.find((x) => x.Export);
  // the period in one or two plain sentences: each module's, or the equipment time when no module has any
  const lede =
    shown.map((x) => x.lede(d.m[x.id], who, period)).join(' ') ||
    (d.lab.hours ? `${hrs(d.lab.hours)} of equipment time booked ${period}.` : `No equipment booked ${period}.`);
  const attention = g.setbacks.length + g.waiting;
  const stats = shown.flatMap((x) => x.stats(d.m[x.id]));
  return (
    <div className="ov-body">
      <div className="ov-intro">
        <p className="ov-lede">{lede}</p>
        {exporter && (
          <button className="btn secondary small-btn ov-exp-btn" onClick={() => setExporting(true)}>
            Export for a presentation
          </button>
        )}
      </div>
      {shown.map((x) => x.Lead && <x.Lead key={x.id} {...props(x)} />)}
      {stats.length > 0 && <Stats items={stats} />}
      {attention > 0 && (
        <More
          title={[
            g.setbacks.length ? `${plural(g.setbacks.length, 'step')} postponed or canceled` : '',
            g.waiting ? `${plural(g.waiting, 'step')} waiting for an answer` : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        >
          {g.setbacks.length ? (
            <ul className="ov-list">
              {g.setbacks.map((x) => (
                <li key={x.id}>
                  <span className={'oc oc-' + x.outcome}>{x.outcome === 'postponed' ? 'Postponed' : 'Canceled'}</span>
                  <span>
                    {x.user}: {x.equipment}
                    {x.subject ? `, ${x.subject}` : ''}
                    {x.step ? ` (${x.step})` : ''}
                  </span>
                  <span className="mut small">{x.reason}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {g.waiting > 0 && (
            <p className="mut small">
              {g.waiting === 1 ? 'One booked step has ended and its' : `${g.waiting} booked steps have ended and their`}{' '}
              outcome is not filled in yet. The person who booked it is asked when they open the app.
            </p>
          )}
        </More>
      )}
      {shown.map((x) => x.Body && <x.Body key={x.id} {...props(x)} />)}
      <section className="ov-sec">
        <h4 className="ov-h">Who was active</h4>
        {active.length ? (
          <div className="ov-people">
            {active.map((p) => (
              <PersonCard key={p.id} p={p} parts={parts} onPerson={onPerson} />
            ))}
          </div>
        ) : (
          <p className="mut">No activity {period}.</p>
        )}
      </section>
      {shown.some((x) => x.Details) && (
        <section className="ov-sec">
          <h4 className="ov-h">Details</h4>
          {shown.map((x) => x.Details && <x.Details key={x.id} {...props(x)} />)}
        </section>
      )}
      {exporting && exporter?.Export && <exporter.Export {...props(exporter)} onClose={() => setExporting(false)} />}
    </div>
  );
}

// ------------------------------------------------------------------ People and one person's page
function People({ d, parts, onPerson }: { d: Dash; parts: Part[]; onPerson: (id: number) => void }) {
  const on = d.people.filter((p) => doing(p, parts) !== 'Nothing this period'),
    off = d.people.filter((p) => !on.includes(p));
  return (
    <div className="ov-body">
      {on.length > 0 && (
        <section className="ov-sec">
          <h4 className="ov-h">Active this {d.unit}</h4>
          <div className="ov-people">
            {on.map((p) => (
              <PersonCard key={p.id} p={p} parts={parts} onPerson={onPerson} />
            ))}
          </div>
        </section>
      )}
      {off.length > 0 && (
        <section className="ov-sec">
          <h4 className="ov-h">No activity this {d.unit}</h4>
          <div className="ov-people quiet">
            {off.map((p) => (
              <PersonCard key={p.id} p={p} parts={parts} onPerson={onPerson} />
            ))}
          </div>
        </section>
      )}
      <p className="mut small">Open a person to see their progress over all their measurements.</p>
    </div>
  );
}

function Person({ id, parts, onBack, open }: { id: number; parts: Part[]; onBack: () => void; open: Open }) {
  const [p, setP] = useState<PersonPage | null>(null),
    [err, setErr] = useState(''),
    sl = useSlide();
  useEffect(() => {
    api<PersonPage>('/dashboard/person/' + id)
      .then(setP)
      .catch((e) => setErr(e.message));
  }, [id]);
  if (err) return <p className="err">{err}</p>;
  if (!p) return <p className="mut">Loading…</p>;
  const hours = p.hours.reduce((a, x) => a + x.hours, 0),
    shown = parts.filter((x) => p.m[x.id]);
  const slides = shown.map((x) => x.personSlide?.(p.m[x.id])).filter((x) => !!x);
  return (
    <div className="ov-body">
      <button className="link back" onClick={onBack}>
        ‹ Overview
      </button>
      <header className="ov-person">
        <Avatar id={p.id} name={p.name} photoV={p.photoV} size={64} />
        <div>
          <h2>{p.name}</h2>
          <span className="mut">
            {p.tags.map((t) => t.name).join(', ') || `@${p.username}`} · last seen {seen(p.last_seen)}
          </span>
        </div>
        <div className="grow" />
        <SlideButtons
          onMake={(as) =>
            sl.make(
              <SlideFrame
                svgRef={sl.ref}
                title={p.name}
                sub={`${p.tags.map((t) => t.name).join(', ')}${p.tags.length ? ', ' : ''}progress up to ${fmtDate(new Date().toISOString())}`}
              >
                <SlideNumbers items={[...slides.flatMap((x) => x.numbers), ['Equipment', hrs(hours)]]} y={320} />
                {slides.map((x, i) => x.body && <g key={i}>{x.body(520)}</g>)}
              </SlideFrame>,
              `progress-${p.username}`,
              as,
            )
          }
        />
      </header>
      {shown.map((x) => x.Person && <x.Person key={x.id} m={p.m[x.id]} open={open} />)}
      <More title="Equipment time" count={p.hours.length}>
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
      {p.setbacks.length > 0 && (
        <More title="Postponed or canceled steps" count={p.setbacks.length}>
          <ul className="ov-list">
            {p.setbacks.map((s, i) => (
              <li key={i}>
                <span className={'oc oc-' + s.outcome}>{s.outcome === 'postponed' ? 'Postponed' : 'Canceled'}</span>
                <span>
                  {s.equipment}
                  {s.subject ? `, ${s.subject}` : ''}
                  {s.step ? ` (${s.step})` : ''}
                </span>
                <span className="mut small">{s.reason}</span>
              </li>
            ))}
          </ul>
        </More>
      )}
      {sl.holder}
    </div>
  );
}

// ------------------------------------------------------------------ Equipment
function Equipment({ d, label }: { d: Dash; label: string }) {
  const sl = useSlide(),
    max = Math.max(1, ...d.equipment.map((e) => e.hours));
  return (
    <div className="ov-body">
      <div className="ov-intro">
        <p className="ov-lede">
          {d.lab.hours
            ? `${hrs(d.lab.hours)} of equipment time booked ${d.unit === 'week' ? 'this week' : 'this month'}.`
            : `No equipment booked ${d.unit === 'week' ? 'this week' : 'this month'}.`}
        </p>
        <SlideButtons
          onMake={(as) =>
            sl.make(
              <SlideFrame
                svgRef={sl.ref}
                title="Equipment use"
                sub={`${label}, booked hours (share of the lab's working hours)`}
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
          Busy = booked time out of the lab's working hours ({d.lab.workHours} h this {d.unit}, set under Lab setup).
        </p>
      </section>
      {sl.holder}
    </div>
  );
}
