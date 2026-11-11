// Signs a release package with PANOPTICA's private key (Ed25519, PEM) from the SIGNING_KEY environment variable, writes
// <file>.sig (base64) and checks it against release.pub, so a release is never published with a signature the app would refuse.
//   SIGNING_KEY="$(cat key.pem)" node tools/sign-package.mjs panoptica.zip
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = process.argv[2],
  pem = process.env.SIGNING_KEY;
if (!file) throw new Error('usage: node tools/sign-package.mjs <file>');
if (!pem) throw new Error('SIGNING_KEY is not set (repository secret with the private key)');
const data = readFileSync(file),
  sig = sign(null, data, createPrivateKey(pem.replace(/\r/g, '').trim() + '\n'));
const pub =
  process.env.UPDATE_PUBLIC_KEY || readFileSync(fileURLToPath(new URL('../release.pub', import.meta.url)), 'utf8');
if (!verify(null, data, createPublicKey(pub), sig))
  throw new Error('SIGNING_KEY does not match release.pub: the app would refuse this release');
writeFileSync(file + '.sig', sig.toString('base64') + '\n');
console.log(`signed ${file}`);
