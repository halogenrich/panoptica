/**
 * Lines of research (0.61). A line is a starting stack and the stacks that came from it, by Duplicate or by a new version made when
 * a stack in use was edited (both record the stack they came from). Where two or more stacks came from one stack, one of them
 * continues the line and each of the others starts a new line of its own, which can branch again (Richard, 18 Nov). The owner of
 * the stack where it branches chooses which continues (Richard, 25 Nov); until then the oldest does. So a line is a chain of stacks.
 */

/** The colours lines get until their owner chooses one: the comparisons' palette, so a line reads the same on screen and slide. */
export const LINE_COLORS = [
  '#d7263d',
  '#1b4f9c',
  '#0f8b5f',
  '#e08e0b',
  '#7b3fa0',
  '#0e9aa7',
  '#a15c2a',
  '#c2185b',
  '#3d5a80',
  '#6b8e23',
];
/** Batches in no line, and measurements linked to no batch (Richard: "Grey not in line"). */
export const LOOSE_COLOR = '#9aa0a6';

export type StackNode = { id: number; parent_id: number | null; line_next: number | null };

export type LineTree = {
  /** the line each stack is in: the id of the line's starting stack */
  lineOf: Map<number, number>;
  /** each line's stacks, from its starting stack along the chain */
  lines: Map<number, number[]>;
  /** the stacks that came from each stack, oldest first */
  kids: Map<number, number[]>;
  /** which of a stack's stacks continues its line (none when nothing came from it) */
  next: (id: number) => number | null;
};

/** Sorts stacks into lines. `line_next` is the owner's choice; a choice that is no longer one of the stack's own is ignored. */
export function lineTree(stacks: StackNode[]): LineTree {
  const byId = new Map(stacks.map((s) => [s.id, s])),
    kids = new Map<number, number[]>();
  for (const s of [...stacks].sort((a, b) => a.id - b.id))
    if (s.parent_id != null && s.parent_id !== s.id && byId.has(s.parent_id)) {
      const k = kids.get(s.parent_id) ?? [];
      k.push(s.id);
      kids.set(s.parent_id, k);
    }
  const next = (id: number) => {
    const k = kids.get(id);
    if (!k?.length) return null;
    const pick = byId.get(id)?.line_next;
    return pick != null && k.includes(pick) ? pick : k[0];
  };
  const lineOf = new Map<number, number>(),
    lines = new Map<number, number[]>();
  const start = (id: number) => {
    // walks the chain from a starting stack; every other stack that came from it starts a line in turn
    const todo = [id];
    while (todo.length) {
      const s = todo.pop()!;
      if (lineOf.has(s)) continue;
      const chain: number[] = [];
      for (let c: number | null = s; c != null && !lineOf.has(c); c = next(c)) {
        lineOf.set(c, s);
        chain.push(c);
        for (const k of kids.get(c) ?? []) if (k !== next(c)) todo.push(k);
      }
      lines.set(s, chain);
    }
  };
  for (const s of [...stacks].sort((a, b) => a.id - b.id))
    if (s.parent_id == null || !byId.has(s.parent_id) || s.parent_id === s.id) start(s.id);
  // a loop of parents (never made by the app, but a database can be edited by hand): each stack left starts its own line
  for (const s of stacks) if (!lineOf.has(s.id)) start(s.id);
  return { lineOf, lines, kids, next };
}

/** A line's colour until its owner picks one: by its place among the lab's lines, so it stays the same for everyone. */
export const lineColor = (lineIds: number[], id: number) => {
  const i = [...lineIds].sort((a, b) => a - b).indexOf(id);
  return LINE_COLORS[(i < 0 ? 0 : i) % LINE_COLORS.length];
};
