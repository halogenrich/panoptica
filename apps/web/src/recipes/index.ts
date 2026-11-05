import { solution } from './solution';
import { spin } from './spin';
import { organic, metal } from './evaporation';
import { substratePrep } from './substratePrep';
import { substrate } from '../designs/substrate';
import { mask } from '../designs/mask';
import { stack } from '../stacks/stack';
import type { Kind } from './types';

export const KINDS: Record<string, Kind> = { s0: substratePrep, s1: solution, s2: spin, s3: organic, s4: metal, sub: substrate, mask, stk: stack };
