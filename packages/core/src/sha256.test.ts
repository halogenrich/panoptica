import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { sha256 } from './sha256';

describe('sha256', () => {
  it('matches Node for empty, padding edges and long inputs', () => {
    for (const s of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'é'.repeat(5000)]) {
      const b = new TextEncoder().encode(s);
      expect(sha256(b)).toBe(createHash('sha256').update(b).digest('hex'));
    }
  });
});
