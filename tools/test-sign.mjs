// For tests only: signs a package with a new throwaway key and writes <file>.sig and <file>.pub (the public half, which
// tools/update-e2e.mjs hands to the app under test). Real releases are signed by tools/sign-package.mjs with PANOPTICA's key.
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
const k = generateKeyPairSync('ed25519');
writeFileSync(file + '.sig', sign(null, readFileSync(file), k.privateKey).toString('base64') + '\n');
writeFileSync(file + '.pub', k.publicKey.export({ type: 'spki', format: 'pem' }));
console.log(`test-signed ${file}`);
