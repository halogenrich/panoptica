/**
 * Accounts: usernames made from a person's names, and the password rules. Shared by the server (which decides) and the browser
 * (which shows the username and the rules while typing).
 */

/** Letters that do not fall apart into a base letter and an accent. */
const LIGATURES: Record<string, string> = {
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  ß: 'ss',
  ð: 'd',
  þ: 'th',
  ł: 'l',
  đ: 'd',
  ı: 'i',
};

/** Lower case a–z only: accents and cedillas removed (João → joao, Ç → c, Æ → ae), everything else dropped. */
export function plainLetters(s: string): string {
  return s
    .toLowerCase()
    .replace(/[æœøßðþłđı]/g, (c) => LIGATURES[c])
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z]/g, '');
}

/** Words that join surnames ("da Silva", "van der Berg"): never chosen as the surname of a username. */
const PARTICLES = new Set([
  'de',
  'da',
  'do',
  'das',
  'dos',
  'di',
  'du',
  'del',
  'della',
  'van',
  'von',
  'der',
  'den',
  'la',
  'le',
  'e',
  'y',
]);

/** The surnames a person can choose from (in the order written), particles left out. */
export function surnameChoices(surnames: string): string[] {
  return surnames
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w && plainLetters(w) && !PARTICLES.has(plainLetters(w)));
}

/**
 * The username for first names and a chosen surname: every first name (Ana Clara → anaclara) and the first letter of the surname,
 * lower case without accents. When it is taken, the next letter of the surname is added (anaclaras, anaclarasi…); never numbers.
 * Null when every length is taken (or there is nothing to build it from).
 */
export function usernameFor(
  firstNames: string,
  surname: string,
  taken: (u: string) => boolean = () => false,
): string | null {
  const base = plainLetters(firstNames),
    s = plainLetters(surname);
  if (!base || !s) return null;
  for (let k = 1; k <= s.length; k++) {
    const u = base + s.slice(0, k);
    if (!taken(u)) return u;
  }
  return null;
}

/** Characters as people see them: "ã" is one, however it was typed. */
export function charCount(s: string): number {
  const t = s.normalize('NFC');
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    let n = 0;
    for (const _ of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(t)) n++;
    return n;
  }
  return [...t].length;
}

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

/**
 * The password rules, each with whether it is met. Letters of any alphabet count (Ã, Ç and Æ are upper case letters; ã is a lower
 * case one, not a special character); special characters are punctuation and symbols (! @ # $ % & * ? - _ . , ; ~ ^ € £ …).
 * Spaces are allowed but do not count as special.
 */
export function passwordRules(pw: string): { rule: string; ok: boolean }[] {
  const p = pw.normalize('NFC'),
    n = charCount(p);
  return [
    { rule: `At least ${PASSWORD_MIN} characters`, ok: n >= PASSWORD_MIN && n <= PASSWORD_MAX },
    { rule: 'An upper case letter', ok: /[\p{Lu}\p{Lt}]/u.test(p) },
    { rule: 'A number', ok: /\p{Nd}/u.test(p) },
    { rule: 'A special character (! @ # % & * ? …)', ok: /[\p{P}\p{S}]/u.test(p) },
  ];
}

/** The first rule a password misses, as a sentence, or '' when it meets them all. */
export function passwordProblem(pw: string): string {
  if (charCount(pw) > PASSWORD_MAX) return `the password is too long (at most ${PASSWORD_MAX} characters)`;
  const miss = passwordRules(pw).find((r) => !r.ok);
  return miss ? `the password needs: ${miss.rule.toLowerCase()}` : '';
}

/** Age in whole years on a date (birth date as yyyy-mm-dd). */
export function ageOn(birth: string, on: Date = new Date()): number | null {
  const m = birth.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  let a = on.getFullYear() - +m[1];
  if (on.getMonth() + 1 < +m[2] || (on.getMonth() + 1 === +m[2] && on.getDate() < +m[3])) a--;
  return a;
}

/** Working days and hours: Monday first. A day that is off has `on: false`. */
export type WorkDay = { on: boolean; from: string; to: string };
export const DEFAULT_HOURS: WorkDay[] = [0, 1, 2, 3, 4, 5, 6].map((i) => ({ on: i < 5, from: '08:00', to: '18:00' }));
/** Minutes after midnight of "HH:MM". */
export const minutesOf = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + (m || 0);
};
/** The working hours of a date (Monday-first index from the JavaScript Sunday-first day). */
export const workDayOf = (hours: WorkDay[], d: Date): WorkDay => hours[(d.getDay() + 6) % 7] ?? DEFAULT_HOURS[0];
/** Whether a time span lies inside working hours (same day, a working day, between its hours). */
export function withinHours(hours: WorkDay[], start: Date, end: Date): boolean {
  const w = workDayOf(hours, start);
  if (!w.on) return false;
  const s = start.getHours() * 60 + start.getMinutes(),
    sameDay = start.toDateString() === new Date(end.getTime() - 1).toDateString(),
    e = sameDay ? end.getHours() * 60 + end.getMinutes() || 24 * 60 : 24 * 60 + 1;
  return s >= minutesOf(w.from) && e <= minutesOf(w.to);
}
