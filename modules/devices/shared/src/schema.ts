import { z } from 'zod';
import { Visibility } from '@psc/schema';

/** What the Electronic Devices module's routes accept (0.43): recipes and stacks, batches and variants, J–V measurements, the
 * batch scheduler, comparisons. */
export const Segment = z.enum(['s0', 's1', 's2', 's3', 's4', 'stk', 'sub', 'mask']);

const iso = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'a date and time')
  .transform((v) => new Date(v).toISOString());

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

export type Composition = z.infer<typeof Composition>;

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
  /** The stack the batch was started from (its variations are offered as variants). */
  source: z.number().int().positive().optional(),
  /** what the batch is called; names tell batches apart (0.45: there are no batch codes to type or read) */
  name: z.string().max(120),
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
  // 0.52.1: the statistic the tables show (with ± SD); median when absent
  stat: z.enum(['median', 'mean']).optional(),
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
