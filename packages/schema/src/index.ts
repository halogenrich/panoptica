import { z } from 'zod';

export const Role = z.enum(['admin', 'member']);
export const Visibility = z.enum(['private', 'shared']);

export const Login = z.object({ username: z.string().min(1), password: z.string().min(1) });
/** The password rules (length, upper case, number, special character) are checked by the server with `passwordProblem`. */
const Password = z.string().min(1, 'choose a password').max(512);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'give the date');
const Photo = z
  .string()
  .max(400_000, 'the photo is too large')
  .refine(
    (v) => v === '' || /^data:image\/(png|jpeg|webp);base64,/.test(v),
    'the photo must be a PNG, JPEG or WebP image',
  );
/** A person's names: the username is built from every first name and the first letter(s) of the chosen surname. */
const Names = {
  firstNames: z.string().trim().min(1, 'give your first name').max(60),
  surnames: z.string().trim().min(1, 'give your surname').max(80),
  surname: z.string().trim().min(1, 'choose the surname for your username').max(40),
};
const Email = z.string().trim().toLowerCase().email('give a valid email address').max(120);
export const AccessRequestIn = z.object({
  ...Names,
  email: Email,
  birthDate: Day,
  department: z.string().trim().min(1, 'choose your department').max(80),
  supervisor: z.string().trim().min(1, 'give your supervisor').max(80),
  cosupervisor: z.string().trim().max(80).optional(),
  /** optional when asking; required by the first sign-in instead */
  photo: Photo.default(''),
});
/** Admins create accounts only for visitors, with the day their access ends. */
export const VisitorIn = z.object({
  ...Names,
  email: Email,
  birthDate: Day,
  department: z.string().trim().max(80).optional(),
  until: Day,
});
export const LoginCheck = z.object({ username: z.string().trim().min(1).max(60) });
/**
 * First sign-in (or after a reset): the person confirms the birth date on the account (the email instead, for an account without
 * one, such as some visitors) and, if the account has no photo yet, adds one.
 */
export const LoginSet = z.object({
  username: z.string().trim().min(1).max(60),
  email: z.string().trim().max(120).default(''),
  birthDate: z.string().max(10).default(''),
  photo: Photo.optional(),
  password: Password,
});
export const AcceptIn = z.object({ tags: z.array(z.number().int()).max(50).default([]) });
export const DeclineIn = z.object({ reason: z.string().trim().max(300).default('') });
const HM = z.string().regex(/^([01]\d|2[0-4]):[0-5]\d$/, 'time as HH:MM');
export const WorkDayIn = z.object({ on: z.boolean(), from: HM, to: HM });
const Background = z
  .string()
  .max(8_000_000, 'the image is too large (up to about 5 MB)')
  .refine((v) => v === '' || /^data:image\/(png|jpeg|webp);base64,/.test(v), 'use a JPEG, PNG or WebP image');
/** Lab setup: name, institution, who may ask for access (email domains), departments, working hours, login images. */
export const LabIn = z.object({
  name: z.string().trim().min(1, 'give the lab’s full name').max(120).optional(),
  /** 0.49: the lab's acronym, and which of the two names the interface shows */
  acronym: z.string().trim().max(24).optional(),
  show: z.enum(['name', 'acronym']).optional(),
  institution: z.string().trim().max(120).optional(),
  domains: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, 'a domain like example.edu'),
    )
    .max(20)
    .optional(),
  departments: z.array(z.string().trim().min(1).max(80)).max(60).optional(),
  hours: z.array(WorkDayIn).length(7).optional(),
  background: Background.optional(),
  logo: z.string().max(1_400_000).optional(),
  logoPos: z.enum(['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br']).optional(),
  logoPlate: z.boolean().optional(),
  instLogo: z.string().max(1_400_000).optional(),
  foot: z.enum(['name', 'logo', 'both']).optional(),
});
/** The first setup, on the computer that runs the app: the first admin and the lab. */
/**
 * Network settings (0.51): who can open PANOPTICA, the lab's address, the port (none: 80, or 443 with HTTPS) and HTTPS with a
 * certificate from IT, as its PEM text with the key's, or a PFX file (base64) with its password. Without `cert`, the
 * certificate already kept is used. The address is cleaned and checked by the server (`cleanAddress`, `addressProblem`).
 */
export const NetworkIn = z.object({
  open: z.enum(['computer', 'network']),
  address: z.string().max(300).default(''),
  port: z
    .number()
    .int()
    .min(1, 'a port is a number from 1 to 65535')
    .max(65535, 'a port is a number from 1 to 65535')
    .nullish(),
  https: z.boolean().default(false),
  cert: z
    .union([
      z.object({ pem: z.string().min(1).max(200_000), key: z.string().min(1).max(200_000) }),
      z.object({ pfx: z.string().min(1).max(400_000), pass: z.string().max(200).default('') }),
    ])
    .optional(),
});
export const SetupIn = z.object({
  admin: z.object({
    ...Names,
    email: Email,
    birthDate: Day,
    department: z.string().trim().max(80).optional(),
    photo: Photo.optional(),
    password: Password,
  }),
  lab: LabIn,
  /** the one-time setup code, when the setup is done from another computer (0.46) */
  code: z.string().max(40).optional(),
  /** the Network step (0.51); from another computer only the lab's address is taken */
  network: NetworkIn.partial({ open: true }).optional(),
});
export const NewUser = z.object({
  username: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[a-zA-Z0-9._-]+$/, 'letters, digits, . _ - only'),
  name: z.string().min(1).max(80),
  role: Role,
  password: z.string().min(10, 'password needs at least 10 characters').max(128),
});
export const UserPatch = z.object({
  name: z.string().min(1).max(80).optional(),
  role: Role.optional(),
  active: z.boolean().optional(),
  /** clears the password: the person sets a new one at the next sign-in, confirming their email and birth date */
  resetPassword: z.literal(true).optional(),
  department: z.string().trim().max(80).optional(),
  supervisor: z.string().trim().max(80).optional(),
  cosupervisor: z.string().trim().max(80).optional(),
  email: z.string().trim().toLowerCase().max(120).optional(),
  birthDate: Day.or(z.literal('')).optional(),
  until: Day.or(z.literal('')).optional(),
});

export type Role = z.infer<typeof Role>;

export const ChemRole = z.enum(['salt', 'solvent', 'etl', 'htl', 'additive', 'organic', 'metal', 'other']);
/**
 * A substance (0.44): what recipes name, made from the containers people add or import. Purity and brand belong to each
 * container, not here. Roles are filters (a salt can also be an additive); `pf` and `army`: controlled by the Federal Police or
 * the Army.
 */
const opt = z.number().finite().nullable().optional();
export const SubstanceIn = z.object({
  name: z.string().trim().min(1).max(120),
  cas: z.string().trim().max(20).optional(),
  /** short name (0.54): DMF, MeO-2PACz */
  s: z.string().trim().max(40).optional(),
  /** other names search finds (0.54) */
  aka: z.array(z.string().trim().max(160)).max(20).optional(),
  f: z.string().trim().max(60).optional(),
  M: z.number().nonnegative().optional(),
  d: opt,
  mp: opt,
  bp: opt,
  nD: opt,
  roles: z.array(ChemRole).max(8).optional(),
  ghs: z
    .array(z.string().regex(/^GHS0\d$/))
    .max(9)
    .optional(),
  pf: z.boolean().optional(),
  army: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
});

/** Merge a substance into another (0.54). */
export const SubstanceMerge = z.object({ into: z.number().int().positive() });
/** Two substances people said are not the same (0.54). */
export const SubstancePair = z.object({ a: z.number().int().positive(), b: z.number().int().positive() });

const Watermark = z
  .string()
  .max(1_500_000, 'the logo image is too large (max about 1 MB)')
  .refine(
    (v) => v === '' || /^data:image\/(png|jpeg|svg\+xml);base64,/.test(v),
    'the logo must be a PNG, JPEG or SVG image',
  );
export const PrefsIn = z.object({
  theme: z.enum(['system', 'light', 'dark']).optional(),
  vis: Visibility.optional(),
  /** Whether this user's exported figures carry the group logo (the logo itself is set by an admin). */
  logo: z.boolean().optional(),
  /** Show the eye next to search while the professor is online (default on). */
  eye: z.boolean().optional(),
  /** Funny setting: the breaking-news strip in the header. */
  news: z.boolean().optional(),
  /** Earlier versions kept the logo per user; still accepted, no longer used. */
  watermark: Watermark.optional(),
  group: z.string().max(120).optional(),
});
/** Group logo and name stamped on exported figures: one for the whole app, set by an admin. '' removes the logo. */
export const FigureSettingsIn = z.object({ watermark: Watermark.optional(), group: z.string().max(120).optional() });
export const PasswordIn = z.object({
  current: z.string().min(1),
  next: Password,
});

// ---- comments on any record a module keeps ----
/** Suggested reactions (shown first); any single emoji from the emoji keyboard is accepted. */
export const EMOJI = ['👍', '❤️', '🎉', '😮', '🤔'] as const;
export const CommentIn = z.object({
  text: z.string().trim().min(1, 'write something first').max(4000),
  parent_id: z.number().int().optional(),
  /** Professor only: seen by her and the owner of the stack or batch. Replies to a private comment are private too. */
  private: z.boolean().optional(),
});
export const ReactIn = z.object({
  emoji: z
    .string()
    .min(1)
    .max(32)
    .refine(
      (e) =>
        /^\p{Extended_Pictographic}|^\p{Regional_Indicator}|^[#*0-9]\uFE0F?\u20E3/u.test(e) &&
        [...new Intl.Segmenter().segment(e)].length === 1,
      'one emoji only',
    ),
});
/** Copy of every backup to a second place (network drive, synced cloud folder). '' turns it off. */
export const BackupMirrorIn = z.object({ dir: z.string().max(500), encrypt: z.boolean().optional() });
/** Update settings: GitHub repository (owner/name) and a read-only token; an empty token removes it, a missing one keeps it. */
export const UpdateSettingsIn = z.object({
  repo: z
    .string()
    .regex(/^[\w.-]+\/[\w.-]+$/, 'repository as owner/name')
    .optional(),
  token: z.string().max(400).optional(),
});

/** Own profile: display name and photo (square JPEG or PNG, resized in the browser; '' removes it). */
export const ProfileIn = z.object({
  name: z.string().trim().min(1, 'the name cannot be empty').max(80).optional(),
  email: z.string().trim().toLowerCase().email('give a valid email address').max(120).optional(),
  birthDate: Day.optional(),
  department: z.string().trim().max(80).optional(),
  supervisor: z.string().trim().max(80).optional(),
  cosupervisor: z.string().trim().max(80).optional(),
  /** whether the birthday shows in the calendar (day and month only) */
  showBirthday: z.boolean().optional(),
  photo: z
    .string()
    .max(400_000, 'the photo is too large')
    .refine(
      (v) => v === '' || /^data:image\/(png|jpeg|webp);base64,/.test(v),
      'the photo must be a PNG, JPEG or WebP image',
    )
    .optional(),
});
export const TagKind = z.enum(['label', 'professor', 'manager', 'inventory']);
export const TagPerm = z.enum(['comments', 'overview', 'inventory', 'equipment', 'training']);
export const TagIn = z.object({
  name: z.string().trim().min(1).max(40),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'pick a colour')
    .optional(),
  /** what the tag gives (empty: a label) */
  perms: z.array(TagPerm).max(5).optional(),
});
export const UserTagsIn = z.object({ tags: z.array(z.number().int()).max(50) });

// ---- inventory ----
export const AreaKind = z.enum(['cabinet', 'desiccator', 'glovebox', 'fridge', 'freezer', 'shelf', 'other']);
export const AreaIn = z.object({
  name: z.string().trim().min(1, 'give the storage a name').max(80),
  type_id: z.number().int().nullable().optional(),
  place: z.string().max(120).optional(),
  notes: z.string().max(1000).optional(),
  /** Shelf names to create with a new area. */
  shelves: z.array(z.string().trim().min(1).max(60)).max(40).optional(),
});
export const ShelfIn = z.object({ name: z.string().trim().min(1, 'name the division').max(60) });
export const StorageIcon = z.enum([
  'cabinet',
  'desiccator',
  'glovebox',
  'fridge',
  'freezer',
  'shelf',
  'box',
  'flask',
  'flame',
  'drawer',
]);
export const StorageTypeIn = z.object({
  name: z.string().trim().min(1, 'name the type').max(40),
  icon: StorageIcon.optional(),
});
export const Unit = z.enum(['mg', 'g', 'kg', 'µL', 'mL', 'L']);
const num = z.number().finite().nonnegative().nullable().optional();
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'dates as YYYY-MM-DD')
  .nullable()
  .optional()
  .or(z.literal('').transform(() => null));
export const ContainerIn = z.object({
  /** the substance: its id, or a name (and CAS) to find or make it by */
  name: z.string().trim().min(1, 'name the chemical').max(120),
  chem_id: z.number().int().nullable().optional(),
  /** the container recipes use for this substance (the one in the glovebox) */
  use: z.boolean().optional(),
  barcode: z.string().max(60).optional(),
  cas: z.string().max(40).optional(),
  /** Amount left and full size of the container, in `unit`. */
  amount: num,
  size: num,
  unit: Unit,
  status: z.enum(['unopened', 'in use', 'empty']).optional(),
  area_id: z.number().int().nullable().optional(),
  shelf_id: z.number().int().nullable().optional(),
  supplier: z.string().max(120).optional(),
  lot: z.string().max(60).optional(),
  purity: z.number().min(0).max(100).nullable().optional(),
  expires: day,
  opened: day,
  notes: z.string().max(2000).optional(),
});
/**
 * An import (0.44): the substances found (each with a `key`, its CAS number or name) and the containers, each naming its
 * substance's key. Storage places and divisions are made by name when missing.
 */
export const InventoryImport = z.object({
  substances: z.array(SubstanceIn.extend({ key: z.string().min(1).max(160) })).max(5000),
  containers: z
    .array(
      ContainerIn.omit({
        area_id: true,
        shelf_id: true,
        unit: true,
        name: true,
        chem_id: true,
        cas: true,
        use: true,
      }).extend({
        key: z.string().min(1).max(160),
        unit: Unit.optional(),
        area: z.string().max(80).optional(),
        shelf: z.string().max(60).optional(),
      }),
    )
    .max(5000),
});

// ---- equipment calendar ----
/** Any date-time with an offset, stored as UTC ISO (…Z) so the server can compare times as text. */
const iso = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'a date and time')
  .transform((v) => new Date(v).toISOString());
export const BookingIn = z.preprocess(
  // before 0.41 a booking named its batch (batch_id); it now names a subject a module defines
  (v: any) =>
    v && typeof v === 'object' && 'batch_id' in v && !('subject' in v)
      ? { ...v, subject: v.batch_id ? 'batch' : '', subject_id: v.batch_id ?? null }
      : v,
  z
    .object({
      equipment_id: z.number().int(),
      /** what the booking is for: a subject a module defines ('batch'), or '' for a booking outside one, which then needs `purpose` */
      subject: z.string().max(40).optional(),
      subject_id: z.number().int().nullable().optional(),
      /** what a booking outside a batch is for (for the J–V measurement equipment: why it is booked without a finished batch) */
      purpose: z.string().trim().max(200).optional(),
      step: z.string().max(120).optional(),
      note: z.string().max(500).optional(),
      start: iso,
      end: iso,
      /** Admin only: book even if it overlaps another booking. */ force: z.boolean().optional(),
    })
    .refine((b) => !b.subject || !!b.subject_id, { message: 'choose what the booking is for', path: ['subject_id'] }),
);
/** Before 0.38 equipment had one procedure instead of steps; the modules say which names they know (0.43). */
export const EquipmentRole = z.string().trim().max(20);
export const EquipmentIn = z.object({
  name: z.string().trim().min(1, 'name the equipment').max(80),
  role: EquipmentRole.optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  place: z.string().max(120).optional(),
  active: z.boolean().optional(),
  /** Minutes blocked after each booking for cleaning (gloveboxes: 20). */
  cleanup: z.number().int().min(0).max(240).optional(),
  /** The drawing shown for it ('' = chosen from its use and name). */
  art: z
    .enum([
      '',
      'balance',
      'spincoater',
      'organic',
      'metal',
      'uvozone',
      'hotplate',
      'glovebox',
      'solarsim',
      'profilometer',
      'ultrasonic',
      'generic',
    ])
    .optional(),
});
/** Outcome of a booking once it has ended; postponing or canceling needs a reason. */
/** The glovebox atmosphere at the end of a booking, in ppm (0.38: asked for equipment that records it). */
export const AtmoIn = z.object({ o2: z.number().min(0).max(1e6), h2o: z.number().min(0).max(1e6) });
export const OutcomeIn = z
  .object({
    outcome: z.enum(['done', 'postponed', 'canceled']),
    reason: z.string().trim().max(500).optional(),
    atmo: AtmoIn.optional(),
  })
  .refine((o) => o.outcome === 'done' || (o.reason ?? '').length >= 3, {
    message: 'say why it was postponed or canceled',
    path: ['reason'],
  });
/** App-wide fun: seconds between breaking-news headlines (admin, in the funny settings). */
export const FunIn = z.object({ newsGap: z.number().int().min(5).max(3600) });

/** A new order for a list (ids from first to last). */
export const OrderIn = z.object({ ids: z.array(z.number().int()).max(500) });
