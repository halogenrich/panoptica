import { useEffect, useState } from 'react';
import { fmtAmount, isMass, toBase } from '@psc/core';
import { snapshotUses } from '@psc/devices';
import { api } from '@web/api';
import { useRefresh } from '@web/lib/trash';
import { bottleText, useChems } from '@web/views/common';
import type { Batch, BRun } from './Batches';

/** One amount a batch took from a container, as the server recorded it (0.45). */
type Take = {
  id: number;
  substance: string;
  container_id: number | null;
  mg: number | null;
  ul: number | null;
  amount: number | null;
  unit: string;
  note: string;
  /** 'planned', 'run' (run data) or 'partly' */
  basis: string;
  supplier: string | null;
  lot: string | null;
  purity: number | null;
  place: string | null;
};

const planned = (u: { mg?: number | null; ul?: number | null }) =>
  [u.mg ? fmtAmount(u.mg, 'mg', 4) : '', u.ul ? fmtAmount(u.ul, 'µL', 4) : ''].filter(Boolean).join(' + ');
/** An amount taken, readable whatever the container's unit (0.0182 g → 18.2 mg). */
export const takenText = (v: number, unit: string) => {
  const base = isMass(unit) ? 'mg' : 'µL',
    b = toBase(v, unit, base);
  return b === null ? `${+v.toPrecision(3)} ${unit}` : fmtAmount(b, base, 4);
};

/**
 * What the batch takes from the inventory: before it runs, the amounts its recipes plan and the container each comes from (the
 * one recipes used when it was started); once it runs, what was taken from each container. Trashing the batch puts it back.
 */
/** Where an amount comes from, under it. */
const Basis = ({ v }: { v: string }) =>
  v === 'planned' ? null : <div className="mut">{v === 'run' ? 'From run data' : 'Partly from run data'}</div>;

/** The batch's run data by recipe id: for each value, the latest entry that gives it (as the server reads them). */
function runsBy(runs: BRun[]) {
  const out: Record<string, Record<string, string>> = {};
  for (const r of [...runs].sort((x, y) => x.id - y.id)) {
    const to = (out[String(r.preset_id)] ??= {});
    for (const [k, v] of Object.entries(r.values ?? {})) if (String(v ?? '').trim()) to[k] = String(v);
  }
  return out;
}

export function BatchTakes({ b, runs }: { b: Batch; runs: BRun[] }) {
  const [takes, setTakes] = useState<Take[] | null>(null);
  // short names (0.54.1): the batch's, else the inventory's for a batch started before
  const live = useChems();
  const short = (name: string) => {
    const l = name.toLowerCase();
    return (
      (b.snapshot.chems as { name: string; s?: string }[]).find((c) => c.name.toLowerCase() === l)?.s ||
      live.find((c) => c.name.toLowerCase() === l)?.s ||
      name
    );
  };
  const started = b.status !== 'planned',
    counts = !!(b.snapshot as { takes?: boolean }).takes;
  const load = () => {
    if (!started || !counts) return;
    api<Take[]>(`/inventory/draws/batch/${b.id}`)
      .then(setTakes)
      .catch(() => setTakes([]));
  };
  useEffect(load, [b.id, b.status]);
  useRefresh(load, ['inventory', 'batches']);
  if (!counts)
    return (
      <section className="group">
        <h3>From the inventory</h3>
        <p className="mut small">
          Started before batches took their amounts from the containers: nothing was taken. Consumption still counts it.
        </p>
      </section>
    );
  const plan = snapshotUses(b.snapshot as Parameters<typeof snapshotUses>[0], runsBy(runs)).filter((u) => u.mg || u.ul);
  // the same substance from several recipes is one line
  const sum = new Map<string, { name: string; mg: number; ul: number; parts: number; runs: number }>();
  for (const u of plan) {
    const k = u.name.toLowerCase(),
      s = sum.get(k) ?? { name: u.name, mg: 0, ul: 0, parts: 0, runs: 0 };
    s.mg += u.mg ?? 0;
    s.ul += u.ul ?? 0;
    s.parts++;
    if (u.run) s.runs++;
    sum.set(k, s);
  }
  const bottleOf = (name: string) =>
    (
      b.snapshot.chems as { name: string; bottle?: { supplier: string; lot: string; purity: number | null } | null }[]
    ).find((c) => c.name.toLowerCase() === name.toLowerCase())?.bottle ?? null;
  return (
    <section className="group">
      <h3>From the inventory</h3>
      {!started ? (
        <>
          <p className="mut small">
            Taken from these containers when the batch starts running: what its run data say was weighed and dispensed,
            else the amounts its recipes plan (solutions as prepared, solvents dispensed in spin programs). Moving the
            batch to the trash puts them back.
          </p>
          {sum.size ? (
            <table className="list small takes">
              <thead>
                <tr>
                  <th>Substance</th>
                  <th>Amount</th>
                  <th>From</th>
                </tr>
              </thead>
              <tbody>
                {[...sum.values()]
                  .sort((x, y) => x.name.localeCompare(y.name))
                  .map((s) => {
                    const bt = bottleOf(s.name);
                    return (
                      <tr key={s.name}>
                        <td title={s.name}>{short(s.name)}</td>
                        <td className="nowrap">
                          {planned(s)}
                          <Basis v={!s.runs ? 'planned' : s.runs === s.parts ? 'run' : 'partly'} />
                        </td>
                        <td>
                          {bt ? (
                            bottleText(bt as any)
                          ) : (
                            <span className="err">Not in stock yet: taken from the one recipes use once it runs</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          ) : (
            <p className="mut">Its recipes take nothing counted from the inventory.</p>
          )}
        </>
      ) : !takes ? (
        <p className="mut small">Reading what it took…</p>
      ) : takes.length ? (
        <>
          <p className="mut small">
            Taken when the batch started running: what its run data say was weighed and dispensed, else what its recipes
            planned. Entering run data takes the new amounts instead. The containers’ amounts went down by these; moving
            the batch to the trash puts them back.
          </p>
          <table className="list small takes">
            <thead>
              <tr>
                <th>Substance</th>
                <th>Taken</th>
                <th>From</th>
              </tr>
            </thead>
            <tbody>
              {takes.map((t) => (
                <tr key={t.id}>
                  <td title={t.substance}>{short(t.substance)}</td>
                  <td className="nowrap">
                    {t.amount !== null ? takenText(t.amount, t.unit) : '—'}
                    <Basis v={t.basis} />
                  </td>
                  <td>
                    {t.container_id && t.supplier !== null ? (
                      <>
                        {bottleText({ supplier: t.supplier, lot: t.lot ?? '', purity: t.purity } as any)}
                        {t.place && <span className="mut"> · {t.place}</span>}
                      </>
                    ) : t.container_id ? (
                      <span className="mut">A container since deleted</span>
                    ) : null}
                    {t.note && (
                      <div className={t.amount === null ? 'err' : 'mut'}>
                        {t.amount === null
                          ? `Not taken: ${t.note} (${planned(t)} needed)`
                          : `All it held: ${planned(t)} needed`}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="mut">Its recipes took nothing counted from the inventory.</p>
      )}
    </section>
  );
}
