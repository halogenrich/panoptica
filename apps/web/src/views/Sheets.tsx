import { KINDS } from '../recipes';
import { norm, type Ctx } from '../recipes/types';

export { MeasCtx } from '../recipes/shared';

const METHOD: Record<string, string> = { Substrate: 's0', 'Organic evap': 's3', 'Metal evap': 's4' };

/** One layer of a printed run sheet: the same output renderers as the preset screens, with write-in columns. */
export function SlotSheet({ m, a, b, t, ctx }: { m: string; a: any; b: any; t: string; ctx: Ctx }) {
  const none = <p className="mut">No preset selected</p>;
  const out = (seg: string, d: any) => { const k = KINDS[seg]; return d ? <k.Output d={norm(k, d)} ctx={ctx} blanks /> : none; };
  if (m === 'Spin') return <>{out('s1', a)}{out('s2', b)}</>;
  if (METHOD[m]) return out(METHOD[m], a);
  return t ? <p>{t}</p> : null;
}
