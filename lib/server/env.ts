import "server-only";
import {
  readApplicationServerEnvironment,
  readMaintenanceSecret,
  readSupabaseJwtSigningKey,
  validateServerEnvironment,
} from "./serverEnvironment.mjs";

type ServerEnv = {
  accountTokenHashSecret: Uint8Array;
  rateLimitTrustedClientIpHeader: string | null;
  supabaseSecretKey: string;
  supabaseUrl: string;
};

export type SupabaseJwtSigningKey = {
  alg: "ES256";
  crv: "P-256";
  d: string;
  kid: string;
  kty: "EC";
  x: string;
  y: string;
};

let cachedEnv: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cachedEnv !== null) {
    return cachedEnv;
  }

  cachedEnv = readApplicationServerEnvironment(process.env);

  return cachedEnv;
}

export function validateServerEnv(): void {
  validateServerEnvironment(process.env);
}

export function getSupabaseJwtSigningKey(): SupabaseJwtSigningKey {
  return readSupabaseJwtSigningKey(process.env);
}

export function getMaintenanceSecret(): string {
  return readMaintenanceSecret(process.env);
}
