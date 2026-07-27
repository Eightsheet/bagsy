import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { nanoid } from "nanoid";

export function newId(prefix?: string): string {
  return prefix ? `${prefix}_${nanoid(16)}` : nanoid(21);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateApiToken(): { token: string; prefix: string; hash: string } {
  const raw = `wb_${randomBytes(24).toString("base64url")}`;
  return {
    token: raw,
    prefix: raw.slice(0, 10),
    hash: hashToken(raw),
  };
}

export function generateDeviceCodes(): { deviceCode: string; userCode: string } {
  const deviceCode = randomBytes(32).toString("base64url");
  const userCode = randomBytes(3).toString("hex").toUpperCase().slice(0, 6);
  // Format as ABC-DEF
  const formatted = `${userCode.slice(0, 3)}-${userCode.slice(3)}`;
  return { deviceCode, userCode: formatted };
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}
