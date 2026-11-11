import { createPublicKey, verify } from 'node:crypto';

/**
 * Releases are signed by PANOPTICA (Ed25519). The private key never leaves PANOPTICA; this is its public half, built into the
 * app, so a lab server installs only packages PANOPTICA made. The same key is in release.pub for the update scripts
 * (tools/verify-package.cjs); a test checks that the two match.
 */
export const RELEASE_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA/3FUKN/uSxSwmYlsiLhAjBgR7MIxWad60vyu3602muk=
-----END PUBLIC KEY-----
`;
/** Tests sign their fake releases with a key of their own (PANOPTICA_TEST=1 and UPDATE_PUBLIC_KEY, both set by the test). */
const pem = () =>
  process.env.PANOPTICA_TEST === '1' && process.env.UPDATE_PUBLIC_KEY ? process.env.UPDATE_PUBLIC_KEY : RELEASE_KEY;

/** True when `signature` (base64) is PANOPTICA's signature of `data`. */
export function signedByPanoptica(data: Buffer, signature: string): boolean {
  try {
    const sig = Buffer.from(signature.trim(), 'base64');
    return sig.length === 64 && verify(null, data, createPublicKey(pem()), sig);
  } catch {
    return false;
  }
}
