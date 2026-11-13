/**
 * What the core offers modules on the server (0.43): the database and its change list, the module registry, notifications, the
 * calendar's booking rules, and the signed-in user's type. A module imports only from here (`@psc/server/api`), never from the
 * core's other files, so the core can change inside without breaking modules.
 */
export { db, tx, perms, tagsOf } from './db.js';
export { migrate, add, has, meta, mark, type Migration } from './schema.js';
export { notify } from './social.js';
export { substances, type Substance, type Bottle } from './chemicals.js';
export {
  addModule,
  canSee,
  measuring,
  type BookingSubject,
  type ChemUse,
  type EqFacts,
  type ItemKind,
  type Link,
  type Module,
  type OverviewPart,
  type Period,
  type SearchHit,
  type StepDef,
  type SubjectInfo,
  type UseEvent,
  type UseReport,
  type Who,
} from './modules.js';
export {
  after,
  bookingOut,
  bookingsWhere,
  clashes,
  clashText,
  cleanupOf,
  slotProblem,
  tickSubjects,
} from './calendar.js';
export type { User } from './index.js';
