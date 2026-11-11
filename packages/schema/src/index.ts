import { z } from 'zod';

export const Role = z.enum(['admin', 'member']);
export const Visibility = z.enum(['private', 'shared']);
export const Segment = z.enum(['s0', 's1', 's2', 's3', 's4', 'stk', 'sub', 'mask']);

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
  name: z.string().trim().min(1, 'give the lab a name').max(80).optional(),
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

/** Selected ions with their subscript fractions, e.g. { A: { FA: 0.85, Cs: 0.15 }, X: { I: 1 } } */
export const Composition = z.object({
  A: z.record(z.string(), z.number().nonnegative()),
  X: z.record(z.string(), z.number().nonnegative()),
});

export const PresetIn = z.object({
  segment: Segment,
  name: z.string().min(1).max(120),
  visibility: Visibility,
  data: z.record(z.string(), z.unknown()),
  parent_id: z.number().int().positive().nullable().optional(),
});
export const RunIn = z.object({
  batch: z.string().max(40).default(''),
  values: z.record(z.string(), z.string().max(200)),
  notes: z.string().max(4000).default(''),
  deviation: z.string().max(2000).default(''),
});

export type Role = z.infer<typeof Role>;
export type Composition = z.infer<typeof Composition>;

export const ChemRole = z.enum(['salt', 'solvent', 'etl', 'htl', 'additive', 'organic', 'metal', 'other']);
export const ChemicalIn = z.object({
  name: z.string().min(1).max(60),
  role: ChemRole,
  f: z.string().max(60),
  M: z.number().nonnegative(),
  d: z.number().nonnegative().nullable(),
  pur: z.number().min(0).max(100),
  brand: z.string().max(80),
});

/** Look of a layer in the 3D view: colour, opacity, roughness, metallic (0–1). */
const Appearance = z
  .object({
    c: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    o: z.number().min(0).max(1).optional(),
    r: z.number().min(0).max(1).optional(),
    m: z.number().min(0).max(1).optional(),
  })
  .optional();
export const BatchIn = z.object({
  /** 0.38: optional; the server numbers batches by date (B-yymmdd-n) when none is given. */
  code: z.string().max(40).default(''),
  /** The stack the batch was started from (its variations are offered as variants). */
  source: z.number().int().positive().optional(),
  name: z.string().max(120).default(''),
  visibility: Visibility,
  stack: z.object({
    arch: z.string(),
    bid: z.string().optional(),
    thumb: z.string().max(2_000_000).optional(),
    sl: z.array(
      z.object({
        id: z.string().optional(),
        n: z.string(),
        m: z.string(),
        a: z.string(),
        b: z.string(),
        t: z.string(),
        th: z.number().optional(),
        ap: Appearance,
        apGlass: Appearance,
      }),
    ),
  }),
});
const Method = z.enum(['Substrate', 'Spin', 'Organic evap', 'Metal evap', 'Manual']);
const PresetRef = z.string().regex(/^\d*$/).max(20).default('');
/** One change of a variant from the default device (layer positions are those of the batch's stack). */
export const VarChangeIn = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('recipe'),
    slot: z.number().int().min(0),
    which: z.enum(['a', 'b']),
    id: z.number().int().positive(),
  }),
  z.object({
    t: z.literal('layer'),
    after: z.number().int().min(0),
    n: z.string().trim().min(1, 'name the new layer').max(80),
    m: Method.exclude(['Substrate']),
    a: PresetRef,
    b: PresetRef,
    th: z.number().positive().max(1e5).optional(),
  }),
  z.object({ t: z.literal('remove'), slot: z.number().int().min(1, 'the substrate cannot be left out') }),
  z.object({
    t: z.literal('additive'),
    slot: z.number().int().min(0),
    name: z.string().trim().min(1, 'name the additive').max(120),
    amount: z.string().trim().max(60).default(''),
  }),
  z.object({
    t: z.literal('other'),
    slot: z.number().int().min(0).nullable().default(null),
    text: z.string().trim().min(1, 'describe the change').max(400),
  }),
]);
export const VariantIn = z
  .object({
    id: z
      .string()
      .regex(/^[A-Z][0-9]*$/)
      .max(6),
    name: z.string().trim().min(1, 'name each variant').max(60),
    substrates: z.string().trim().max(120).default(''),
    /** A premade variation: another stack, frozen when linked. Otherwise `changes` from the default device. */
    stack: z.number().int().positive().nullable().default(null),
    changes: z.array(VarChangeIn).max(20).default([]),
  })
  .refine((v) => v.stack || v.changes.length, {
    message: 'a variant links to a stack variation or lists what changes from the default device',
  });
export const VariantsIn = z.object({
  /** Substrates of the default device (the control). */
  control: z.string().trim().max(120).default(''),
  list: z.array(VariantIn).max(26),
});

export const BatchPatch = z.object({
  name: z.string().max(120).optional(),
  status: z.enum(['planned', 'running', 'done']).optional(),
  visibility: Visibility.optional(),
  record: z.record(z.string(), z.unknown()).optional(),
});

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

// ---- J–V measurements ----
/** What a sample (as named in the measurement files) is: a batch or a stack of this app. Groups for the statistics. */
export const IvLink = z
  .object({
    kind: z.enum(['batch', 'stack']),
    id: z.number().int().positive(),
    /** For a batch: which of its variants the sample is (none: the default device). */
    variant: z.string().max(6).optional(),
  })
  .nullable();
export const IvCurveIn = z.object({
  file: z.string().max(400),
  sample: z.string().max(160),
  substrate: z.string().max(20),
  scan: z.string().max(20),
  pixel: z.string().max(12),
  dir: z.enum(['fwd', 'rev']),
  area: z.number().min(0).max(1000),
  pin: z.number().positive().max(10000),
  V: z.array(z.number()).min(3).max(20000),
  J: z.array(z.number()).min(3).max(20000),
  inst: z.record(z.string(), z.number().nullable()).optional(),
  /** Lifetime runs: seconds since the start of the run. */
  t: z.number().min(0).max(1e8).optional(),
});
/** Per device ("sample|substrate"): its device group for comparisons (`g`) and whether it is left out of the plots (`off`). */
export const IvDevice = z.object({ g: z.string().max(80).optional(), off: z.boolean().optional() });
export const IvSetIn = z.object({
  name: z.string().min(1).max(160),
  date: z.string().max(10),
  // 'padrao' and 'sun' were the names before 0.38 (old exports and backups)
  system: z.preprocess((v) => (v === 'padrao' ? 'csv' : v === 'sun' ? 'txt' : v), z.enum(['csv', 'txt'])),
  visibility: Visibility,
  links: z.record(z.string(), IvLink).default({}),
  notes: z.string().max(5000).default(''),
  devices: z.record(z.string(), IvDevice).default({}),
  /** Stability test: this is a follow-up of that measurement, measured at `measured_at` (ISO). */
  stability_of: z.number().int().nullable().optional(),
  measured_at: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), 'a date and time')
    .transform((v) => new Date(v).toISOString())
    .nullable()
    .optional(),
  /** A lifetime run (the same pixels scanned over time) or an ordinary J–V measurement. */
  kind: z.enum(['jv', 'lifetime']).default('jv'),
  /** Lifetime runs: the run's name and settings, and light/temperature readings when those sensors were connected. */
  life: z
    .object({
      run: z.string().max(160),
      start: z.string().max(30),
      settings: z.record(z.string(), z.string().max(400)),
      times: z.array(z.number()).max(20000),
      light: z.array(z.object({ t: z.number(), photodiode: z.number(), temp: z.number() })).max(20000),
      sensors: z.boolean(),
    })
    .optional(),
  curves: z.array(IvCurveIn).min(1).max(60000),
});
export const IvSetPatch = z.object({
  name: z.string().min(1).max(160).optional(),
  visibility: Visibility.optional(),
  links: z.record(z.string(), IvLink).optional(),
  notes: z.string().max(5000).optional(),
  devices: z.record(z.string(), IvDevice).optional(),
  stability_of: z.number().int().nullable().optional(),
  measured_at: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), 'a date and time')
    .transform((v) => new Date(v).toISOString())
    .nullable()
    .optional(),
});
export const IvCurvePatch = z.object({ use: z.boolean().nullable() });

// ---- comments on presets and batches ----
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
  name: z.string().trim().min(1, 'name the chemical').max(120),
  chem_id: z.number().int().nullable().optional(),
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
export const InventoryImport = z.object({
  rows: z
    .array(
      ContainerIn.omit({ area_id: true, shelf_id: true, unit: true }).extend({
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
export const EquipmentRole = z.enum(['', 'prep', 'scale', 'spinner', 'organic', 'metal', 'measure']);
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
/** The bookings for every step of a batch. */
export const ScheduleIn = z.object({
  items: z
    .array(
      z.object({
        equipment_id: z.number().int(),
        step: z.string().trim().min(1).max(120),
        start: iso,
        end: iso,
        force: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(60),
});
/** App-wide fun: seconds between breaking-news headlines (admin, in the funny settings). */
export const FunIn = z.object({ newsGap: z.number().int().min(5).max(3600) });

/** A comparison: custom groups of devices picked from any measurements (0.30). Private by default. */
export const CmpMember = z.object({
  set: z.number().int(),
  sample: z.string().max(200),
  substrate: z.string().max(40),
});
export const CmpGroup = z.object({
  id: z.string().min(1).max(40),
  name: z.string().max(120),
  ref: z.boolean().optional(),
  members: z.array(CmpMember).max(2000),
});
export const CmpData = z.object({
  groups: z.array(CmpGroup).max(24),
  dir: z.enum(['rev', 'fwd', 'both']).optional(),
  relative: z.boolean().optional(),
  metrics: z
    .array(z.enum(['pce', 'voc', 'jsc', 'ff', 'rs', 'rsh']))
    .max(6)
    .optional(),
});
export const ComparisonIn = z.object({
  name: z.string().min(1).max(160),
  visibility: Visibility.default('private'),
  notes: z.string().max(5000).default(''),
  data: CmpData,
});
export const ComparisonPatch = z.object({
  name: z.string().min(1).max(160).optional(),
  visibility: Visibility.optional(),
  notes: z.string().max(5000).optional(),
  data: CmpData.optional(),
});

/** A new order for a list (ids from first to last). */
export const OrderIn = z.object({ ids: z.array(z.number().int()).max(500) });
