import type { ReactNode } from 'react';
import type { Chem } from '@psc/core';
import type { Chemical } from '../views/common';

/** Data every recipe screen can read: the chemical table and the names of saved solutions (spin dispense sources). */
/** A saved design (substrate or metal mask) that recipes and other designs can reference. */
export interface Design { id: number; name: string; segment: 'sub' | 'mask'; data: any }

/** Any saved preset, as listed by the server. */
export interface Rec { id: number; segment: string; name: string; visibility: 'private' | 'shared'; data: any; owner_id: number; parent_id: number | null; owner: string; updated_at: string; mine: number; used: number }

export interface Ctx {
  chems: Chemical[]; cl: Chem[]; solutions: string[]; designs: Design[];
  all: Rec[];                      // every preset visible to the user
  refresh: () => void;             // reload presets after creating one inside another editor
  openBatch?: (id: number) => void;
}

/**
 * One value written down after a run. `input` picks the control: 'sci' is a pressure as mantissa × 10^exponent (stored "2.1e-6"),
 * 'pct' a percentage with one decimal (e.g. the sensor life, T.V). Fields with `stage` are shown in a grid, one row per stage and one
 * column per `col`; the kind's runStages gives the row labels.
 */
export interface RunField { key: string; label: string; expected?: string; unit?: string; input?: 'sci' | 'pct'; stage?: number; col?: string }

/**
 * One recipe type. The library screen is generic; each recipe only supplies its defaults, form, output and card art.
 * Data shapes are unchanged from earlier versions, so existing presets keep working.
 */
export interface Kind<T = any> {
  segment: 's0' | 's1' | 's2' | 's3' | 's4' | 'sub' | 'mask' | 'stk';
  title: string;            // "Solutions"
  noun: string;             // "solution"
  defaults: () => T;
  Editor: (p: { d: T; set: (p: Partial<T>) => void; ctx: Ctx }) => ReactNode;
  /** Read-only output. `blanks` adds write-in columns for printed run sheets. */
  Output: (p: { d: T; ctx: Ctx; blanks?: boolean }) => ReactNode;
  Visual: (p: { d: T; ctx: Ctx }) => ReactNode;
  /** Editor takes the whole sheet (designers with a canvas) instead of inputs | live output. */
  wideEditor?: boolean;
  /** The output already shows the picture (e.g. a 3D molecule): leave it out of the key-facts column. */
  noFactsArt?: boolean;
  /** Output takes the whole view (no key-facts column). */
  wideView?: boolean;
  /** Reagents one preparation takes (for inventory consumption): mass in mg and/or volume in µL, by chemical name. */
  uses?: (d: T, ctx: Ctx) => { name: string; mg?: number; ul?: number }[];
  /** Extra buttons in the view header (e.g. Print, Start batch). */
  viewActions?: (p: { id: number; name: string; d: T; ctx: Ctx }) => ReactNode;
  /** Last step before saving (e.g. render a thumbnail). */
  prepareSave?: (d: T, ctx: Ctx) => Promise<T>;
  summary: (d: T, ctx: Ctx) => string;
  /** Labelled values, used for the key facts panel and the History diff. */
  describe: (d: T, ctx: Ctx) => Record<string, string>;
  runFields: (d: T, ctx: Ctx) => RunField[];
  /** Row labels for staged run fields (e.g. each deposition rate). */
  runStages?: (d: T) => { label: string; expected?: string }[];
  /** Optional extra result computed from a run entry (e.g. actual formula from weighed masses). */
  runResult?: (d: T, values: Record<string, string>, ctx: Ctx) => ReactNode;
}

export const norm = <T,>(k: Kind<T>, d: unknown): T => ({ ...k.defaults(), ...(d as object) });
