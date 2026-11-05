import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const hash = (pw: string) => {
  const s = randomBytes(16);
  return s.toString('hex') + ':' + scryptSync(pw, s, 64).toString('hex');
};
export const verify = (pw: string, stored: string) => {
  const [s, k] = stored.split(':');
  return timingSafeEqual(scryptSync(pw, Buffer.from(s, 'hex'), 64), Buffer.from(k, 'hex'));
};
