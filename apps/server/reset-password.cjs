// Reset a user's password directly in the SQLite database.
// Usage (from the apps/server folder, server stopped):
//   node reset-password.cjs <username> <new password, min 10 characters>
const fs = require('node:fs');
const { randomBytes, scryptSync } = require('node:crypto');
const emit = process.emitWarning.bind(process); // node:sqlite is "experimental" on Node 22; keep the output clean
process.emitWarning = (w, ...a) => (String(w && w.message || w).includes('SQLite') ? undefined : emit(w, ...a));
const { DatabaseSync } = require('node:sqlite');

const [user, pw] = process.argv.slice(2);
const file = process.env.DB_PATH || 'data.db';

if (!user || !pw || pw.length < 10) {
  console.error('Usage: node reset-password.cjs <username> <new password (min 10 characters)>');
  process.exit(1);
}
if (!fs.existsSync(file)) {
  console.error('Database not found: ' + file + ' (run this from the apps/server folder)');
  process.exit(1);
}

const db = new DatabaseSync(file);
db.exec('PRAGMA busy_timeout = 5000');
const salt = randomBytes(16);
const hash = salt.toString('hex') + ':' + scryptSync(pw, salt, 64).toString('hex');
const r = db.prepare('UPDATE users SET hash=?, active=1 WHERE username=?').run(hash, user);
if (!r.changes) {
  console.error('No user named "' + user + '". Existing users: ' + db.prepare('SELECT username FROM users').all().map((u) => u.username).join(', '));
  process.exit(1);
}
db.prepare('DELETE FROM sessions WHERE user_id=(SELECT id FROM users WHERE username=?)').run(user);
console.log('Password reset for ' + user + '. You can log in now.');
