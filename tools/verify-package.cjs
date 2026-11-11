// Checks that an update package was signed by PANOPTICA, for the update scripts.
//   node tools/verify-package.cjs <panoptica.zip> [signature file]     (default: <zip>.sig next to it)
// Exit code 0 when the signature is PANOPTICA's; 1 with a message otherwise.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const [zip, sigArg] = process.argv.slice(2);
const fail = (m) => {
  console.error(m);
  process.exit(1);
};
if (!zip || !fs.existsSync(zip)) fail('No update file to check.');
const sigFile = sigArg || zip + '.sig';
if (!fs.existsSync(sigFile))
  fail(
    `This update has no signature (${path.basename(sigFile)} must be next to it). Only packages signed by PANOPTICA are installed.`,
  );
// tests sign with their own key (both variables are set by the test)
const pem =
  process.env.PANOPTICA_TEST === '1' && process.env.UPDATE_PUBLIC_KEY
    ? process.env.UPDATE_PUBLIC_KEY
    : fs.readFileSync(path.join(__dirname, '..', 'release.pub'), 'utf8');
let ok = false;
try {
  const sig = Buffer.from(fs.readFileSync(sigFile, 'utf8').trim(), 'base64');
  ok = sig.length === 64 && crypto.verify(null, fs.readFileSync(zip), crypto.createPublicKey(pem), sig);
} catch {
  ok = false;
}
if (!ok) fail('The signature of this update is not PANOPTICA’s. Nothing was installed.');
console.log('Signature checked: this update was made by PANOPTICA.');
