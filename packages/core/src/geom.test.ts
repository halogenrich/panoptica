import { describe, it, expect } from 'vitest';
import { makeShape, outline, polys, polyArea, unionArea, overlapArea, isConvex, shapeIssues, stripResistance, fitShape, moveShape, pieces, type Shape } from './geom';

const rect = (x: number, y: number, w: number, h: number, extra: Partial<Shape> = {}): Shape => ({ id: 'r', kind: 'rect', x, y, w, h, ...extra } as Shape);

describe('geometry', () => {
  it('areas of each shape kind', () => {
    expect(polyArea(outline(rect(0, 0, 8, 12)))).toBeCloseTo(96, 9);
    expect(polyArea(outline({ id: 'p', kind: 'para', x: 0, y: 0, w: 4, h: 3, skew: 2 }))).toBeCloseTo(12, 9);
    expect(polyArea(outline({ id: 't', kind: 'trap', x: 0, y: 0, h: 2, wb: 6, wt: 2, off: 2 }))).toBeCloseTo(8, 9);
    expect(polyArea(outline(makeShape('quad', 1, 1, 3, 2)))).toBeCloseTo(6, 9);
  });
  it('union counts overlaps once, overlap area is the intersection', () => {
    expect(unionArea([outline(rect(0, 0, 4, 4)), outline(rect(2, 0, 4, 4))])).toBeCloseTo(24, 9);
    expect(overlapArea([outline(rect(0, 0, 4, 4))], [outline(rect(2, 2, 4, 4))])).toBeCloseTo(4, 9);
    expect(pieces([outline(rect(0, 0, 1, 1)), outline(rect(3, 0, 1, 1))])).toHaveLength(2);
  });
  it('repeat arrays expand with pitch', () => {
    const r = rect(1, 1, 2, 3, { repeat: { nx: 4, ny: 2, px: 3, py: 5 } });
    expect(polys(r)).toHaveLength(8);
    expect(unionArea(polys(r))).toBeCloseTo(48, 9);
  });
  it('checks convexity and bounds', () => {
    expect(isConvex([[0, 0], [4, 0], [4, 4], [0, 4]])).toBe(true);
    expect(isConvex([[0, 0], [4, 0], [1, 1], [0, 4]])).toBe(false);
    expect(shapeIssues(rect(10, 0, 4, 4), 12, 12)).toContain('extends beyond the glass');
    expect(shapeIssues(rect(0, 0, 4, 4), 12, 12)).toEqual([]);
  });
  it('strip resistance R = Rs L / W', () => {
    const r = stripResistance(rect(2, 0, 8, 12), 15);
    expect(r.ohm).toBeCloseTo(15 * 12 / 8, 9);
    expect(r.axis).toBe('y');
  });
  it('move and fit keep the shape kind', () => {
    const m = moveShape(rect(0, 0, 2, 2), 1, 2) as any;
    expect([m.x, m.y]).toEqual([1, 2]);
    const f = fitShape({ id: 't', kind: 'trap', x: 0, y: 0, h: 2, wb: 4, wt: 2, off: 1 }, 0, 0, 8, 4);
    expect(polyArea(outline(f))).toBeCloseTo(24, 9);
  });
});
