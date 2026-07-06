import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { getServerEnv } from "./env";

const TOKEN_PREFIX = "jat_";
export const TOKEN_HASH_KEY_ID = "v1";

export function createAccountToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function hashAccountToken(rawToken: string): string {
  const { accountTokenHashSecret } = getServerEnv();

  return createHmac("sha256", accountTokenHashSecret).update(rawToken).digest("base64url");
}

export function isValidTokenShape(rawToken: string): boolean {
  return /^jat_[A-Za-z0-9_-]{43}$/.test(rawToken);
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.byteLength !== rightBuffer.byteLength) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
