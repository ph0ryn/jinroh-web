import "server-only";

type ServerEnv = {
  accountTokenHashSecret: Uint8Array;
  supabaseServiceRoleKey: string;
  supabaseUrl: string;
};

const STANDARD_BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

let cachedEnv: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cachedEnv !== null) {
    return cachedEnv;
  }

  const supabaseUrl = readRequiredEnv("SUPABASE_URL");
  const supabaseServiceRoleKey = readRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const secretText = readRequiredEnv("ACCOUNT_TOKEN_HASH_SECRET");
  const decodedSecret = decodeStandardBase64HmacKey(secretText);

  cachedEnv = {
    accountTokenHashSecret: decodedSecret,
    supabaseServiceRoleKey,
    supabaseUrl,
  };

  return cachedEnv;
}

export function getSupabaseJwtSecret(): string {
  return readRequiredEnv("SUPABASE_JWT_SECRET");
}

function readRequiredEnv(key: string): string {
  const value = process.env[key];

  if (value === undefined || value.trim() === "") {
    throw new Error(`${key} is required.`);
  }

  return value;
}

function decodeStandardBase64HmacKey(secretText: string): Uint8Array {
  if (
    secretText.length % 4 !== 0 ||
    !STANDARD_BASE64_PATTERN.test(secretText) ||
    secretText.includes("-") ||
    secretText.includes("_")
  ) {
    throw new Error("ACCOUNT_TOKEN_HASH_SECRET must be standard base64.");
  }

  const decodedSecret = Buffer.from(secretText, "base64");

  if (decodedSecret.byteLength !== 32 || decodedSecret.toString("base64") !== secretText) {
    throw new Error("ACCOUNT_TOKEN_HASH_SECRET must decode to exactly 32 bytes.");
  }

  return decodedSecret;
}
