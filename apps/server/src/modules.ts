import type { FastifyInstance } from 'fastify';
import { licenceAtStart, licensed } from './licence.js';

/**
 * What a module adds to the core (0.41): the things bookings can be for, and the steps equipment can do. The core (calendar,
 * equipment) only knows them through this registry, never by name; the Electronic Devices module (devices.ts) registers
 * batches and the photovoltaics steps, and a test module registers its own to prove nothing else is assumed.
 */

/** The person asking, as the routes see them. */
export type Who = { id: number; name: string; role: string };
/** Equipment as a subject sees it: measuring equipment (J–V measurement, say) takes finished work and asks no outcome. */
export type EqFacts = { id: number; name: string; measuring: boolean };
/** A subject as bookings show it. */
export type SubjectInfo = { code: string; name: string; status: string; owner_id: number; gone: boolean };
export type Choice = { id: number; code: string; name: string; status?: string };

export interface BookingSubject {
  /** stored in bookings.subject ('batch') */
  kind: string;
  /** the module it comes from ('devices') */
  module: string;
  /** what one is called in sentences ('batch', 'batches') */
  noun: string;
  plural: string;
  /** code, name, status and owner of each of these ids; gone: deleted or in the trash (its bookings are hidden) */
  info(ids: number[]): Map<number, SubjectInfo>;
  /** why `u` cannot book `eq` for it (null when they can) */
  refuse(u: Who, id: number, eq: EqFacts, isNew: boolean): { status: number; error: string } | null;
  /** why its bookings on this equipment cannot change now (a locked record), or null */
  locked(id: number, eq: EqFacts): string | null;
  /** an outcome (concluded, postponed, canceled) is asked when a booking for it ends on this equipment */
  asksOutcome(eq: EqFacts): boolean;
  /** an outcome was given for one of its bookings */
  outcomeGiven(id: number): void;
  /** bookings were added or moved, or time passed */
  tick(): void;
  /** what `u` can book for: open ones, and finished ones (for measuring equipment) */
  choices(u: Who): { open: Choice[]; finished: Choice[] };
  /** the page one opens on in the app ('batches'), for "Open batch" in the booking form (0.43) */
  view?: string;
  /** shown in the Calendar when there is none to book for ("start one from a stack") */
  hint?: string;
  /** the steps of one, offered in the booking form (a batch's layers); `u` may see it */
  steps?(u: Who, id: number): string[];
}

export type StepDef = {
  key: string;
  label: string;
  /** heading the step is listed under on the equipment page */
  group: string;
  module: string;
  /** equipment that can do it measures finished work: it takes a finished subject or a reason, and asks no outcome */
  measures?: boolean;
};

/** Where something opens in the app: a page, and the item on it (the web turns it into `#/view/id`). */
export type Link = { view: string; id: number | null };

/**
 * A kind of record a module keeps (0.42): what comments, the trash, search, sharing and links know about it. Its table has `id`,
 * `owner_id`, `visibility` ('private' or 'shared') and `deleted_at` (moved to the trash when set).
 */
export interface ItemKind {
  /** stored in comments.target and used in `/api/trash/:kind` ('batch') */
  kind: string;
  module: string;
  table: string;
  /** the columns `describe` reads, besides id, owner_id and visibility */
  cols: string;
  /** its name, what type of record it is (in the trash), how sentences name it, and where it opens */
  describe(r: any): { name: string; type: string; title?: string; link: Link };
  /** it can be commented on */
  comments?: boolean;
  /** what else goes when it is removed for good (its comments and bookings are removed by the core) */
  purge?(id: number): void;
  /** it came back from the trash (a batch that had started takes its amounts from the containers again, 0.45) */
  restored?(id: number): void;
  /** search hits among the records `p` may open (newest or best first, a few) */
  search?(q: string, p: { q: string; uid: number; all: 0 | 1 }): SearchHit[];
}
export type SearchHit = { key: string; label: string; hint: string; link: Link };

/** Inventory use a module reports (0.42): the core only sums it per chemical and period. */
/** `run`: the amount comes from what was recorded (run data), not from the plan (0.45.1). */
export type ChemUse = { name: string; mg?: number; ul?: number; run?: boolean };
export type UseEvent = {
  /** what it was used for (a batch's name), and when */
  label: string;
  date: string;
  owner_id: number;
  shared: boolean;
  uses: ChemUse[];
};
export type UseReport = {
  /** one sentence on where the amounts come from, with the number of records ('From the recipes of 4 …') */
  basis(n: number): string;
  events(): UseEvent[];
};

/** The period an overview covers, and whose work is in view (null: the whole lab). */
export type Period = {
  from: Date;
  to: Date;
  unit: 'week' | 'month';
  inScope: (userId: number) => boolean;
  users: { id: number; name: string }[];
};
/** A module's part of the Overview (0.42): its numbers for the period and per person, and its part of one person's page. */
export type OverviewPart = {
  period(p: Period): { people: Record<number, Record<string, unknown>>; [k: string]: unknown };
  person(userId: number): Record<string, unknown>;
};

export type Module = {
  id: string;
  /** what people call it (the licence page) */
  name?: string;
  subjects?: BookingSubject[];
  steps?: StepDef[];
  items?: ItemKind[];
  uses?: UseReport;
  overview?: OverviewPart;
  /** permissions a tag can give besides the core's (0.58: Electronic Devices' "designs"); the module checks them itself */
  perms?: string[];
  /**
   * The one procedure (`equipment.role`) older parts of a module still read, from what an equipment can do; and the steps for a
   * procedure given by an older client (0.43).
   */
  equipment?: { role(steps: readonly string[]): string; stepsFor(role: string, name: string): string[] };
  /** Readable names of its routes in the activity log ('POST /api/batches': 'Started a batch'), and how to name what a route
   * changes: [route prefix, SQL giving `n` for the id]. */
  audit?: { labels: Record<string, string>; names?: [string, string][] };
  /** What pages reload after a change to its routes (live updates): [route pattern, topics]. */
  topics?: [RegExp, string[]][];
  /** Its database changes (0.53): run again on a backup being restored, to bring it to this version. */
  migrations?: import('./schema.js').Migration[];
  /** A line about its data in a backup that was just checked ("12 recipes and designs"). */
  backupCheck?(db: import('node:sqlite').DatabaseSync): string;
  /**
   * A substance was renamed, or merged into another (0.54): its records that name `from` (recipes) now name `to`. What was
   * recorded in the past (batch snapshots, run data) keeps the old name.
   */
  substanceRenamed?(from: string, to: string): void;
  /** its routes, registered after the core's */
  register?: (app: FastifyInstance, auth: (need?: any) => any, bad: (reply: any, p: any) => any) => void;
};

const mods: Module[] = [],
  skipped: Module[] = [],
  /** record types of the core itself (0.54: substances, for the trash) */
  coreItems: ItemKind[] = [];
export const addCoreItem = (k: ItemKind) => {
  if (!coreItems.some((x) => x.kind === k.kind)) coreItems.push(k);
};
let licenceNote: string | null = null;
/** Once, before the first module starts: installs a licence file the installer left (0.46); the line for the log. */
export const licenceStart = () => (licenceNote ??= licenceAtStart());
/** Modules in the package that the licence does not list: they do not start (0.46). */
export const skippedModules = () => skipped.map((m) => m.id);
/** Every module in the package, running or not, by id: its name. */
export const moduleNames = () => Object.fromEntries([...mods, ...skipped].map((m) => [m.id, m.name ?? m.id]));
export function addModule(m: Module) {
  licenceStart();
  if (!licensed(m.id)) {
    skipped.push(m);
    return;
  }
  if (mods.some((x) => x.id === m.id)) throw new Error(`module ${m.id} added twice`);
  for (const s of m.subjects ?? []) if (subject(s.kind)) throw new Error(`booking subject ${s.kind} is already taken`);
  for (const s of m.steps ?? []) if (stepDefs().some((x) => x.key === s.key)) throw new Error(`step ${s.key} is taken`);
  for (const i of m.items ?? []) if (item(i.kind)) throw new Error(`record type ${i.kind} is already taken`);
  mods.push(m);
}
export const modules = () => [...mods];
/** The database changes of every module in the package, running or not (their tables exist either way). */
export const allMigrations = () => [...mods, ...skipped].flatMap((m) => (m.migrations ? [m.migrations] : []));
export const subjects = () => mods.flatMap((m) => m.subjects ?? []);
export const subject = (kind: string) => subjects().find((s) => s.kind === kind);
export const stepDefs = () => mods.flatMap((m) => m.steps ?? []);
export const stepKeys = () => stepDefs().map((s) => s.key);
/** Equipment that can do a measuring step measures finished work. */
export const measuring = (steps: readonly string[]) => steps.some((k) => stepDefs().find((s) => s.key === k)?.measures);
export const items = () => [...coreItems, ...mods.flatMap((m) => m.items ?? [])];
/** The procedure (role) of equipment that can do these steps, from the first module that names one. */
export const roleOf = (steps: readonly string[]) => mods.map((m) => m.equipment?.role(steps) ?? '').find(Boolean) ?? '';
export const stepsOfRole = (role: string, name: string) =>
  mods.map((m) => m.equipment?.stepsFor(role, name) ?? []).find((x) => x.length) ?? [];
export const item = (kind: string) => items().find((i) => i.kind === kind);

/** Sharing, one rule for every record type: the owner, anyone when it is shared, and admins and the Professor (`all`). */
export const canSee = (u: { id: number; all?: boolean }, r: { owner_id: number; visibility: string }) =>
  r.owner_id === u.id || r.visibility === 'shared' || !!u.all;
