import { useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { abilities } from '@psc/core';
import type { StepDef } from './Calendar';
import { api } from '../api';
import { MeCtx } from '../ctx';
import Avatar from '../lib/Avatar';
import EquipmentArt, { ARTS, artOf, type ArtKind } from '../lib/EquipmentArt';
import { useItemRoute } from '../lib/route';
import { useRefresh } from '../lib/trash';
import { Empty, Modal, fmtDate, fmtDateTime } from '../lib/ui';
import { DragHandle, useReorder } from './common';

export type EqRow = {
  id: number;
  name: string;
  color: string;
  role: string;
  art?: string;
  pos: number;
  active: boolean;
  booked: boolean;
  atmosphere: boolean;
  cleanup: number;
  min_booking: number;
  steps: string[];
  parent_id: number | null;
  place_id: number | null;
  people: { id: number; name: string; photoV?: number }[];
  trainedCount: number;
};
type Place = { id: number; name: string; pos: number };
type Data = {
  /** the steps equipment can do, from the modules (0.41) */
  steps: StepDef[];
  places: Place[];
  equipment: EqRow[];
  trained: number[];
  can: { manage: boolean };
};
type Person = { id: number; name: string; username: string; photoV?: number };
type Detail = EqRow & {
  trained: { id: number; name: string; photoV?: number; at: string; note: string; by: string | null }[];
  moves: { at: string; place: string | null; inside: string | null; by: string | null }[];
  off: { id: number; start: string; end: string; reason: string; by: string | null }[];
  can: { edit: boolean; train: boolean; manage: boolean };
};

const hmin = (m: number) =>
  m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} hour${m === 60 ? '' : 's'}`;
/** Steps grouped as their module groups them, for the toggles. */
const groupsOf = (defs: StepDef[]) =>
  [...new Set(defs.map((s) => s.group))].map((g) => ({ g, steps: defs.filter((s) => s.group === g) }));
const labelOf = (defs: StepDef[]) => (k: string) => defs.find((s) => s.key === k)?.label ?? k;

/**
 * Lab › Equipment: the lab's places and what is in them. Each equipment says what it can do (recipe steps), whether it is
 * booked by itself, who is responsible for it and who is trained on it. Click one for everything about it.
 */
export default function EquipmentPage({
  openId,
  onOpen,
}: {
  openId: number | null;
  onOpen: (id: number | null) => void;
}) {
  const [d, setD] = useState<Data | null>(null),
    [err, setErr] = useState(''),
    [adding, setAdding] = useState<null | { parent?: number; place?: number | null }>(null),
    [newPlace, setNewPlace] = useState('');
  const load = () =>
    api<Data>('/equipment')
      .then(setD)
      .catch((e) => setErr(e.message));
  useEffect(() => {
    load();
  }, []);
  useRefresh(load, ['equipment', 'calendar']);
  // the order of booked equipment is the order of the calendar's columns; dragged here, saved when the dragging pauses
  const [local, setLocal] = useState<EqRow[] | null>(null),
    saveT = useRef(0);
  const all = local ?? d?.equipment ?? [];
  const order = useReorder(
    all,
    (l) => {
      setLocal(l);
      window.clearTimeout(saveT.current);
      saveT.current = window.setTimeout(
        () =>
          api('/equipment/order', 'PUT', { ids: l.map((x) => x.id) })
            .then(load)
            .finally(() => setLocal(null)),
        500,
      );
    },
    'equipment',
  );
  if (!d) return <p className="mut">{err || 'Loading…'}</p>;
  const groups: { place: Place | null; items: EqRow[] }[] = [
    ...d.places.map((p) => ({ place: p, items: all.filter((e) => !e.parent_id && e.place_id === p.id) })),
    { place: null, items: all.filter((e) => !e.parent_id && !d.places.some((p) => p.id === e.place_id)) },
  ].filter((g) => g.place || g.items.length);
  const row = (e: EqRow, depth: number) => {
    const i = all.indexOf(e),
      inside = all.filter((x) => x.parent_id === e.id),
      can = abilities(e, all),
      trained = d.trained.includes(e.id);
    return (
      <li key={e.id} className={'eq-item' + (order.drag === i ? ' dragging' : '')} ref={order.rowRef(i)}>
        <div className="eq-line" style={{ '--eq': e.color, paddingLeft: depth * 28 } as React.CSSProperties}>
          {d.can.manage && depth === 0 ? <DragHandle h={order.handle(i)} show={all.length > 1} /> : <span />}
          <button className="eq-open" onClick={() => onOpen(e.id)}>
            <span className="eq-art-cell">
              <EquipmentArt kind={artOf(e)} size={depth ? 34 : 44} />
            </span>
            <span className="eq-text">
              <b className="eq-name">{e.name}</b>
              <span className="mut small">
                {can.size ? [...can].map(labelOf(d.steps)).join(' · ') : 'Nothing set up for the recipes'}
              </span>
            </span>
          </button>
          <span className="eq-facts small">
            {!e.active ? (
              <span className="mut">Hidden</span>
            ) : !e.booked ? (
              <span className="mut">{e.parent_id ? 'Booked with what holds it' : 'Not booked'}</span>
            ) : (
              <>
                <span className={trained ? 'ok' : 'mut'}>{trained ? 'You are trained' : 'Not trained'}</span>
                <span className="mut">
                  {e.people.length ? `Responsible: ${e.people.map((p) => p.name).join(', ')}` : 'No one responsible'}
                </span>
              </>
            )}
          </span>
        </div>
        {inside.length > 0 && <ul className="eq-list">{inside.map((x) => row(x, depth + 1))}</ul>}
      </li>
    );
  };
  return (
    <div className="eq-page">
      <div className="lib-bar">
        <p className="mut small grow">
          What each equipment can do decides what the batch scheduler books it for. Booked equipment needs training; its
          responsible people train others, move it and set it out of service.
        </p>
        {d.can.manage && (
          <>
            <form
              className="inline"
              onSubmit={(e) => {
                e.preventDefault();
                api('/places', 'POST', { name: newPlace.trim() })
                  .then(() => {
                    setNewPlace('');
                    load();
                  })
                  .catch((x) => setErr(x.message));
              }}
            >
              <input
                aria-label="New place"
                placeholder="New place (for example Clean room)"
                value={newPlace}
                onChange={(e) => setNewPlace(e.target.value)}
              />
              <button className="btn secondary" disabled={!newPlace.trim()}>
                Add place
              </button>
            </form>
            <button className="btn" onClick={() => setAdding({})}>
              New equipment
            </button>
          </>
        )}
      </div>
      {err && <p className="err">{err}</p>}
      {!all.length ? (
        <Empty
          title="No equipment yet"
          text={
            d.can.manage
              ? 'Add the lab’s places, then its equipment: gloveboxes, and what is inside them.'
              : 'An admin or someone with Equipment management adds the lab’s equipment.'
          }
        />
      ) : (
        groups.map((g) => (
          <section key={g.place?.id ?? 'none'} className="group eq-place">
            <div className="eq-place-head">
              {g.place && d.can.manage ? (
                <PlaceName place={g.place} reload={load} onErr={setErr} empty={!g.items.length} />
              ) : (
                <h3>{g.place?.name ?? (d.places.length ? 'Not in a place' : 'Equipment')}</h3>
              )}
            </div>
            {g.items.length ? (
              <ul className="eq-list">{g.items.map((e) => row(e, 0))}</ul>
            ) : (
              <p className="mut small">Nothing here yet.</p>
            )}
          </section>
        ))
      )}
      {adding && (
        <NewEquipment
          data={d}
          onClose={() => setAdding(null)}
          onDone={(id) => {
            setAdding(null);
            load();
            onOpen(id);
          }}
        />
      )}
      {openId && (
        <EquipmentSheet
          id={openId}
          data={d}
          onClose={() => {
            onOpen(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function PlaceName({
  place,
  reload,
  onErr,
  empty,
}: {
  place: Place;
  reload: () => void;
  onErr: (s: string) => void;
  empty: boolean;
}) {
  return (
    <div className="inline grow">
      <input
        className="eq-place-name"
        aria-label="Place name"
        defaultValue={place.name}
        onBlur={(e) =>
          e.target.value.trim() &&
          e.target.value.trim() !== place.name &&
          api('/places/' + place.id, 'PATCH', { name: e.target.value.trim() })
            .then(reload)
            .catch((x) => onErr(x.message))
        }
      />
      {empty && (
        <button
          className="link small danger-link"
          onClick={() =>
            api('/places/' + place.id, 'DELETE')
              .then(reload)
              .catch((x) => onErr(x.message))
          }
        >
          Remove place
        </button>
      )}
    </div>
  );
}

/** Where an equipment is: a place, or inside other equipment. */
function WhereSelect({
  data,
  self,
  value,
  onChange,
}: {
  data: Data;
  self?: number;
  value: { place_id: number | null; parent_id: number | null };
  onChange: (v: { place_id: number | null; parent_id: number | null }) => void;
}) {
  const v = value.parent_id ? `e${value.parent_id}` : value.place_id ? `p${value.place_id}` : '';
  return (
    <select
      value={v}
      onChange={(e) => {
        const x = e.target.value;
        onChange(
          x.startsWith('e')
            ? { place_id: null, parent_id: +x.slice(1) }
            : { place_id: x ? +x.slice(1) : null, parent_id: null },
        );
      }}
    >
      <option value="">No place</option>
      {data.places.length > 0 && (
        <optgroup label="In a place">
          {data.places.map((p) => (
            <option key={p.id} value={`p${p.id}`}>
              {p.name}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label="Inside other equipment">
        {data.equipment
          .filter((e) => e.id !== self)
          .map((e) => (
            <option key={e.id} value={`e${e.id}`}>
              {e.name}
            </option>
          ))}
      </optgroup>
    </select>
  );
}

function StepToggles({
  defs,
  value,
  on,
  disabled,
}: {
  defs: StepDef[];
  value: string[];
  on: (v: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="step-groups">
      {groupsOf(defs).map(({ g, steps }) => (
        <div key={g} className="step-group">
          <span className="mut small">{g}</span>
          <div className="chips" role="group" aria-label={g}>
            {steps.map((s) => {
              const onNow = value.includes(s.key);
              return (
                <button
                  key={s.key}
                  type="button"
                  className={'chip' + (onNow ? ' on' : '')}
                  aria-pressed={onNow}
                  disabled={disabled}
                  onClick={() => on(onNow ? value.filter((x) => x !== s.key) : [...value, s.key])}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function NewEquipment({ data, onClose, onDone }: { data: Data; onClose: () => void; onDone: (id: number) => void }) {
  const [name, setName] = useState(''),
    [color, setColor] = useState('#2563eb'),
    [where, setWhere] = useState<{ place_id: number | null; parent_id: number | null }>({
      place_id: data.places[0]?.id ?? null,
      parent_id: null,
    }),
    [steps, setSteps] = useState<string[]>([]),
    [err, setErr] = useState('');
  return (
    <Modal onClose={onClose} className="eq-new">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          api<{ id: number }>('/equipment', 'POST', { name: name.trim(), color, steps, ...where })
            .then((r) => onDone(r.id))
            .catch((x) => setErr(x.message));
        }}
      >
        <div className="modal-head">
          <b>New equipment</b>
        </div>
        <div className="eq-form">
          <div className="inline">
            <input type="color" aria-label="Colour" value={color} onChange={(e) => setColor(e.target.value)} />
            <label className="fld grow">
              <span>Name</span>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="For example, Glovebox 1"
              />
            </label>
          </div>
          <label className="fld">
            <span>Where it is</span>
            <WhereSelect data={data} value={where} onChange={setWhere} />
          </label>
          {where.parent_id ? (
            <p className="mut small">Inside other equipment it is booked with it, not on its own.</p>
          ) : null}
          <div className="fld">
            <span>What it can do</span>
            <StepToggles defs={data.steps} value={steps} on={setSteps} />
            <span className="mut small">
              A glovebox can stay empty here: what it can do comes from the equipment you put inside it.
            </span>
          </div>
          {err && <p className="err small">{err}</p>}
          <div className="dialog-actions">
            <button type="button" className="link" onClick={onClose}>
              Cancel
            </button>
            <button className="btn" disabled={!name.trim()}>
              Add equipment
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/** Everything about one equipment; what the viewer may change is editable, the rest is shown. */
function EquipmentSheet({ id, data, onClose }: { id: number; data: Data; onClose: () => void }) {
  useItemRoute('eq', id);
  const { me } = useContext(MeCtx);
  const [e, setE] = useState<Detail | null>(null),
    [err, setErr] = useState(''),
    [people, setPeople] = useState<Person[]>([]),
    [moving, setMoving] = useState<{ place_id: number | null; parent_id: number | null } | null>(null),
    [off, setOff] = useState({ start: '', end: '', reason: '' }),
    [trainee, setTrainee] = useState(''),
    [pickResp, setPickResp] = useState(false);
  const load = () =>
    api<Detail>('/equipment/' + id)
      .then(setE)
      .catch((x) => setErr(x.message));
  useEffect(() => {
    load();
    api<Person[]>('/people')
      .then(setPeople)
      .catch(() => {});
  }, [id]);
  if (!e)
    return (
      <Modal onClose={onClose} wide>
        <p className="mut pad-x">{err || 'Loading…'}</p>
      </Modal>
    );
  const run = (p: Promise<unknown>) =>
    p
      .then(() => {
        setErr('');
        load();
      })
      .catch((x) => setErr(x.message));
  const patch = (b: object) => run(api('/equipment/' + id, 'PATCH', b));
  const ed = e.can.edit,
    inside = data.equipment.filter((x) => x.parent_id === id),
    can = abilities(e, data.equipment),
    holder = data.equipment.find((x) => x.id === e.parent_id),
    place = data.places.find((p) => p.id === e.place_id),
    untrained = people.filter((p) => !e.trained.some((t) => t.id === p.id));
  return (
    <Modal onClose={onClose} wide className="eq-sheet">
      <div className="modal-head">
        <span className="eq-art-cell" style={{ '--eq': e.color } as React.CSSProperties}>
          {ed ? <ArtPick eq={e} onPick={(art) => patch({ art })} /> : <EquipmentArt kind={artOf(e)} size={44} />}
        </span>
        <div className="title-block grow">
          {ed ? (
            <input
              className="eq-title"
              aria-label="Name"
              defaultValue={e.name}
              onBlur={(x) =>
                x.target.value.trim() && x.target.value.trim() !== e.name && patch({ name: x.target.value.trim() })
              }
            />
          ) : (
            <h2>{e.name}</h2>
          )}
          <div className="mut small">
            {holder ? `Inside ${holder.name}` : place ? place.name : 'No place'}
            {e.booked ? '' : ' · not booked by itself'}
            {e.active ? '' : ' · hidden'}
          </div>
        </div>
        {ed && (
          <input
            type="color"
            aria-label={`Colour of ${e.name}`}
            defaultValue={e.color}
            onChange={(x) => patch({ color: x.target.value })}
          />
        )}
        <button className="iconbtn" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="modal-body eq-body">
        {err && <p className="err">{err}</p>}
        <section className="group">
          <h3>What it can do</h3>
          <StepToggles defs={data.steps} value={e.steps} on={(steps) => patch({ steps })} disabled={!ed} />
          {inside.length > 0 && (
            <p className="small">
              Inside it: {inside.map((x) => x.name).join(', ')}. With them it can do:{' '}
              {[...can].map(labelOf(data.steps)).join(', ') || 'nothing yet'}.
            </p>
          )}
        </section>
        <section className="group">
          <h3>Booking</h3>
          <label className="inline">
            <input
              type="checkbox"
              checked={e.booked}
              disabled={!ed || !!e.parent_id}
              onChange={(x) => patch({ booked: x.target.checked })}
            />
            Booked in the calendar{' '}
            <span className="mut small">
              {e.parent_id ? '(inside other equipment: booked with it)' : '(off: used freely, only recorded)'}
            </span>
          </label>
          {e.booked && (
            <div className="eq-nums">
              <label className="fld">
                <span>Shortest booking</span>
                <select value={e.min_booking} disabled={!ed} onChange={(x) => patch({ min_booking: +x.target.value })}>
                  {[15, 30, 45, 60, 90, 120, 180, 240].map((m) => (
                    <option key={m} value={m}>
                      {hmin(m)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="fld">
                <span>Cleanup after each booking</span>
                <select value={e.cleanup} disabled={!ed} onChange={(x) => patch({ cleanup: +x.target.value })}>
                  {[0, 5, 10, 15, 20, 30, 45, 60].map((m) => (
                    <option key={m} value={m}>
                      {m ? `${m} min` : 'None'}
                    </option>
                  ))}
                </select>
              </label>
              <label className="inline">
                <input
                  type="checkbox"
                  checked={e.atmosphere}
                  disabled={!ed}
                  onChange={(x) => patch({ atmosphere: x.target.checked })}
                />
                Record O₂ and H₂O (ppm) after each booking
              </label>
            </div>
          )}
          {ed && (
            <label className="inline">
              <input type="checkbox" checked={!e.active} onChange={(x) => patch({ active: !x.target.checked })} />
              Hide it (no longer shown in the calendar and pickers)
            </label>
          )}
        </section>
        <section className="group">
          <h3>Where it is</h3>
          {moving ? (
            <div className="inline">
              <WhereSelect data={data} self={id} value={moving} onChange={setMoving} />
              <button
                className="btn"
                onClick={() => run(api(`/equipment/${id}/move`, 'POST', moving).then(() => setMoving(null)))}
              >
                Move
              </button>
              <button className="link" onClick={() => setMoving(null)}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="inline">
              <span>{holder ? `Inside ${holder.name}` : place ? place.name : 'No place'}</span>
              {ed && (
                <button className="link" onClick={() => setMoving({ place_id: e.place_id, parent_id: e.parent_id })}>
                  Move it
                </button>
              )}
            </div>
          )}
          {e.moves.length > 0 && (
            <ul className="eq-history small">
              {e.moves.map((m, i) => (
                <li key={i}>
                  {fmtDateTime(m.at)}: {m.inside ? `into ${m.inside}` : m.place ? `to ${m.place}` : 'out of any place'}
                  {m.by ? ` · ${m.by}` : ''}
                </li>
              ))}
            </ul>
          )}
        </section>
        {e.booked && (
          <>
            <section className="group">
              <h3>Responsible</h3>
              <div className="eq-people">
                {e.people.length ? (
                  e.people.map((p) => (
                    <span key={p.id} className="eq-person">
                      <Avatar id={p.id} name={p.name} photoV={p.photoV} size={28} /> {p.name}
                    </span>
                  ))
                ) : (
                  <span className="mut">No one yet.</span>
                )}
              </div>
              {e.can.manage &&
                (pickResp ? (
                  <PeoplePick
                    people={people}
                    value={e.people.map((p) => p.id)}
                    onCancel={() => setPickResp(false)}
                    onSave={(ids) => run(api(`/equipment/${id}/people`, 'PUT', { ids }).then(() => setPickResp(false)))}
                  />
                ) : (
                  <button className="link" onClick={() => setPickResp(true)}>
                    Choose who is responsible
                  </button>
                ))}
              <p className="mut small">
                They train people on it, change its settings, move it and set it out of service, and hear about bookings
                outside working hours.
              </p>
            </section>
            <section className="group">
              <h3>Trained</h3>
              {e.trained.length ? (
                <ul className="eq-trained">
                  {e.trained.map((t) => (
                    <li key={t.id}>
                      <Avatar id={t.id} name={t.name} photoV={t.photoV} size={28} />
                      <span className="grow">
                        {t.name}
                        <span className="mut small">
                          {' '}
                          · {fmtDate(t.at)}
                          {t.by ? `, by ${t.by}` : t.note ? `, ${t.note}` : ''}
                        </span>
                      </span>
                      {e.can.train && (
                        <button
                          className="link small danger-link"
                          onClick={() => run(api(`/equipment/${id}/training/${t.id}`, 'DELETE'))}
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mut">No one yet: only admins can book it.</p>
              )}
              {e.can.train && (
                <div className="inline">
                  <select
                    aria-label="Person to mark as trained"
                    value={trainee}
                    onChange={(x) => setTrainee(x.target.value)}
                  >
                    <option value="">Choose a person…</option>
                    {untrained.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.id === me.id ? ' (you)' : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn secondary"
                    disabled={!trainee}
                    onClick={() =>
                      run(api(`/equipment/${id}/training/${trainee}`, 'POST', {}).then(() => setTrainee('')))
                    }
                  >
                    Mark as trained
                  </button>
                </div>
              )}
            </section>
            <section className="group">
              <h3>Out of service</h3>
              {e.off.length ? (
                <ul className="eq-history">
                  {e.off.map((o) => (
                    <li key={o.id}>
                      {fmtDateTime(o.start)} – {fmtDateTime(o.end)}
                      {o.reason ? `: ${o.reason}` : ''}
                      {o.by ? <span className="mut small"> · {o.by}</span> : null}{' '}
                      {ed && (
                        <button className="link small" onClick={() => run(api(`/equipment/off/${o.id}`, 'DELETE'))}>
                          End it
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mut">In service.</p>
              )}
              {ed && (
                <form
                  className="eq-off"
                  onSubmit={(x) => {
                    x.preventDefault();
                    run(
                      api(`/equipment/${id}/off`, 'POST', {
                        start: new Date(off.start).toISOString(),
                        end: new Date(off.end).toISOString(),
                        reason: off.reason,
                      }).then(() => setOff({ start: '', end: '', reason: '' })),
                    );
                  }}
                >
                  <label className="fld">
                    <span>From</span>
                    <input
                      type="datetime-local"
                      value={off.start}
                      onChange={(x) => setOff({ ...off, start: x.target.value })}
                    />
                  </label>
                  <label className="fld">
                    <span>Until</span>
                    <input
                      type="datetime-local"
                      value={off.end}
                      onChange={(x) => setOff({ ...off, end: x.target.value })}
                    />
                  </label>
                  <label className="fld grow">
                    <span>Why</span>
                    <input
                      value={off.reason}
                      placeholder="For example maintenance"
                      onChange={(x) => setOff({ ...off, reason: x.target.value })}
                    />
                  </label>
                  <button className="btn secondary" disabled={!off.start || !off.end}>
                    Set out of service
                  </button>
                </form>
              )}
              {ed && (
                <p className="mut small">
                  The calendar shows the period and refuses bookings in it; people already booked then are told.
                </p>
              )}
            </section>
          </>
        )}
        {e.can.manage && (
          <p>
            <button
              className="link danger-link"
              onClick={() =>
                window.confirm(`Remove ${e.name}? Its past bookings are removed too.`) &&
                api('/equipment/' + id, 'DELETE')
                  .then(onClose)
                  .catch((x) => setErr(x.message))
              }
            >
              Remove equipment
            </button>
          </p>
        )}
      </div>
    </Modal>
  );
}

function PeoplePick({
  people,
  value,
  onSave,
  onCancel,
}: {
  people: Person[];
  value: number[];
  onSave: (ids: number[]) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(value),
    [q, setQ] = useState('');
  const shown = people.filter((p) => (p.name + ' ' + p.username).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="people-pick">
      <input type="search" placeholder="Find a person" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul>
        {shown.map((p) => (
          <li key={p.id}>
            <label className="inline">
              <input
                type="checkbox"
                checked={v.includes(p.id)}
                onChange={(e) => setV(e.target.checked ? [...v, p.id] : v.filter((x) => x !== p.id))}
              />
              <Avatar id={p.id} name={p.name} photoV={p.photoV} size={24} /> {p.name}{' '}
              <span className="mut small">@{p.username}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="dialog-actions">
        <button className="link" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn" onClick={() => onSave(v)}>
          Save
        </button>
      </div>
    </div>
  );
}

/** The drawing of one equipment: the current one, a click away from the others ("Automatic" follows its use and name). */
export function ArtPick({
  eq,
  onPick,
}: {
  eq: { name: string; role: string; color: string; art?: string };
  onPick: (art: string) => void;
}) {
  const [open, setOpen] = useState<DOMRect | null>(null),
    ref = useRef<HTMLSpanElement>(null),
    menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const f = (e: MouseEvent) =>
      !ref.current?.contains(e.target as Node) && !menu.current?.contains(e.target as Node) && setOpen(null);
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(null);
      }
    };
    document.addEventListener('mousedown', f);
    document.addEventListener('keydown', k, true);
    return () => {
      document.removeEventListener('mousedown', f);
      document.removeEventListener('keydown', k, true);
    };
  }, [open]);
  const auto = artOf({ name: eq.name, role: eq.role });
  return (
    <span className="eq-art-cell" ref={ref} style={{ '--eq': eq.color } as React.CSSProperties}>
      <button
        type="button"
        className="art-btn"
        aria-label={`Drawing of ${eq.name}`}
        aria-expanded={!!open}
        aria-haspopup="listbox"
        onClick={(e) => setOpen(open ? null : e.currentTarget.getBoundingClientRect())}
      >
        <EquipmentArt kind={artOf(eq)} size={44} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            className="art-menu"
            role="listbox"
            aria-label={`Drawing of ${eq.name}`}
            style={
              {
                '--eq': eq.color,
                left: Math.min(open.left - 8, window.innerWidth - 384),
                top: open.bottom + 380 < window.innerHeight ? open.bottom + 4 : Math.max(8, open.top - 384),
              } as React.CSSProperties
            }
          >
            {[['', `Automatic (${ARTS.find(([k]) => k === auto)?.[1]})`] as [string, string], ...ARTS].map(([k, l]) => (
              <button
                key={k || 'auto'}
                type="button"
                role="option"
                aria-selected={(eq.art ?? '') === k}
                className={(eq.art ?? '') === k ? 'on' : ''}
                onClick={() => {
                  onPick(k);
                  setOpen(null);
                }}
              >
                <EquipmentArt kind={(k || auto) as ArtKind} size={44} />
                <span>{l}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </span>
  );
}
