import { describe, it, expect } from 'vitest';
import { buildStack, legacyGeometry, VIS } from './index';
import { regionArea, type Shape } from './geom';

const R = (id: string, x: number, y: number, w: number, h: number): Shape => ({ id, kind: 'rect', x, y, w, h });
const area = (r: [number, number][][][]) => regionArea(r.map((p) => p.map((ring) => [...ring, ring[0]])) as any);
const top = (s: { y0: number; h: number }) => s.y0 + s.h;

describe('stack geometry', () => {
  // 12 x 12 glass, ITO from x = 2 to 10 (150 nm), scrape x = 2..3.5, one pixel with a strip
  const sub = { w: 12, h: 12, ito: [R('ito', 2, 0, 8, 12)], t: 150 };
  const mask = { active: [R('px', 5, 4, 2, 2)], conn: [R('strip', 7, 4.5, 4.5, 1)], scrape: [R('scr', 2, 0, 1.5, 12)] };
  const s = buildStack(sub, mask, [
    { key: 'htl', name: 'HTL', kind: 'film', mat: 'SAM', nm: 2 },
    { key: 'pvk', name: 'Perovskite', kind: 'film', mat: 'FAPbI3', nm: 500 },
    { key: 'm', name: 'Metal', kind: 'metal', mat: 'Ag', nm: 100 },
  ]);
  const [glass, ito, htl, pvk, m] = s.slabs;

  it('uses the visual scale: glass 1 mm, 100 nm = 0.1 mm, minimum for very thin layers', () => {
    expect(glass.h).toBe(VIS.glass);
    expect(ito.h).toBeCloseTo(VIS.ito, 9); // a thin coloured film, whatever its nm
    expect(ito.label).toBe('ITO · 150 nm');
    expect(top(pvk) - top(htl)).toBeCloseTo(0.5, 9);
    expect(top(htl) - top(ito)).toBeCloseTo(VIS.min, 9);
  });
  it('the first film is one flat slab over the glass and the thin ITO, with no step cut out', () => {
    expect(htl.parts).toHaveLength(1);
    expect(htl.parts[0].y0).toBeCloseTo(VIS.glass + VIS.ito, 9); // on the ITO, not level with its bottom
    expect(area(htl.parts[0].region)).toBeCloseTo(144 - 18, 6); // everything but the scrape strip
    expect(htl.parts.every((p) => p.y0 >= VIS.glass)).toBe(true); // never inside the glass
  });
  it('later films have a single part with a flat top', () => {
    expect(pvk.parts).toHaveLength(1);
    expect(area(pvk.parts[0].region)).toBeCloseTo(144 - 18, 6);
  });
  it('metal over the stack sits on top; there is no metal over the scrape area in this layout', () => {
    expect(m.parts).toHaveLength(1);
    expect(m.parts[0].y0).toBeCloseTo(top(pvk), 9);
  });
  it('metal over the scrape area fills down to the exposed ITO', () => {
    const ce = buildStack(sub, { ...mask, conn: [...mask.conn, R('ce', 1, 8, 2, 3)] }, [
      { key: 'pvk', name: 'Perovskite', kind: 'film', mat: 'x', nm: 500 },
      { key: 'm', name: 'Metal', kind: 'metal', mat: 'Ag', nm: 100 },
    ]);
    const metal = ce.slabs[3],
      ito2 = ce.slabs[1];
    const bottoms = metal.parts.map((p) => p.y0).sort((a, b) => a - b);
    expect(bottoms[0]).toBeCloseTo(top(ito2), 9); // x 2..3: down onto the exposed ITO in the scrape strip
    expect(bottoms[bottoms.length - 1]).toBeCloseTo(top(ce.slabs[2]), 9); // elsewhere on top of the film (x 1..2 is covered by film)
    expect(top(metal)).toBeCloseTo(top(ce.slabs[2]) + 0.1, 9);
    // evaporated metal follows the surface: the counter electrode on the ITO is as thick as the metal on top of the stack
    expect(metal.parts.filter((p) => !p.wall).every((p) => Math.abs((p.h ?? 0) - 0.1) < 1e-9)).toBe(true);
    // and coats the edge of the film where it goes down: a band 0.1 wide from the ITO up to the metal's top (0.60.2)
    const walls = metal.parts.filter((p) => p.wall);
    expect(walls).toHaveLength(1);
    expect(walls[0].y0).toBeCloseTo(top(ito2), 9);
    expect(walls[0].y0 + (walls[0].h ?? 0)).toBeCloseTo(top(metal), 9);
    expect(area(walls[0].region)).toBeCloseTo(0.1 * 3, 6); // along the film's edge at x = 2, the pad's 3 mm
  });
  it('earlier presets fall back to the placeholder geometry', () => {
    const g = legacyGeometry('1.2 × 1.2 cm');
    expect(g.sub.w).toBe(12);
    expect(g.mask.active).toHaveLength(4);
  });
});
