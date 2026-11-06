import { describeChanges, type Variants } from '@psc/core';
import { SlotSheet } from '../views/Sheets';
import type { Ctx } from '../recipes/types';
import type { StackD } from './model';

/** Printable run sheet: one block per layer with the recipe output, blank write-in cells and a notes box. */
export default function RunSheet({
  st,
  ctx,
  name,
  batch,
  variants,
}: {
  st: StackD;
  ctx: Ctx;
  name: string;
  batch?: string;
  variants?: Variants;
}) {
  const data = (id: string) => (id ? ctx.all.find((p) => String(p.id) === id)?.data : undefined);
  return (
    <section className="sheet">
      <h2>
        {name} · {st.arch}
      </h2>
      <p>
        Batch {batch || <span className="bl" />} · Date <span className="bl" /> · Operator <span className="bl" /> ·
        Substrates <span className="bl" />
      </p>
      {!!variants?.list.length && (
        <table className="sheet-variants">
          <thead>
            <tr>
              <th>Variant</th>
              <th>Substrates</th>
              <th>What changes</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Default device</td>
              <td>{variants.control}</td>
              <td>—</td>
            </tr>
            {variants.list.map((v) => (
              <tr key={v.id}>
                <td>{v.name}</td>
                <td>{v.substrates}</td>
                <td>{describeChanges(v, st.sl).join('; ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {st.sl.map((x, i) => (
        <div className="slot" key={x.id ?? i}>
          <h3>
            ☐ {i + 1}. {x.n}{' '}
            <small>
              ({x.m}
              {x.th ? `, ${x.th} nm` : ''})
            </small>
          </h3>
          <SlotSheet m={x.m} a={data(x.a)} b={data(x.b)} t={x.t} ctx={ctx} />
          <div className="notes">Notes / data</div>
        </div>
      ))}
    </section>
  );
}
