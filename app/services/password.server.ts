import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";

const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEYLEN).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const hashBuffer = Buffer.from(hash, "hex");
  const test = scryptSync(password, salt, KEYLEN);
  if (hashBuffer.length !== test.length) return false;
  return timingSafeEqual(hashBuffer, test);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
