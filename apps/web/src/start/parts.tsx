import { useEffect, useMemo, useRef, useState } from 'react';
import { passwordRules, surnameChoices, usernameFor } from '@psc/core';
import Cropper from '../lib/Cropper';

/** PANOPTICA · lab name: the app's name tracked out, the lab's as the lab writes it, a centred dot between them. */
export function Wordmark({ lab, size = 'm' }: { lab?: string; size?: 's' | 'm' | 'l' }) {
  return (
    <span className={'wordmark wm-' + size}>
      <span className="wm-app">PANOPTICA</span>
      {lab && (
        <>
          <span className="wm-dot" aria-hidden>
            ·
          </span>
          <span className="wm-lab">{lab}</span>
        </>
      )}
    </span>
  );
}

/**
 * The plan of a panopticon: a ring of cells around a central tower, seen from above. Shown on the sign-in screen until the lab
 * adds its own picture.
 */
export function Panopticon() {
  const cells = 28,
    r0 = 210,
    r1 = 330;
  const walls = Array.from({ length: cells }, (_, i) => {
    const a = (i / cells) * Math.PI * 2;
    return `M${500 + r0 * Math.cos(a)},${500 + r0 * Math.sin(a)}L${500 + r1 * Math.cos(a)},${500 + r1 * Math.sin(a)}`;
  }).join('');
  const sight = Array.from({ length: cells }, (_, i) => {
    const a = ((i + 0.5) / cells) * Math.PI * 2;
    return `M${500 + 64 * Math.cos(a)},${500 + 64 * Math.sin(a)}L${500 + (r1 - 8) * Math.cos(a)},${500 + (r1 - 8) * Math.sin(a)}`;
  }).join('');
  return (
    <svg className="panopticon" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <g fill="none" stroke="currentColor">
        <circle cx="500" cy="500" r={r1 + 40} strokeWidth="1" opacity=".35" />
        <circle cx="500" cy="500" r={r1} strokeWidth="2" />
        <circle cx="500" cy="500" r={r0} strokeWidth="2" />
        <path d={walls} strokeWidth="2" />
        <path d={sight} strokeWidth="1" opacity=".28" strokeDasharray="3 7" />
        <circle cx="500" cy="500" r="64" strokeWidth="2" />
        <circle cx="500" cy="500" r="30" strokeWidth="1.4" opacity=".6" />
      </g>
    </svg>
  );
}

/** The password rules, ticked as they are met. */
export function PasswordRules({ pw, again }: { pw: string; again?: string }) {
  const rules = passwordRules(pw);
  return (
    <ul className="pw-rules" aria-live="polite">
      {rules.map((r) => (
        <li key={r.rule} className={r.ok ? 'ok' : ''}>
          <span aria-hidden>{r.ok ? '✓' : '○'}</span> {r.rule}
        </li>
      ))}
      {again !== undefined && (
        <li className={again && again === pw ? 'ok' : ''}>
          <span aria-hidden>{again && again === pw ? '✓' : '○'}</span> Typed the same twice
        </li>
      )}
    </ul>
  );
}
export const passwordOk = (pw: string, again: string) => passwordRules(pw).every((r) => r.ok) && pw === again;

export type NameParts = { firstNames: string; surnames: string; surname: string };
/**
 * First names, surnames, and which surname goes in the username. The username shows as it will be (the server adds letters of
 * the surname if it is taken; `check` asks it).
 */
export function NameFields({
  v,
  set,
  check,
  self = true,
}: {
  v: NameParts;
  set: (v: NameParts) => void;
  check?: (first: string, surname: string) => Promise<string | null>;
  /** the person fills it in themselves ("your username"), or an admin for them ("the username") */
  self?: boolean;
}) {
  const choices = useMemo(() => surnameChoices(v.surnames), [v.surnames]);
  // the last surname by default (Brazilian names: the family name comes last)
  useEffect(() => {
    if (choices.length && !choices.includes(v.surname)) set({ ...v, surname: choices[choices.length - 1] });
    if (!choices.length && v.surname) set({ ...v, surname: '' });
  }, [choices.join(' ')]);
  const [name, setName] = useState<string | null>(null),
    t = useRef(0);
  const local = usernameFor(v.firstNames, v.surname);
  useEffect(() => {
    setName(null);
    if (!check || !local) return;
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => check(v.firstNames, v.surname).then(setName), 350);
  }, [v.firstNames, v.surname]);
  const shown = name ?? local;
  return (
    <>
      <div className="grid2">
        <label className="fld">
          <span>First name(s)</span>
          <input
            value={v.firstNames}
            autoComplete="given-name"
            onChange={(e) => set({ ...v, firstNames: e.target.value })}
          />
        </label>
        <label className="fld">
          <span>Surname(s)</span>
          <input
            value={v.surnames}
            autoComplete="family-name"
            onChange={(e) => set({ ...v, surnames: e.target.value })}
          />
        </label>
      </div>
      {choices.length > 1 && (
        <label className="fld">
          <span>Surname for {self ? 'your' : 'the'} username</span>
          <select value={v.surname} onChange={(e) => set({ ...v, surname: e.target.value })}>
            {choices.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      )}
      <p className="username-preview">
        {shown ? (
          <>
            {self ? 'Your username' : 'Username'}: <b>@{shown}</b>
            <span className="mut small"> (every first name and the first letter of the surname)</span>
          </>
        ) : (
          <span className="mut small">
            {self
              ? 'Your username is made from your first name(s) and a surname.'
              : 'The username is made from the first name(s) and a surname.'}
          </span>
        )}
      </p>
    </>
  );
}

/**
 * The photo as a circle, as on the profile page: click it to add or change the photo (then crop it), Remove under it. Without a
 * photo it shows the initials of `name`, or a camera before a name is typed. `shown` is a photo already on file (a URL), used
 * until a new one is chosen.
 */
export function PhotoCircle({
  value,
  set,
  name = '',
  shown = '',
  required = false,
  note,
}: {
  value: string;
  set: (v: string) => void;
  name?: string;
  shown?: string;
  required?: boolean;
  note?: string;
}) {
  const [crop, setCrop] = useState<string | null>(null),
    [err, setErr] = useState(''),
    [kept, setKept] = useState(!!shown),
    file = useRef<HTMLInputElement>(null);
  const pick = (f?: File) => {
    if (!f) return;
    if (!/^image\//.test(f.type)) return setErr('Choose an image file (JPEG, PNG…).');
    setErr('');
    const r = new FileReader();
    r.onload = () => setCrop(r.result as string);
    r.readAsDataURL(f);
  };
  const src = value || (kept ? shown : '');
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const hue = [...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <div className="photo-circle">
      {crop ? (
        <Cropper
          src={crop}
          onCancel={() => setCrop(null)}
          onSave={(d) => {
            setCrop(null);
            set(d);
          }}
        />
      ) : (
        <>
          <button
            type="button"
            className="photo-frame"
            aria-label={src ? 'Change photo' : 'Add a photo'}
            title={src ? 'Change photo' : 'Add a photo'}
            onClick={() => file.current?.click()}
          >
            {src ? (
              <img src={src} alt="" className="av" onError={() => setKept(false)} />
            ) : initials ? (
              <span className="av" style={{ background: `hsl(${hue} 45% 45%)` }}>
                {initials}
              </span>
            ) : (
              <span className="av av-empty" />
            )}
            <span className="photo-hover" aria-hidden>
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
                <circle cx="12" cy="13" r="3.5" />
              </svg>
            </span>
          </button>
          <span className="mut small">
            {src ? 'Click the photo to change it' : required ? 'Add your photo (required)' : 'Add a photo (optional)'}
          </span>
          {note && <span className="mut small">{note}</span>}
          {src && (
            <button
              type="button"
              className="link danger-link"
              onClick={() => {
                set('');
                setKept(false);
              }}
            >
              Remove photo
            </button>
          )}
        </>
      )}
      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {err && <span className="err small">{err}</span>}
    </div>
  );
}

/** An image file as a data URL, made smaller if it is large (the login background: at most 2400 px wide, JPEG). */
export function readImage(f: File, maxW = 2400): Promise<string> {
  return new Promise((res, rej) => {
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(f.type)) return rej(new Error('Use a JPEG, PNG, WebP or SVG image.'));
    const r = new FileReader();
    r.onerror = () => rej(new Error('The file could not be read.'));
    r.onload = () => {
      const src = String(r.result);
      if (f.type === 'image/svg+xml' || maxW <= 0) return res(src);
      const i = new Image();
      i.onload = () => {
        if (i.width <= maxW && f.size < 1_500_000) return res(src);
        const k = Math.min(1, maxW / i.width),
          c = document.createElement('canvas');
        c.width = Math.round(i.width * k);
        c.height = Math.round(i.height * k);
        c.getContext('2d')!.drawImage(i, 0, 0, c.width, c.height);
        res(c.toDataURL(f.type === 'image/png' && f.size < 3_000_000 ? 'image/png' : 'image/jpeg', 0.86));
      };
      i.onerror = () => rej(new Error('The image could not be opened.'));
      i.src = src;
    };
    r.readAsDataURL(f);
  });
}

/** Today as yyyy-mm-dd, in local time. */
export const todayIso = () => {
  const d = new Date(),
    z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
};
