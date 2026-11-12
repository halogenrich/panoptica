/**
 * Equipment can hold other equipment (a glovebox with a spin coater, a hotplate and a stirring plate inside): what it can do is
 * its own steps plus those of everything inside it. Booking is for the bookable item (the glovebox), never for what is inside.
 * The steps themselves come from the modules.
 */
export interface EqNode {
  id: number;
  parent_id?: number | null;
  steps?: readonly string[] | null;
}
/** What an equipment can do: its own steps and those of everything inside it (any depth). */
export function abilities(eq: EqNode, all: readonly EqNode[]): Set<string> {
  const out = new Set<string>(eq.steps ?? []),
    seen = new Set([eq.id]);
  const walk = (id: number) => {
    for (const c of all)
      if (c.parent_id === id && !seen.has(c.id)) {
        seen.add(c.id);
        (c.steps ?? []).forEach((s) => out.add(s));
        walk(c.id);
      }
  };
  walk(eq.id);
  return out;
}
/** True when `eq` can do every step in `needs`. */
export const covers = (eq: EqNode, all: readonly EqNode[], needs: readonly string[]) => {
  const a = abilities(eq, all);
  return needs.every((n) => a.has(n));
};
/** Would putting `child` inside `parent` make a loop (parent inside child)? */
export function wouldLoop(child: number, parent: number | null | undefined, all: readonly EqNode[]): boolean {
  let p = parent ?? null;
  for (let i = 0; p != null && i < 100; i++) {
    if (p === child) return true;
    p = all.find((e) => e.id === p)?.parent_id ?? null;
  }
  return false;
}
