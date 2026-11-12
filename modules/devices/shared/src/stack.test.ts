import { describe, it, expect } from 'vitest';
import { stackSlabs, footprint, pattern } from './index';

describe('stack geometry', () => {
  it('splits the footprint around a scrape strip', () => {
    expect(footprint('1.2 × 1.2 cm', [2, 0, 1, 12])).toHaveLength(2);
    expect(footprint('1.5 × 2.5 cm', [0, 0, 25, 1])).toHaveLength(1);
  });
  it('stacks layers bottom to top', () => {
    const g = pattern('1.2 × 1.2 cm');
    const s = stackSlabs(
      '1.2 × 1.2 cm',
      [
        { n: 'Perovskite', kind: 'film', mat: 'x', nm: 500 },
        { n: 'Metal contact', kind: 'metal', mat: 'Ag', nm: 100, rects: g.metal },
      ],
      g.scrape[0],
    );
    expect(s.map((x) => x.kind)).toEqual(['glass', 'ito', 'film', 'metal']);
    expect(s[3].y0).toBeCloseTo(s[2].y0 + s[2].h, 9);
    expect(s[3].rects).toHaveLength(4);
  });
});
