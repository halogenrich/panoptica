import { describe, it, expect } from 'vitest';
import { analyzeMask, plateGeometry, maskStl, maskSvg, maskDxf, meshVolume, minWidth, suggestScrape, DEFAULT_PLATE, type MaskD } from './mask';
import { explode, type Shape } from './geom';

const R = (id: string, x: number, y: number, w: number, h: number): Shape => ({ id, kind: 'rect', x, y, w, h });
// 12 x 12 glass, ITO from x = 2 to 10; ITO exposed (scraped) from x = 2 to 3.5
const base = (): MaskD => ({
  subId: '1', subName: 'test', sub: { w: 12, h: 12, ito: [R('ito', 2, 0, 8, 12)] },
  active: [R('px', 5, 4, 2, 2)],
  conn: [R('strip', 7, 4.5, 4.5, 1), R('counter', 0.5, 8, 2.5, 3)],
  scrape: [R('scr', 2, 0, 1.5, 12)],
  plate: { ...DEFAULT_PLATE }, notes: '',
});

describe('mask analysis', () => {
  it('area used: recalculated by default, drawn when the recalculated area is not accepted', () => {
    expect(analyzeMask(base()).pixels[0].area).toBeCloseTo(7, 6);
    expect(analyzeMask({ ...base(), useActual: false }).pixels[0].area).toBeCloseTo(4, 6);
  });
  it('pixel numbers follow the list order, arrays row by row; explode keeps that order', () => {
    const m = base(); m.conn = [];
    m.active = [{ ...R('arr', 4, 1, 1, 1), repeat: { nx: 2, ny: 2, px: 3, py: 4 } }]; // (4,1) (7,1) (4,5) (7,5)
    const at = (mm: MaskD) => analyzeMask(mm).pixels.map((p) => p.at.map((v) => +v.toFixed(2)).join(','));
    expect(at(m)).toEqual(['4.5,1.5', '7.5,1.5', '4.5,5.5', '7.5,5.5']);
    const parts = explode(m.active[0]);
    expect(parts).toHaveLength(4);
    expect(at({ ...m, active: parts })).toEqual(at(m));
    expect(at({ ...m, active: [parts[3], parts[1], parts[0], parts[2]] })).toEqual(['7.5,5.5', '7.5,1.5', '4.5,1.5', '4.5,5.5']);
  });
  it('pixel area, parasitic strip area, pad and counter electrode', () => {
    const a = analyzeMask(base());
    expect(a.pixels).toHaveLength(1);
    const p = a.pixels[0];
    expect(p.intended).toBeCloseTo(4, 6);
    expect(p.actual).toBeCloseTo(7, 6);      // strip over ITO from x 7 to 10 adds 3 mm²
    expect(p.parasitic).toBeCloseTo(3, 6);
    expect(p.pad).toBeCloseTo(1.5, 6);       // strip beyond the ITO edge, x 10 to 11.5
    expect(p.short).toBe(false);
    expect(a.counters).toHaveLength(1);
    expect(a.issues.some((i) => i.text.includes('adds 3.00 mm²'))).toBe(true);
  });
  it('detects a short when pixel metal reaches the scraped ITO', () => {
    const m = base(); m.conn.push(R('bad', 2.5, 4.5, 2.5, 1));
    const a = analyzeMask(m);
    expect(a.pixels[0].short).toBe(true);
    expect(a.issues.some((i) => i.level === 'error' && i.text.includes('shorted'))).toBe(true);
  });
  it('detects an island (ring-shaped opening) and narrow features', () => {
    const m = base();
    m.conn = [R('t', 1, 1, 6, 1), R('b', 1, 6, 6, 1), R('l', 1, 1, 1, 6), R('r', 6, 1, 1, 6)];
    const a = analyzeMask(m);
    expect(a.fab.evaporation.some((i) => i.text.includes('island'))).toBe(true);
    expect(minWidth([[0, 0], [2, 0], [2, 0.2], [0, 0.2]])).toBeCloseTo(0.2, 9);
  });
  it('suggests a scrape area under the counter electrode', () => {
    const m = base(); m.scrape = [];
    const s = suggestScrape(m);
    expect(s).toHaveLength(1);
    expect(s[0].kind === 'rect' && s[0].x).toBeCloseTo(1.5, 6);
  });
});

describe('mask export', () => {
  it('STL is a closed solid with the expected volume', () => {
    const { text, facets } = maskStl(base(), 'aperture');
    expect(text.startsWith('solid')).toBe(true);
    expect(facets).toBeGreaterThan(10);
    expect(meshVolume(text)).toBeCloseTo((18 * 18 - 4) * 0.5, 3); // plate 18 x 18 mm, one 2 x 2 mm opening, 0.5 mm thick
  });
  it('STL with a substrate pocket', () => {
    const m = base(); m.plate = { ...m.plate, t: 2, pocket: true, pocketDepth: 1.1, clearance: 0.15 };
    const frame = 18 * 18 - 12.3 * 12.3, top = 18 * 18 - 4;
    expect(meshVolume(maskStl(m, 'aperture').text)).toBeCloseTo(frame * 1.1 + top * 0.9, 3);
  });
  it('mirroring moves openings to the other side', () => {
    const m = base(); m.active = [R('px', 1, 4, 2, 2)];
    const xs = (mm: MaskD) => plateGeometry(mm, 'aperture').openings.flat(2).map((p) => p[0]);
    expect(Math.min(...xs(m))).toBeCloseTo(4, 9);           // margin 3 + x 1
    m.plate.mirror = true;
    expect(Math.min(...xs(m))).toBeCloseTo(3 + 12 - 3, 9);  // mirrored: x 9..11 on the glass
  });
  it('SVG and DXF contain the plate and openings', () => {
    const svg = maskSvg(base(), 'evaporation'), dxf = maskDxf(base(), 'evaporation');
    expect(svg).toContain('width="18mm"');
    expect(svg).toContain('fill-rule="evenodd"');
    expect(dxf.match(/POLYLINE/g)!.length).toBe(1 + 2); // plate + two metal pieces (pixel with strip, counter electrode)
    expect(dxf).toContain('$INSUNITS');
  });
});
