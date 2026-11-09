import { useState } from 'react';
import { DEFAULT_HOURS, surnameChoices, type WorkDay } from '@psc/core';
import { api } from '../api';
import type { LabPublic, Me } from '../ctx';
import { SignInFrame } from './Login';
import {
  NameFields,
  PasswordRules,
  PhotoField,
  Wordmark,
  passwordOk,
  readImage,
  todayIso,
  type NameParts,
} from './parts';

/** The lab's settings as edited: lists as text, images as data URLs ('' none, undefined unchanged). */
export type LabDraft = {
  name: string;
  institution: string;
  domains: string;
  departments: string;
  hours: WorkDay[];
  background?: string;
  logo?: string;
  instLogo?: string;
  logoPos: string;
  logoPlate: boolean;
  foot: 'name' | 'logo' | 'both';
};
export const blankLab = (): LabDraft => ({
  name: '',
  institution: '',
  domains: '',
  departments: '',
  hours: DEFAULT_HOURS.map((d) => ({ ...d })),
  logoPos: 'br',
  logoPlate: true,
  foot: 'name',
});
const list = (s: string, sep: RegExp) =>
  s
    .split(sep)
    .map((x) => x.trim())
    .filter(Boolean);
/** What the server takes (PUT /api/lab, the setup's `lab`). */
export const labBody = (d: LabDraft) => ({
  name: d.name.trim(),
  institution: d.institution.trim(),
  domains: list(d.domains, /[\s,;]+/).map((x) => x.replace(/^@/, '').toLowerCase()),
  departments: [...new Set(list(d.departments, /\n/))],
  hours: d.hours,
  logoPos: d.logoPos,
  logoPlate: d.logoPlate,
  foot: d.foot,
  ...(d.background !== undefined ? { background: d.background } : {}),
  ...(d.logo !== undefined ? { logo: d.logo } : {}),
  ...(d.instLogo !== undefined ? { instLogo: d.instLogo } : {}),
});

/** Name, institution, who may ask for access, departments. */
export function LabFields({ d, set }: { d: LabDraft; set: (p: Partial<LabDraft>) => void }) {
  return (
    <>
      <div className="grid2">
        <label className="fld">
          <span>Lab name</span>
          <input value={d.name} placeholder="e.g. LNES" onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="fld">
          <span>Institution</span>
          <input
            value={d.institution}
            placeholder="e.g. Unicamp"
            onChange={(e) => set({ institution: e.target.value })}
          />
        </label>
      </div>
      <p className="wm-sample">
        Shown as <Wordmark lab={d.name.trim() || undefined} size="s" />
      </p>
      <label className="fld">
        <span>Institutional email domains, separated by commas</span>
        <input value={d.domains} placeholder="e.g. unicamp.br" onChange={(e) => set({ domains: e.target.value })} />
        <span className="mut small">
          Only these emails can ask for access (subdomains too: unicamp.br accepts dac.unicamp.br). Empty: any email.
        </span>
      </label>
      <label className="fld">
        <span>Departments, one per line</span>
        <textarea
          rows={4}
          value={d.departments}
          placeholder={'Applied Physics\nPhysical Chemistry'}
          onChange={(e) => set({ departments: e.target.value })}
        />
        <span className="mut small">People choose theirs when they ask for access.</span>
      </label>
    </>
  );
}

/** The sign-in screen's picture and the lab's logo, with a preview. */
export function LookFields({
  d,
  set,
  saved,
}: {
  d: LabDraft;
  set: (p: Partial<LabDraft>) => void;
  /** the images already saved (Admin settings), shown until replaced */
  saved?: { bg: string; logo: string; inst: string };
}) {
  const [err, setErr] = useState('');
  const bg = d.background ?? saved?.bg ?? '',
    logo = d.logo ?? saved?.logo ?? '',
    inst = d.instLogo ?? saved?.inst ?? '';
  const pick = (k: 'background' | 'logo' | 'instLogo', f?: File) =>
    f &&
    readImage(f, k === 'background' ? 2400 : 0)
      .then((v) => {
        if (k !== 'background' && v.length > 1_400_000)
          throw new Error('The logo is larger than 1 MB; export a smaller one.');
        if (k !== 'background' && !/^data:image\/(png|jpeg|svg\+xml)/.test(v))
          throw new Error('Use a PNG, JPEG or SVG logo.');
        setErr('');
        set({ [k]: v });
      })
      .catch((e) => setErr(e.message));
  const demo: LabPublic = {
    name: d.name.trim(),
    institution: d.institution.trim(),
    departments: [],
    domains: [],
    hasLogo: !!logo,
    hasBackground: !!bg,
    bgV: 0,
    logoPos: d.logoPos,
    logoPlate: d.logoPlate,
    hasInstLogo: !!inst,
    foot: d.foot,
    setup: null,
    professors: [],
  };
  return (
    <>
      <div className="look-preview" aria-label="Preview of the sign-in screen">
        <SignInFrame lab={demo} preview={{ bg, logo, inst }}>
          <h1>Sign in</h1>
          <div className="mini-field" />
          <div className="mini-field" />
          <div className="mini-btn" />
        </SignInFrame>
      </div>
      <div className="look-picks">
        <div className="fld">
          <span>Picture</span>
          <div className="inline">
            <label className="btn secondary">
              {bg ? 'Replace picture…' : 'Choose a picture…'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={(e) => pick('background', e.target.files?.[0])}
              />
            </label>
            {bg && (
              <button type="button" className="link" onClick={() => set({ background: '' })}>
                Use the drawing instead
              </button>
            )}
          </div>
          <span className="mut small">A photo of the lab or its work, landscape. Large pictures are made smaller.</span>
        </div>
        <div className="fld">
          <span>Lab logo</span>
          <div className="inline">
            <label className="btn secondary">
              {logo ? 'Replace logo…' : 'Choose a logo…'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                hidden
                onChange={(e) => pick('logo', e.target.files?.[0])}
              />
            </label>
            {logo && (
              <button type="button" className="link" onClick={() => set({ logo: '' })}>
                Remove
              </button>
            )}
          </div>
          <span className="mut small">PNG, JPEG or SVG, up to 1 MB. Also offered on exported figures.</span>
        </div>
        {logo && (
          <div className="fld">
            <span>Where the logo sits</span>
            <div className="pos-row">
              <div className="pos-pick" role="radiogroup" aria-label="Where the logo sits on the picture">
                {POS.map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={d.logoPos === k}
                    aria-label={label}
                    title={label}
                    className={d.logoPos === k ? 'on' : ''}
                    onClick={() => set({ logoPos: k })}
                  >
                    <i />
                  </button>
                ))}
              </div>
              <label className="inline small">
                <input type="checkbox" checked={d.logoPlate} onChange={(e) => set({ logoPlate: e.target.checked })} />
                White background behind the logo
              </label>
            </div>
          </div>
        )}
        <div className="fld">
          <span>Institution logo</span>
          <div className="inline">
            <label className="btn secondary">
              {inst ? 'Replace logo…' : 'Choose a logo…'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                hidden
                onChange={(e) => pick('instLogo', e.target.files?.[0])}
              />
            </label>
            {inst && (
              <button type="button" className="link" onClick={() => set({ instLogo: '' })}>
                Remove
              </button>
            )}
          </div>
        </div>
        <label className="fld">
          <span>At the bottom of the sign-in panel</span>
          <select value={d.foot} onChange={(e) => set({ foot: e.target.value as LabDraft['foot'] })}>
            <option value="name">The institution's name</option>
            <option value="logo" disabled={!inst}>
              The institution's logo
            </option>
            <option value="both" disabled={!inst}>
              The logo and the name
            </option>
          </select>
        </label>
        {err && <p className="err small">{err}</p>}
      </div>
    </>
  );
}

/** Logo positions on the picture: the corners, the middle of each edge, the centre. */
const POS: [string, string][] = [
  ['tl', 'Top left'],
  ['tc', 'Top, centred'],
  ['tr', 'Top right'],
  ['ml', 'Left edge, centred'],
  ['mc', 'Centre'],
  ['mr', 'Right edge, centred'],
  ['bl', 'Bottom left'],
  ['bc', 'Bottom, centred'],
  ['br', 'Bottom right'],
];

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
/** Working days and hours: the calendar shades the rest, and bookings there are flagged to the admins. */
export function HoursFields({ hours, set }: { hours: WorkDay[]; set: (h: WorkDay[]) => void }) {
  const put = (i: number, p: Partial<WorkDay>) => set(hours.map((h, j) => (j === i ? { ...h, ...p } : h)));
  return (
    <div className="hours" role="table" aria-label="Working days and hours">
      {hours.map((h, i) => (
        <div className={'hours-row' + (h.on ? '' : ' off')} role="row" key={i}>
          <label className="inline" role="cell">
            <input type="checkbox" checked={h.on} onChange={(e) => put(i, { on: e.target.checked })} />
            {DAYS[i]}
          </label>
          {h.on ? (
            <span className="inline" role="cell">
              <input
                type="time"
                aria-label={`${DAYS[i]} from`}
                value={h.from}
                onChange={(e) => put(i, { from: e.target.value })}
              />
              <span className="mut">to</span>
              <input
                type="time"
                aria-label={`${DAYS[i]} to`}
                value={h.to}
                onChange={(e) => put(i, { to: e.target.value })}
              />
              {h.from >= h.to && <span className="err small">ends before it starts</span>}
            </span>
          ) : (
            <span className="mut small" role="cell">
              Not a working day
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
export const hoursOk = (h: WorkDay[]) => h.every((d) => !d.on || d.from < d.to);

const STEPS = ['Welcome', 'Your account', 'The lab', 'Sign-in screen', 'Working hours', 'Finish'];

/** The first setup, on the computer that runs PANOPTICA: the first admin, the lab, the sign-in screen, the working hours. */
export default function Setup({ onDone }: { onDone: (m: Me) => void }) {
  const [step, setStep] = useState(0),
    [n, setN] = useState<NameParts>({ firstNames: '', surnames: '', surname: '' }),
    [email, setEmail] = useState(''),
    [birth, setBirth] = useState(''),
    [dept, setDept] = useState(''),
    [photo, setPhoto] = useState(''),
    [pw, setPw] = useState(''),
    [again, setAgain] = useState(''),
    [lab, setLab] = useState<LabDraft>(blankLab),
    [err, setErr] = useState(''),
    [busy, setBusy] = useState(false);
  const setL = (p: Partial<LabDraft>) => setLab((x) => ({ ...x, ...p }));
  const accountOk =
    !!n.firstNames.trim() &&
    surnameChoices(n.surnames).length > 0 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) &&
    !!birth &&
    passwordOk(pw, again);
  const can = [true, accountOk, !!lab.name.trim(), true, hoursOk(lab.hours), true][step];
  const finish = () => {
    setBusy(true);
    setErr('');
    const body = labBody(lab);
    // the admin's department joins the list
    if (dept.trim() && !body.departments.includes(dept.trim())) body.departments.push(dept.trim());
    api<Me>('/setup', 'POST', {
      admin: { ...n, email, birthDate: birth, department: dept, photo, password: pw },
      lab: body,
    })
      .then(onDone)
      .catch((e) => setErr(e.message.replace(/^./, (c: string) => c.toUpperCase()) + '.'))
      .finally(() => setBusy(false));
  };
  return (
    <main className="setup">
      <aside className="setup-rail">
        <Wordmark lab={lab.name.trim() || undefined} />
        <ol className="setup-steps">
          {STEPS.map((s, i) => (
            <li
              key={s}
              className={i === step ? 'on' : i < step ? 'done' : ''}
              aria-current={i === step ? 'step' : undefined}
            >
              <span className="setup-n">{i < step ? '✓' : i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      </aside>
      <section className="setup-main">
        <div className="setup-page">
          {step === 0 && (
            <>
              <h1>Set up PANOPTICA</h1>
              <p className="setup-lead">
                PANOPTICA keeps the lab's recipes, batches, bookings and measurements in one place, on this computer.
                These steps create your admin account and set up the lab: its name, the sign-in screen and the working
                hours.
              </p>
              <p className="mut">
                Everything here can be changed later under Admin settings › Lab setup. People ask for access from the
                sign-in screen; you accept them in PANOPTICA.
              </p>
            </>
          )}
          {step === 1 && (
            <>
              <h1>Your account</h1>
              <p className="mut">You will be the lab's first admin.</p>
              <NameFields v={n} set={setN} />
              <div className="grid2">
                <label className="fld">
                  <span>Institutional email</span>
                  <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </label>
                <label className="fld">
                  <span>Birth date</span>
                  <input type="date" max={todayIso()} value={birth} onChange={(e) => setBirth(e.target.value)} />
                </label>
              </div>
              <label className="fld">
                <span>Department</span>
                <input value={dept} onChange={(e) => setDept(e.target.value)} />
              </label>
              <PhotoField value={photo} set={setPhoto} label="Photo (optional)" />
              <div className="grid2">
                <label className="fld">
                  <span>Password</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                  />
                </label>
                <label className="fld">
                  <span>Password again</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={again}
                    onChange={(e) => setAgain(e.target.value)}
                  />
                </label>
              </div>
              <PasswordRules pw={pw} again={again} />
            </>
          )}
          {step === 2 && (
            <>
              <h1>The lab</h1>
              <LabFields d={lab} set={setL} />
            </>
          )}
          {step === 3 && (
            <>
              <h1>Sign-in screen</h1>
              <p className="mut">The lab's picture fills the left side; its logo sits in the corner.</p>
              <LookFields d={lab} set={setL} />
            </>
          )}
          {step === 4 && (
            <>
              <h1>Working hours</h1>
              <p className="mut">
                The calendar stripes the hours outside these. Bookings there are allowed, and the admins are told.
              </p>
              <HoursFields hours={lab.hours} set={(hours) => setL({ hours })} />
            </>
          )}
          {step === 5 && (
            <>
              <h1>Ready</h1>
              <dl className="setup-sum">
                <dt>Admin</dt>
                <dd>
                  {n.firstNames} {n.surnames} · {email}
                </dd>
                <dt>Lab</dt>
                <dd>
                  <Wordmark lab={lab.name.trim()} size="s" />
                  {lab.institution.trim() && <span className="mut"> at {lab.institution.trim()}</span>}
                </dd>
                <dt>Access</dt>
                <dd>
                  {labBody(lab)
                    .domains.map((x) => '@' + x)
                    .join(', ') || 'Any email'}
                </dd>
                <dt>Working days</dt>
                <dd>
                  {lab.hours
                    .map((h, i) => (h.on ? `${DAYS[i].slice(0, 3)} ${h.from}–${h.to}` : ''))
                    .filter(Boolean)
                    .join(', ') || 'None'}
                </dd>
              </dl>
              {err && <p className="err">{err}</p>}
            </>
          )}
        </div>
        <footer className="setup-foot">
          {step > 0 && (
            <button type="button" className="link" onClick={() => setStep(step - 1)} disabled={busy}>
              Back
            </button>
          )}
          <div className="grow" />
          {step < STEPS.length - 1 ? (
            <button type="button" className="btn" disabled={!can} onClick={() => setStep(step + 1)}>
              Continue
            </button>
          ) : (
            <button type="button" className="btn" disabled={busy} onClick={finish}>
              {busy ? 'Setting up…' : 'Open PANOPTICA'}
            </button>
          )}
        </footer>
      </section>
    </main>
  );
}

/** Shown on other computers while the setup is not done. */
export function SetupElsewhere({ lab }: { lab: LabPublic }) {
  return (
    <SignInFrame lab={lab}>
      <h1>Not set up yet</h1>
      <p>
        PANOPTICA is set up on the computer that runs it. Open PANOPTICA there (it starts with the address
        <code> http://localhost</code>) and follow the steps; then sign in here.
      </p>
    </SignInFrame>
  );
}
