import { useEffect, useState } from 'react';
import { fmtAmount, isMass, toBase } from '@psc/core';
import { snapshotUses } from '@psc/devices';
import { api } from '@web/api';
import { useRefresh } from '@web/lib/trash';
import { bottleText } from '@web/views/common';
import type { Batch } from './Batches';

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
  supplier: string | null;
  lot: string | null;
  purity: number | null;
  place: string | null;
};

const planned = (u: { mg?: number | null; ul?: number | null }) =>
  [u.mg ? fmtAmount(u.mg, 'mg') : '', u.ul ? fmtAmount(u.ul, 'µL') : ''].filter(Boolean).join(' + ');
/** An amount taken, readable whatever the container's unit (0.0182 g → 18.2 mg). */
export const takenText = (v: number, unit: string) => {
  const base = isMass(unit) ? 'mg' : 'µL',
    b = toBase(v, unit, base);
  return b === null ? `${+v.toPrecision(3)} ${unit}` : fmtAmount(b, base);
};

/**
 * What the batch takes from the inventory: before it runs, the amounts its recipes plan and the container each comes from (the
 * one recipes used when it was started); once it runs, what was taken from each container. Trashing the batch puts it back.
 */
export function BatchTakes({ b }: { b: Batch }) {
  const [takes, setTakes] = useState<Take[] | null>(null);
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
  const plan = snapshotUses(b.snapshot as Parameters<typeof snapshotUses>[0]).filter((u) => u.mg || u.ul);
  // the same substance from several recipes is one line
  const sum = new Map<string, { name: string; mg: number; ul: number; box: number | null }>();
  for (const u of plan) {
    const k = u.name.toLowerCase(),
      s = sum.get(k) ?? { name: u.name, mg: 0, ul: 0, box: u.box ?? null };
    s.mg += u.mg ?? 0;
    s.ul += u.ul ?? 0;
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
            Taken from these containers when the batch starts running: the amounts its recipes plan (solutions as
            prepared, solvents dispensed in spin programs). Moving the batch to the trash puts them back.
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
                        <td>{s.name}</td>
                        <td className="nowrap">{planned(s)}</td>
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
            Taken when the batch started running. The containers’ amounts went down by these; moving the batch to the
            trash puts them back.
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
                  <td>{t.substance}</td>
                  <td className="nowrap">{t.amount !== null ? takenText(t.amount, t.unit) : '—'}</td>
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
                          ? `Not taken: ${t.note} (${planned(t)} planned)`
                          : `All it held: the recipes planned ${planned(t)}`}
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
