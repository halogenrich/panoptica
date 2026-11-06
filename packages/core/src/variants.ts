/**
 * Batch variants. A batch is made from one stack (the default device); a variant is either another stack (a premade variation,
 * frozen when it is linked) or a list of changes to the default device: a layer with another recipe, a layer added or removed, an
 * additive in a layer, or a change in words. `applyVariant` turns the batch snapshot into the snapshot of the variant's devices, so
 * everything that reads a snapshot (3D view, recipe facts, cell geometry) works for variants unchanged.
 */
export type Frozen = { name: string; data: unknown } | null;
export type SnapSlot = { n: string; m: string; a: string; b: string; th?: number };
export type Snap = {
  stack: { arch: string; sl: SnapSlot[] };
  resolved: Record<number, { a?: Frozen; b?: Frozen }>;
  [k: string]: unknown;
};
export type VarChange =
  | { t: 'recipe'; slot: number; which: 'a' | 'b'; id: number; name?: string; data?: unknown }
  | {
      t: 'layer';
      after: number;
      n: string;
      m: string;
      a: string;
      b: string;
      th?: number;
      ra?: Frozen;
      rb?: Frozen;
    }
  | { t: 'remove'; slot: number }
  | { t: 'additive'; slot: number; name: string; amount: string }
  | { t: 'other'; slot: number | null; text: string };
export type Variant = {
  id: string;
  name: string;
  substrates: string;
  stack: { id: number; name: string; stack: Snap['stack']; resolved: Snap['resolved'] } | null;
  changes: VarChange[];
};
export type Variants = { control: string; list: Variant[] };

/** Extra lines a variant puts on a layer: additives ("PEAI 1 mg/mL") and changes in words. */
export type SlotExtras = { add?: string[]; note?: string[] };

export function applyVariant<S extends Snap>(snap: S, v: Variant | null | undefined): S & { notes: string[] } {
  if (!v) return { ...snap, notes: [] };
  if (v.stack) return { ...snap, stack: v.stack.stack as S['stack'], resolved: v.stack.resolved, notes: [] };
  type Row = { s: SnapSlot & SlotExtras; r: { a?: Frozen; b?: Frozen } };
  const rows: (Row | null)[] = snap.stack.sl.map((s, i) => ({
    s: { ...s },
    r: { ...(snap.resolved[i] ?? {}) },
  }));
  const notes: string[] = [];
  for (const c of v.changes) {
    if (c.t === 'recipe') {
      const row = rows[c.slot];
      if (!row) continue;
      row.s = { ...row.s, [c.which]: String(c.id) };
      row.r[c.which] = c.name !== undefined ? { name: c.name, data: c.data } : null;
    } else if (c.t === 'additive') {
      const row = rows[c.slot];
      if (row) row.s.add = [...(row.s.add ?? []), [c.name, c.amount].filter(Boolean).join(' ')];
    } else if (c.t === 'other') {
      const row = c.slot === null ? null : rows[c.slot];
      if (row) row.s.note = [...(row.s.note ?? []), c.text];
      else notes.push(c.text);
    }
  }
  // removals and new layers last, against the original positions
  const removed = new Set(
    v.changes.filter((c) => c.t === 'remove' && c.slot > 0).map((c) => (c as { slot: number }).slot),
  );
  const out: Row[] = [];
  const added = (after: number) =>
    v.changes
      .filter((c): c is Extract<VarChange, { t: 'layer' }> => c.t === 'layer' && c.after === after)
      .forEach((c) =>
        out.push({
          s: { n: c.n, m: c.m, a: c.a, b: c.b, ...(c.th ? { th: c.th } : {}), added: true } as SnapSlot,
          r: { a: c.ra ?? null, b: c.rb ?? null },
        }),
      );
  rows.forEach((row, i) => {
    if (row && !removed.has(i)) out.push(row);
    added(i);
  });
  const resolved: Snap['resolved'] = {};
  out.forEach((x, i) => (resolved[i] = x.r));
  return { ...snap, stack: { ...snap.stack, sl: out.map((x) => x.s) } as S['stack'], resolved, notes };
}

/** One line per change, for lists and reports: "Perovskite: recipe FAPbI3 + 5 % MACl", "Added layer PEAI after Perovskite". */
export function describeChanges(v: Variant, sl: SnapSlot[]): string[] {
  if (v.stack) return [`Made from the stack ${v.stack.name}`];
  const layer = (i: number | null) => (i === null ? '' : (sl[i]?.n ?? `Layer ${i + 1}`));
  return v.changes.map((c) => {
    switch (c.t) {
      case 'recipe':
        return `${layer(c.slot)}: ${c.which === 'b' ? 'spin program' : 'recipe'} ${c.name ?? '(unavailable)'}`;
      case 'layer':
        return `Added ${c.n} (${c.m}${c.ra?.name ? ', ' + c.ra.name : ''}) after ${layer(c.after)}`;
      case 'remove':
        return `Without ${layer(c.slot)}`;
      case 'additive':
        return `${layer(c.slot)}: additive ${[c.name, c.amount].filter(Boolean).join(' ')}`;
      case 'other':
        return c.slot === null ? c.text : `${layer(c.slot)}: ${c.text}`;
    }
  });
}

/** A short id for a new variant, unique in the list (A, B, … then A2, B2, …). */
export function nextVariantId(list: { id: string }[]) {
  const have = new Set(list.map((v) => v.id));
  for (let k = 1; ; k++)
    for (let c = 0; c < 26; c++) {
      const id = String.fromCharCode(65 + c) + (k > 1 ? k : '');
      if (!have.has(id)) return id;
    }
}
