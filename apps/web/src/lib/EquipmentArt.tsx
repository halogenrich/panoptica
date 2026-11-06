/**
 * Line drawings of the lab's equipment, front view, for the calendar, the booking form and the Overview. The outline takes the text
 * colour; one working part (the pan, the chuck, the boat, the lamp) takes the equipment's calendar colour, so a drawing and its
 * bookings read together. Each piece of equipment has a drawing chosen by an admin (Equipment), guessed from its use and name.
 */
export type ArtKind =
  | 'balance'
  | 'spincoater'
  | 'organic'
  | 'metal'
  | 'uvozone'
  | 'hotplate'
  | 'glovebox'
  | 'solarsim'
  | 'profilometer'
  | 'ultrasonic'
  | 'generic';

export const ARTS: [ArtKind, string][] = [
  ['balance', 'Balance'],
  ['spincoater', 'Spin coater'],
  ['organic', 'Small evaporator'],
  ['metal', 'Thermal evaporator'],
  ['uvozone', 'UV-ozone cleaner'],
  ['hotplate', 'Hotplate'],
  ['glovebox', 'Glovebox'],
  ['solarsim', 'Solar simulator'],
  ['profilometer', 'Profilometer'],
  ['ultrasonic', 'Ultrasonic bath'],
  ['generic', 'Other instrument'],
];

/** The drawing to use: the one chosen, else a guess from what it is used for and its name. */
export function artOf(e: { art?: string | null; role?: string; name: string }): ArtKind {
  if (e.art && ARTS.some(([k]) => k === e.art)) return e.art as ArtKind;
  const n = e.name.toLowerCase();
  if (e.role === 'scale' || /scale|balan/.test(n)) return 'balance';
  if (e.role === 'spinner' || /spin/.test(n)) return 'spincoater';
  if (e.role === 'metal' || /metal|thermal evap/.test(n)) return 'metal';
  if (e.role === 'organic' || /minivap|organic|evap/.test(n)) return 'organic';
  if (e.role === 'prep' || /uv|ozone|plasma/.test(n)) return 'uvozone';
  if (/hot ?plate|anneal/.test(n)) return 'hotplate';
  if (/glove ?box/.test(n)) return 'glovebox';
  if (/sun|simulat|j-?v|solar/.test(n)) return 'solarsim';
  if (/profil|dektak/.test(n)) return 'profilometer';
  if (/ultra|sonic|bath/.test(n)) return 'ultrasonic';
  return 'generic';
}

const A = 'var(--eq, var(--ac))'; // the working part, in the equipment's colour

function parts(k: ArtKind) {
  switch (k) {
    case 'balance':
      return (
        <>
          <rect x="10" y="38" width="44" height="7" rx="1.5" />
          <rect x="22" y="40" width="9" height="3" rx="0.6" fill={A} stroke="none" />
          <path d="M14 38V12h36v26" />
          <path d="M32 12v26" strokeDasharray="2 2.4" opacity=".5" />
          <path d="M22 33h20" stroke={A} strokeWidth="2.4" />
          <path d="M32 33v5" />
        </>
      );
    case 'spincoater':
      return (
        <>
          <rect x="12" y="34" width="40" height="11" rx="2" />
          <path d="M16 34c0-9 7-14 16-14s16 5 16 14" />
          <path d="M20 26h24" opacity=".5" />
          <path d="M25 31h14" stroke={A} strokeWidth="2.6" />
          <path d="M32 31v3" />
          <circle cx="44" cy="39.5" r="1.6" />
          <path d="M18 39.5h12" opacity=".6" />
          <path d="M40 18c3 1 5 3 6 5" stroke={A} opacity=".8" />
        </>
      );
    case 'organic':
      return (
        <>
          <rect x="12" y="10" width="40" height="30" rx="3" />
          <circle cx="32" cy="24" r="8" />
          <path d="M28 27h8l-1.2 3h-5.6z" fill={A} stroke="none" />
          <path d="M29 22c1-2 2-3 3-5M33 22c1-2 2-3 3-5" stroke={A} opacity=".8" />
          <path d="M16 40v5M48 40v5M12 45h40" />
          <circle cx="46" cy="14" r="1.4" />
        </>
      );
    case 'metal':
      return (
        <>
          <path d="M16 36V22a16 12 0 0 1 32 0v14" />
          <path d="M10 36h44v4H10z" />
          <path d="M14 40v5h36v-5" />
          <path d="M26 31h12" stroke={A} strokeWidth="2.6" />
          <path d="M28 31v-3M36 31v-3" opacity=".6" />
          <path d="M24 16h16" opacity=".5" />
          <path d="M29 27l-2-6M35 27l2-6M32 27v-7" stroke={A} opacity=".7" />
        </>
      );
    case 'uvozone':
      return (
        <>
          <rect x="10" y="14" width="44" height="30" rx="2.5" />
          <path d="M10 30h44" />
          <path d="M16 20h32" stroke={A} strokeWidth="2.6" />
          <path d="M20 23v4M28 23v4M36 23v4M44 23v4" stroke={A} opacity=".6" />
          <path d="M26 37h12" />
          <circle cx="48" cy="37" r="1.5" />
        </>
      );
    case 'hotplate':
      return (
        <>
          <rect x="12" y="32" width="40" height="13" rx="2" />
          <rect x="10" y="28" width="44" height="4" rx="1" fill={A} stroke="none" />
          <circle cx="20" cy="38.5" r="2" />
          <circle cx="28" cy="38.5" r="2" />
          <path d="M38 38.5h8" />
          <path d="M24 23c-2-3 2-5 0-8M32 23c-2-3 2-5 0-8M40 23c-2-3 2-5 0-8" stroke={A} opacity=".75" />
        </>
      );
    case 'glovebox':
      return (
        <>
          <rect x="6" y="10" width="52" height="26" rx="2.5" />
          <path d="M10 14h44v18H10z" opacity=".4" />
          <circle cx="22" cy="27" r="5" stroke={A} strokeWidth="2.2" />
          <circle cx="42" cy="27" r="5" stroke={A} strokeWidth="2.2" />
          <path d="M8 36v9M56 36v9M6 45h52" />
          <rect x="52" y="18" width="8" height="12" rx="1.5" />
        </>
      );
    case 'solarsim':
      return (
        <>
          <rect x="18" y="6" width="28" height="12" rx="2" />
          <path d="M24 18l-4 18M40 18l4 18" stroke={A} opacity=".55" />
          <path d="M28 18v14M32 18v16M36 18v14" stroke={A} opacity=".35" />
          <rect x="14" y="36" width="36" height="5" rx="1" />
          <path d="M10 45h44M50 6v39" />
          <rect x="27" y="34" width="10" height="2" fill={A} stroke="none" />
        </>
      );
    case 'profilometer':
      return (
        <>
          <path d="M10 45h44M14 45V10h8v35" />
          <path d="M22 16h22v6H22z" />
          <path d="M40 22v9" />
          <path d="M40 31l-1.5 3h3z" fill={A} stroke="none" />
          <rect x="26" y="36" width="26" height="4" rx="1" />
          <path d="M29 36h4l2-2h4l2 2h8" stroke={A} />
        </>
      );
    case 'ultrasonic':
      return (
        <>
          <path d="M10 22h44v20a3 3 0 0 1-3 3H13a3 3 0 0 1-3-3z" />
          <path d="M14 30c3-2 6 2 9 0s6 2 9 0 6 2 9 0 6 2 9 0" stroke={A} />
          <path d="M14 36c3-2 6 2 9 0s6 2 9 0 6 2 9 0 6 2 9 0" stroke={A} opacity=".5" />
          <path d="M24 22V12h16v10" opacity=".55" />
          <circle cx="48" cy="18" r="1.5" />
        </>
      );
    default:
      return (
        <>
          <rect x="10" y="14" width="44" height="28" rx="3" />
          <rect x="16" y="20" width="18" height="10" rx="1" fill={A} opacity=".25" stroke={A} />
          <circle cx="44" cy="25" r="4" />
          <path d="M16 36h10M40 36h8" />
          <path d="M14 42v3M50 42v3" />
        </>
      );
  }
}

export default function EquipmentArt({
  kind,
  color,
  size = 48,
  title,
}: {
  kind: ArtKind;
  color?: string;
  size?: number;
  title?: string;
}) {
  return (
    <svg
      className="eq-art"
      width={size}
      height={(size * 48) / 64}
      viewBox="0 0 64 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={color ? ({ '--eq': color } as React.CSSProperties) : undefined}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      {parts(kind)}
    </svg>
  );
}
