import { describe, expect, it } from 'vitest';
import { LINE_COLORS, lineColor, lineTree, type StackNode } from './lines';

const s = (id: number, parent_id: number | null = null, line_next: number | null = null): StackNode => ({
  id,
  parent_id,
  line_next,
});

describe('lines of research (0.61)', () => {
  it('a stack and the stacks that came from it, one after another, are one line named after the first', () => {
    const t = lineTree([s(1), s(2, 1), s(3, 2)]);
    expect([...t.lines.entries()]).toEqual([[1, [1, 2, 3]]]);
    expect(t.lineOf.get(3)).toBe(1);
  });
  it('where it branches, the oldest continues until the owner chooses; each other branch is a line of its own', () => {
    const tree = [s(1), s(2, 1), s(3, 1), s(4, 3), s(5, 3)];
    const t = lineTree(tree);
    expect(t.lines.get(1)).toEqual([1, 2]);
    expect(t.lines.get(3)).toEqual([3, 4]);
    expect(t.lines.get(5)).toEqual([5]);
    expect(t.next(1)).toBe(2);
    // the owner of 1 says 3 continues: 2 becomes a line, and 3's branch (4) comes along
    const c = lineTree(tree.map((x) => (x.id === 1 ? { ...x, line_next: 3 } : x)));
    expect(c.lines.get(1)).toEqual([1, 3, 4]);
    expect(c.lines.get(2)).toEqual([2]);
    expect(c.lines.get(5)).toEqual([5]);
    expect(c.lines.size).toBe(3);
  });
  it('a choice that is not one of the stack’s own is ignored; a stack whose parent is gone starts a line', () => {
    const t = lineTree([s(1, null, 9), s(2, 1), s(7, 99)]);
    expect(t.lines.get(1)).toEqual([1, 2]);
    expect(t.lines.get(7)).toEqual([7]);
  });
  it('a loop of parents (a hand-edited database) still gives every stack a line', () => {
    const t = lineTree([s(1, 2), s(2, 1), s(3)]);
    expect(t.lineOf.size).toBe(3);
  });
  it('colours follow the line’s place among the lab’s lines', () => {
    expect(lineColor([30, 10, 20], 10)).toBe(LINE_COLORS[0]);
    expect(lineColor([30, 10, 20], 30)).toBe(LINE_COLORS[2]);
  });
});
