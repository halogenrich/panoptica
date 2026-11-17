import { Picker, type PickOption } from '@web/views/Picker';
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

/**
 * Choices for linking a sample (0.54: a picker, typed into): batches (each variant of a batch as its own choice), then stacks.
 */
function linkChoices(t: LinkTargets | null, none: string): PickOption[] {
  return [
    { value: '', label: none },
    ...(t?.batches ?? []).flatMap((b) => [
      {
        value: `batch:${b.id}`,
        label: b.name || b.code,
        hint: b.variants?.length ? 'Default device' : undefined,
        other: [b.code],
        group: 'Batches',
      },
      ...(b.variants ?? []).map((v) => ({
        value: `batch:${b.id}:${v.id}`,
        label: `${b.name || b.code}, variant ${v.name}`,
        other: [b.code],
        group: 'Batches',
      })),
    ]),
    ...(t?.stacks ?? []).map((s) => ({ value: `stack:${s.id}`, label: s.name, group: 'Stacks' })),
  ];
}

/** Which batch, variant or stack a sample is (0.54: replaces the select with every batch and stack). */
export default function LinkPicker({
  t,
  value,
  onChange,
  label,
  none = 'Not linked',
  disabled,
  className,
}: {
  t: LinkTargets | null;
  value: Link | null | undefined;
  onChange: (l: Link) => void;
  label: string;
  none?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Picker
      label={label}
      className={className}
      disabled={disabled}
      value={linkVal(value)}
      onChange={(v) => onChange(parseLink(v))}
      options={linkChoices(t, none)}
    />
  );
}
