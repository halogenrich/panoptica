import { z } from 'zod';

export const Role = z.enum(['admin', 'member']);
export const Visibility = z.enum(['private', 'shared']);
export const Segment = z.enum(['s0', 's1', 's2', 's3', 's4', 'stk', 'sub', 'mask']);

export const Login = z.object({ username: z.string().min(1), password: z.string().min(1) });
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
  password: z.string().min(10, 'password needs at least 10 characters').max(128).optional(),
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
  code: z.string().min(1).max(40),
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
  next: z.string().min(10, 'password needs at least 10 characters').max(128),
});

// ---- J–V measurements ----
/** What a sample (as named in the measurement files) is: a batch or a stack of this app. Groups for the statistics. */
export const IvLink = z.object({ kind: z.enum(['batch', 'stack']), id: z.number().int().positive() }).nullable();
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
});
/** Per device ("sample|substrate"): its device group for comparisons (`g`) and whether it is left out of the plots (`off`). */
export const IvDevice = z.object({ g: z.string().max(80).optional(), off: z.boolean().optional() });
export const IvSetIn = z.object({
  name: z.string().min(1).max(160),
  date: z.string().max(10),
  system: z.enum(['padrao', 'sun']),
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
  curves: z.array(IvCurveIn).min(1).max(5000),
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
export const TagIn = z.object({
  name: z.string().trim().min(1).max(40),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'pick a colour')
    .optional(),
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
export const BookingIn = z.object({
  equipment_id: z.number().int(),
  batch_id: z.number().int(),
  step: z.string().max(120).optional(),
  note: z.string().max(500).optional(),
  start: iso,
  end: iso,
  /** Admin only: book even if it overlaps another booking. */ force: z.boolean().optional(),
});
export const EquipmentRole = z.enum(['', 'scale', 'spinner', 'organic', 'metal']);
export const EquipmentIn = z.object({
  name: z.string().trim().min(1, 'name the equipment').max(80),
  role: EquipmentRole.optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  place: z.string().max(120).optional(),
  active: z.boolean().optional(),
});
/** Outcome of a booking once it has ended; postponing or canceling needs a reason. */
export const OutcomeIn = z
  .object({ outcome: z.enum(['done', 'postponed', 'canceled']), reason: z.string().trim().max(500).optional() })
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
