import { KINDS } from '../recipes';
import { norm } from '../recipes/types';
import { SEG } from '../stacks/model';
import { snapCtx, type Batch } from '../views/Batches';

export type BatchUse = { id: number; code: string; date: string; uses: { name: string; mg?: number; ul?: number }[] };

/**
 * Reagents a batch took, from its frozen recipes: each solution prepared once (salts, additives, solvents) and the solvents
 * dispensed straight from the bottle in spin programs. Planned amounts, not weighed ones.
 */
export function batchUses(b: Pick<Batch, 'id' | 'code' | 'created_at' | 'snapshot'>): BatchUse {
  const ctx = snapCtx(b), uses: BatchUse['uses'] = [];
  b.snapshot.stack.sl.forEach((s, i) => {
    const r = b.snapshot.resolved[i] ?? {};
    const add = (seg: string | null | undefined, p?: { name: string; data: any } | null) => {
      const k = seg ? KINDS[seg] : undefined;
      if (!k?.uses || !p) return;
      try { uses.push(...k.uses(norm(k, p.data), ctx)); } catch { /* a recipe from an older version that no longer computes */ }
    };
    add(s.m === 'Spin' ? 's1' : SEG[s.m], r.a); if (s.m === 'Spin') add('s2', r.b);
  });
  return { id: b.id, code: b.code, date: b.created_at, uses };
}
