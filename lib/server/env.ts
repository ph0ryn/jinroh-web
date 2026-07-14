import "server-only";
import {
  readApplicationServerEnvironment,
  readMaintenanceSecret,
  readSupabaseJwtSecret,
  validateServerEnvironment,
} from "./serverEnvironment.mjs";

type ServerEnv = {
  accountTokenHashSecret: Uint8Array;
  rateLimitTrustedClientIpHeader: string | null;
  supabaseServiceRoleKey: string;
  supabaseUrl: string;
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

export function getSupabaseJwtSecret(): string {
  return readSupabaseJwtSecret(process.env);
}

export function getMaintenanceSecret(): string {
  return readMaintenanceSecret(process.env);
}
