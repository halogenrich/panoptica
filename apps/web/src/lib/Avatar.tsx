/** A user's photo, or their initials on a colour picked from the name. */
export default function Avatar({ id, name, photoV, size = 32, className = '' }: { id: number; name: string; photoV?: number | null; size?: number; className?: string }) {
  const initials = name.replace(/\(former\)/, '').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const hue = [...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  return photoV
    ? <img className={'av ' + className} src={`/api/users/${id}/photo?v=${photoV}`} alt="" width={size} height={size} style={{ width: size, height: size }} />
    : <span className={'av ' + className} aria-hidden style={{ width: size, height: size, fontSize: size * 0.4, background: `hsl(${hue} 45% 45%)` }}>{initials}</span>;
}
