// Generate a compatible password hash for USER_ACCOUNT.password_hash.
// Run from web/: node scripts/hash-password.mjs "<password>"
import { randomBytes, scryptSync } from "node:crypto";

const password = process.argv[2];
if (!password || password.length < 8) {
  console.error('Usage: node scripts/hash-password.mjs "<password of at least 8 characters>"');
  process.exit(1);
}

const N = 16384;
const r = 8;
const p = 1;
const salt = randomBytes(16);
const key = scryptSync(password, salt, 64, { N, r, p, maxmem: 64 * 1024 * 1024 });
console.log(`scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`);
