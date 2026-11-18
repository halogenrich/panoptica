import { DragHandle, RemoveRow, useReorder } from '@web/views/common';
import { Seg } from '@web/lib/ui';
import { Section } from '../recipes/shared';
import type { Kind } from '../recipes/types';
import { METHODS, methodName, type Method } from '../stacks/model';

/**
 * An architecture (0.58): the layers a stack starts with, in order, and whether the device is p-i-n or n-i-p (J–V figures
 * state it). Stored bottom first, the substrate always at the bottom; shown top first, as the stack builder lists layers.
 * Picking one in the stack builder sets the stack's layers; stacks made from it keep their own after it changes.
 */
export type ArchLayer = { n: string; m: Method };
export type ArchD = { pol: 'p-i-n' | 'n-i-p'; layers: ArchLayer[] };

const defaults = (): ArchD => ({
  pol: 'p-i-n',
  layers: [
    { n: 'Substrate', m: 'Substrate' },
    { n: 'Metal contact', m: 'Metal evap' },
  ],
});
/** The substrate first, whatever was saved. */
export const archNorm = (d: Partial<ArchD>): ArchD => {
  const l = (d.layers ?? []).filter((x) => x && typeof x.n === 'string');
  const sub = l.find((x) => x.m === 'Substrate') ?? { n: 'Substrate', m: 'Substrate' as Method };
  return {
    pol: d.pol === 'n-i-p' ? 'n-i-p' : 'p-i-n',
    layers: [sub, ...l.filter((x) => x !== sub && x.m !== 'Substrate')],
  };
};
const LAYER_METHODS = METHODS.filter((m) => m !== 'Substrate');

function Editor({ d: raw, set }: { d: ArchD; set: (p: Partial<ArchD>) => void }) {
  const d = archNorm(raw),
    [sub, ...rest] = d.layers,
    top = [...rest].reverse(); // as listed: top layer first
  const put = (t: ArchLayer[]) => set({ layers: [sub, ...[...t].reverse()] });
  const up = (i: number, p: Partial<ArchLayer>) => put(top.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const r = useReorder(top, put, 'layer');
  return (
    <>
      <Section title="Type">
        <Seg
          value={d.pol}
          opts={[
            ['p-i-n', 'p-i-n'],
            ['n-i-p', 'n-i-p'],
          ]}
          on={(pol) => set({ pol })}
          small
        />
        <p className="small mut">J–V figures of stacks with this architecture state it.</p>
      </Section>
      <Section title="Layers, top to bottom">
        {top.map((x, i) => (
          <div className={'row arch-row' + (r.drag === i ? ' dragging' : '')} key={i} ref={r.rowRef(i)}>
            <DragHandle h={r.handle(i)} show={top.length > 1} />
            <input
              value={x.n}
              aria-label={`Layer ${i + 1} name`}
              placeholder="Layer name"
              onChange={(e) => up(i, { n: e.target.value })}
            />
            <select
              value={x.m}
              aria-label={`Layer ${i + 1} method`}
              onChange={(e) => up(i, { m: e.target.value as Method })}
            >
              {LAYER_METHODS.map((m) => (
                <option key={m} value={m}>
                  {methodName(m)}
                </option>
              ))}
            </select>
            <RemoveRow label={`Remove ${x.n || `layer ${i + 1}`}`} onClick={() => put(top.filter((_, j) => j !== i))} />
          </div>
        ))}
        <div className="row arch-row">
          <span className="drag-space" aria-hidden />
          <input
            value={sub.n}
            aria-label="Substrate layer name"
            placeholder="Substrate"
            onChange={(e) => set({ layers: [{ ...sub, n: e.target.value }, ...rest] })}
          />
          <span className="mut">{methodName('Substrate')}</span>
          <span className="drag-space" aria-hidden />
        </div>
        <button className="link add" onClick={() => put([{ n: '', m: 'Spin' }, ...top])}>
          Add a layer on top
        </button>
      </Section>
    </>
  );
}

/** The layers drawn as a stack, top first, each with its method. */
function Layers({ d, small }: { d: ArchD; small?: boolean }) {
  const top = [...archNorm(d).layers].reverse();
  if (small) {
    const h = Math.min(12, 84 / top.length),
      y0 = 92 - 4 - h * top.length;
    return (
      <svg viewBox="0 0 150 92" width="150" height="92" aria-hidden className="arch-art">
        {top.map((x, i) => (
          <g key={i}>
            <rect
              x={x.m === 'Substrate' ? 12 : 22}
              y={y0 + i * h}
              width={x.m === 'Substrate' ? 126 : 106}
              height={h}
              className={'arch-art-' + (x.m === 'Metal evap' ? 'metal' : x.m === 'Substrate' ? 'sub' : 'film')}
            />
          </g>
        ))}
      </svg>
    );
  }
  return (
    <ol className="arch-out">
      {top.map((x, i) => (
        <li key={i} className={x.m === 'Substrate' ? 'sub' : ''}>
          <b>{x.n || 'Unnamed layer'}</b>
          <span className="mut">{methodName(x.m)}</span>
        </li>
      ))}
    </ol>
  );
}

function Output({ d: raw }: { d: ArchD }) {
  const d = archNorm(raw);
  return (
    <>
      <p className="headline">
        {d.pol} <span className="mut">· {d.layers.length} layers</span>
      </p>
      <Layers d={d} />
    </>
  );
}

export const architecture: Kind<ArchD> = {
  segment: 'arch',
  title: 'Architectures',
  noun: 'architecture',
  defaults,
  Editor,
  Output,
  noRuns: true,
  // the output is the whole design: a key-facts column would list the same layers again
  wideView: true,
  Visual: ({ d }) => <Layers d={d} small />,
  summary: (raw) => {
    const d = archNorm(raw);
    return `${d.pol} · ${d.layers.length} layers`;
  },
  describe: (raw) => {
    const d = archNorm(raw);
    return {
      Type: d.pol,
      // one layer per line, top first, as on the screen
      Layers: [...d.layers]
        .reverse()
        .map((x) => `${x.n || 'Unnamed layer'} (${methodName(x.m).toLowerCase()})`)
        .join('\n'),
    };
  },
  runFields: () => [],
};
