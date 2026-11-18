import { SUBSTRATES, type Rect, type SubKey } from '@psc/devices';
import { DragHandle, RemoveRow, useReorder } from '@web/views/common';
import { Picker, type PickOption } from '@web/views/Picker';

/** Pieces several recipe screens share: a list of timed steps, the substrate drawing, minutes and seconds. */
export type Step = { s: string; m: number };

/**
 * Timed steps in order. `options`: a fixed short list (a select). `pick` (0.58): a list that grows with the lab's data (the
 * inventory's cleaning substances and solutions), searched like every other such list; a name not on it can be typed, and
 * `shown` maps a stored name to the option it means (a step saved as "Isopropanol" is the inventory's 2-Propanol).
 */
export function StepList({
  title,
  list,
  options = [],
  pick,
  shown = (s) => s,
  onChange,
}: {
  title: string;
  list: Step[];
  options?: string[];
  pick?: PickOption[];
  shown?: (s: string) => string;
  onChange: (l: Step[]) => void;
}) {
  const up = (i: number, p: Partial<Step>) => onChange(list.map((y, j) => (j === i ? { ...y, ...p } : y)));
  const { drag, handle, rowRef } = useReorder(list, onChange);
  return (
    <section className="group">
      <h3>{title}</h3>
      {list.map((x, i) => (
        <div
          className={'row step-row' + (pick ? ' pick' : '') + (drag === i ? ' dragging' : '')}
          key={i}
          ref={rowRef(i)}
        >
          {pick ? (
            // a picker is wider than a select: handle, number and picker are cells of the row's grid (0.58)
            <>
              <DragHandle h={handle(i)} show={list.length > 1} />
              <span className="mut">{i + 1}</span>
              <Picker
                value={shown(x.s)}
                options={pick}
                onChange={(s) => up(i, { s })}
                free
                label={`${title}, step ${i + 1}`}
                placeholder="Name, short name or solution"
                empty="Choose what to use"
              />
            </>
          ) : (
            <span className="inline">
              <DragHandle h={handle(i)} show={list.length > 1} />
              <span className="mut">{i + 1}</span>
              <select value={x.s} onChange={(e) => up(i, { s: e.target.value })}>
                {options.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </span>
          )}
          <span className="inline">
            <input type="number" min="0" value={x.m} onChange={(e) => up(i, { m: +e.target.value || 0 })} /> min
            <RemoveRow label={`Remove step ${i + 1}`} onClick={() => onChange(list.filter((_, j) => j !== i))} />
          </span>
        </div>
      ))}
      <button
        className="link"
        onClick={() => onChange([...list, { s: (pick ? pick[0]?.value : options[0]) ?? '', m: 10 }])}
      >
        + Add step
      </button>
    </section>
  );
}

/** Substrate drawing: glass, ITO, optional scrape zone and metal contact. Legend lists only the colors present. */
export function SubstrateImg({
  sub,
  metal = [],
  scrape = [],
  k = 12,
  so = 0.6,
  legend: showLegend = true,
  mc = ['#2ea043', '#888'],
}: {
  sub: SubKey;
  metal?: Rect[];
  scrape?: Rect[];
  k?: number;
  so?: number;
  legend?: boolean;
  mc?: [string, string];
}) {
  const S = SUBSTRATES[sub];
  const r = (x: Rect, c: string, o: number, key: string, st = '#888') => (
    <rect
      key={key}
      x={x[0] * k}
      y={x[1] * k}
      width={x[2] * k}
      height={x[3] * k}
      fill={c}
      opacity={o}
      stroke={st}
      strokeWidth=".5"
    />
  );
  const legend = [
    'blue ITO',
    'grey ITO-free glass',
    metal.length && 'metal contact',
    scrape.length && 'red scrape zone',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <figure style={{ margin: 0 }}>
      <svg
        width={S.w * k}
        height={S.h * k}
        viewBox={`0 0 ${S.w * k} ${S.h * k}`}
        style={{ maxWidth: '100%', height: 'auto' }}
      >
        {r([0, 0, S.w, S.h], 'var(--sep)', 1, 'g')}
        {r(S.ito, '#5b8def', 0.6, 'i')}
        {scrape.map((x, i) => r(x, '#e5484d', so, 's' + i))}
        {metal.map((x, i) => r(x, mc[0], 1, 'm' + i, mc[1]))}
      </svg>
      {showLegend && <figcaption className="mut small">{legend}</figcaption>}
    </figure>
  );
}

export const mmss = (s: number) => (isFinite(s) ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : '—');
