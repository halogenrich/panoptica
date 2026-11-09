import { describe, expect, it } from 'vitest';
import {
  ageOn,
  charCount,
  passwordProblem,
  passwordRules,
  plainLetters,
  surnameChoices,
  usernameFor,
  withinHours,
  DEFAULT_HOURS,
} from './accounts';

describe('usernames', () => {
  it('drops accents and cedillas and keeps every first name', () => {
    expect(plainLetters('João Ç Æsir')).toBe('joaocaesir');
    expect(usernameFor('João', 'Silva')).toBe('joaos');
    expect(usernameFor('Ana Clara', 'Muñoz')).toBe('anaclaram');
    expect(usernameFor("Maria D'Ávila", 'Çelik')).toBe('mariadavilac');
  });
  it('takes the next letter of the surname when taken, never numbers', () => {
    const taken = new Set(['joaos', 'joaosi']);
    expect(usernameFor('João', 'Silva', (u) => taken.has(u))).toBe('joaosil');
    expect(usernameFor('Jo', 'Li', (u) => ['jol', 'joli'].includes(u))).toBeNull();
  });
  it('offers surnames without particles', () => {
    expect(surnameChoices('da Silva dos Santos')).toEqual(['Silva', 'Santos']);
  });
});

describe('passwords', () => {
  it('asks for length, upper case, number and special character', () => {
    expect(passwordProblem('Abcdef1!')).toBe('');
    expect(passwordProblem('abcdef1!')).toMatch(/upper case/);
    expect(passwordProblem('Abcdefg!')).toMatch(/number/);
    expect(passwordProblem('Abcdefg1')).toMatch(/special/);
    expect(passwordProblem('Ab1!')).toMatch(/8 characters/);
  });
  it('counts accented letters as letters, in any form they were typed', () => {
    expect(passwordProblem('Ãçãoéê1!')).toBe('');
    expect(passwordProblem('ÇÆ1ãããã!')).toBe('');
    expect(passwordRules('ãããããã1A').find((r) => /special/.test(r.rule))?.ok).toBe(false); // ã is a letter, not special
    const decomposed = 'ã'; // a + combining tilde
    expect(charCount(decomposed)).toBe(1);
    expect(charCount('Ação')).toBe(4);
  });
});

describe('people and hours', () => {
  it('ages in whole years', () => {
    expect(ageOn('2000-11-10', new Date(2026, 10, 9))).toBe(25);
    expect(ageOn('2000-11-09', new Date(2026, 10, 9))).toBe(26);
  });
  it('knows working hours', () => {
    const mon = (h: number, m = 0) => new Date(2026, 10, 9, h, m);
    expect(withinHours(DEFAULT_HOURS, mon(9), mon(11))).toBe(true);
    expect(withinHours(DEFAULT_HOURS, mon(17), mon(19))).toBe(false);
    expect(withinHours(DEFAULT_HOURS, mon(7, 30), mon(9))).toBe(false);
    expect(withinHours(DEFAULT_HOURS, new Date(2026, 10, 14, 9), new Date(2026, 10, 14, 10))).toBe(false); // Saturday
    const sat = DEFAULT_HOURS.map((d, i) => (i === 5 ? { on: true, from: '09:00', to: '13:00' } : d));
    expect(withinHours(sat, new Date(2026, 10, 14, 9), new Date(2026, 10, 14, 10))).toBe(true);
  });
});
