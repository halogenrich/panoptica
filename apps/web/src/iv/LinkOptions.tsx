import type { Link } from './model';

export type LinkTargets = {
  batches: { id: number; code: string; name: string; variants?: { id: string; name: string }[] }[];
  stacks: { id: number; name: string }[];
};
/** A link as a <select> value: "batch:12", "batch:12:B" (variant B), "stack:7". */
export const linkVal = (l: Link | null | undefined) =>
  l ? `${l.kind}:${l.id}${l.variant ? ':' + l.variant : ''}` : '';
export const parseLink = (v: string): Link => {
  const [k, id, variant] = v.split(':');
  return k ? { kind: k as 'batch' | 'stack', id: +id, ...(variant ? { variant } : {}) } : null;
};

/** The <option>s for linking a sample: batches (each variant of a batch as its own choice), then stacks. */
export default function LinkOptions({ t }: { t: LinkTargets | null }) {
  if (!t) return null;
  return (
    <>
      {t.batches.length > 0 && (
        <optgroup label="Batches">
          {t.batches.flatMap((b) => [
            <option key={'b' + b.id} value={`batch:${b.id}`}>
              {b.code}
              {b.name ? ` · ${b.name}` : ''}
              {b.variants?.length ? ' (default device)' : ''}
            </option>,
            ...(b.variants ?? []).map((v) => (
              <option key={`b${b.id}:${v.id}`} value={`batch:${b.id}:${v.id}`}>
                {b.code}, variant {v.name}
              </option>
            )),
          ])}
        </optgroup>
      )}
      {t.stacks.length > 0 && (
        <optgroup label="Stacks">
          {t.stacks.map((s) => (
            <option key={'s' + s.id} value={`stack:${s.id}`}>
              {s.name}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );
}
