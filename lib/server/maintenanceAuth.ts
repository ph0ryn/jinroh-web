import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

import { getMaintenanceSecret } from "./env";
import { parseBearerToken } from "./http";

export function isAuthorizedMaintenanceRequest(request: Request): boolean {
  const providedToken = parseBearerToken(request);

  if (providedToken === null) {
    return false;
  }

  const expectedDigest = digestSecret(getMaintenanceSecret());
  const providedDigest = digestSecret(providedToken);

  return timingSafeEqual(expectedDigest, providedDigest);
}

function digestSecret(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}
