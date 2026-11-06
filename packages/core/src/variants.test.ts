import { describe, expect, it } from 'vitest';
import { applyVariant, describeChanges, nextVariantId, type Snap, type Variant } from './variants';

const snap: Snap = {
  stack: {
    arch: 'p-i-n',
    sl: [
      { n: 'Substrate', m: 'Substrate', a: '1', b: '' },
      { n: 'SAM', m: 'Spin', a: '2', b: '3' },
      { n: 'Perovskite', m: 'Spin', a: '4', b: '5' },
      { n: 'C60', m: 'Organic evap', a: '6', b: '' },
    ],
  },
  resolved: {
    0: { a: { name: 'ITO', data: {} } },
    1: { a: { name: 'MeO', data: {} }, b: { name: 'p1', data: {} } },
    2: { a: { name: 'FAPbI3', data: {} }, b: { name: 'p2', data: {} } },
    3: { a: { name: 'C60 20nm', data: {} } },
  },
};
const v = (changes: Variant['changes'], stack: Variant['stack'] = null): Variant => ({
  id: 'A',
  name: 'x',
  substrates: '',
  stack,
  changes,
});

describe('applyVariant', () => {
  it('returns the default device without a variant', () => {
    expect(applyVariant(snap, null).stack.sl).toHaveLength(4);
  });
  it('swaps a recipe and keeps the others', () => {
    const r = applyVariant(
      snap,
      v([{ t: 'recipe', slot: 2, which: 'a', id: 9, name: 'FAPbI3 + MACl', data: { x: 1 } }]),
    );
    expect(r.stack.sl[2].a).toBe('9');
    expect(r.resolved[2].a?.name).toBe('FAPbI3 + MACl');
    expect(r.resolved[2].b?.name).toBe('p2');
    expect(snap.stack.sl[2].a).toBe('4'); // the batch snapshot is not changed
  });
  it('adds and removes layers against the original positions', () => {
    const r = applyVariant(
      snap,
      v([
        { t: 'layer', after: 2, n: 'PEAI', m: 'Spin', a: '7', b: '8', ra: { name: 'PEAI 1 mg/mL', data: {} } },
        { t: 'remove', slot: 1 },
        { t: 'additive', slot: 2, name: 'MACl', amount: '5 %' },
      ]),
    );
    expect(r.stack.sl.map((s) => s.n)).toEqual(['Substrate', 'Perovskite', 'PEAI', 'C60']);
    expect(r.resolved[2].a?.name).toBe('PEAI 1 mg/mL');
    expect(r.resolved[3].a?.name).toBe('C60 20nm');
    expect((r.stack.sl[1] as any).add).toEqual(['MACl 5 %']);
  });
  it('never removes the substrate', () => {
    expect(applyVariant(snap, v([{ t: 'remove', slot: 0 }])).stack.sl).toHaveLength(4);
  });
  it('uses the linked stack whole', () => {
    const st = {
      id: 3,
      name: 'n-i-p',
      stack: { arch: 'n-i-p', sl: [snap.stack.sl[0]] },
      resolved: { 0: snap.resolved[0] },
    };
    expect(applyVariant(snap, v([], st)).stack.arch).toBe('n-i-p');
  });
  it('keeps changes in words for the device as notes', () => {
    expect(applyVariant(snap, v([{ t: 'other', slot: null, text: 'annealed in air' }])).notes).toEqual([
      'annealed in air',
    ]);
  });
});

describe('describeChanges', () => {
  it('names the layer of each change', () => {
    expect(
      describeChanges(
        v([
          { t: 'additive', slot: 2, name: 'MACl', amount: '5 %' },
          { t: 'remove', slot: 1 },
        ]),
        snap.stack.sl,
      ),
    ).toEqual(['Perovskite: additive MACl 5 %', 'Without SAM']);
  });
});

describe('nextVariantId', () => {
  it('takes the first free letter', () => {
    expect(nextVariantId([{ id: 'A' }, { id: 'C' }])).toBe('B');
  });
});
