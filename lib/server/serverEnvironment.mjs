import { createPrivateKey } from "node:crypto";

const STANDARD_BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * @typedef {object} ApplicationServerEnvironment
 * @property {Uint8Array} accountTokenHashSecret
 * @property {string} supabaseSecretKey
 * @property {string} supabaseUrl
 */

/**
 * @typedef {object} SupabaseJwtSigningKey
 * @property {'ES256'} alg
 * @property {'P-256'} crv
 * @property {string} d
 * @property {string} kid
 * @property {'EC'} kty
 * @property {string} x
 * @property {string} y
 */

/**
 * @param {Readonly<Record<string, string | undefined>>} environment
 * @returns {void}
 */
export function validateServerEnvironment(environment) {
  readApplicationServerEnvironment(environment);
  readSupabaseJwtSigningKey(environment);
  readMaintenanceSecret(environment);
}

/**
 * @param {Readonly<Record<string, string | undefined>>} environment
 * @returns {ApplicationServerEnvironment}
 */
export function readApplicationServerEnvironment(environment) {
  const supabaseUrl = readRequiredEnvironmentVariable(environment, "SUPABASE_URL");
  const supabaseSecretKey = readRequiredEnvironmentVariable(environment, "SUPABASE_SECRET_KEY");
  const secretText = readRequiredEnvironmentVariable(environment, "ACCOUNT_TOKEN_HASH_SECRET");

  if (!supabaseSecretKey.startsWith("sb_secret_")) {
    throw new Error("SUPABASE_SECRET_KEY must be a Supabase secret key.");
  }

  return {
    accountTokenHashSecret: decodeStandardBase64HmacKey(secretText),
    supabaseSecretKey,
    supabaseUrl,
  };
}

/**
 * @param {Readonly<Record<string, string | undefined>>} environment
 * @returns {SupabaseJwtSigningKey}
 */
export function readSupabaseJwtSigningKey(environment) {
  const serializedKey = readRequiredEnvironmentVariable(environment, "SUPABASE_JWT_SIGNING_KEY");
  const candidate = parseJsonWebKey(serializedKey);

  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("SUPABASE_JWT_SIGNING_KEY must be a valid private JWK.");
  }

  const signingKey = {
    alg: candidate.alg,
    crv: candidate.crv,
    d: candidate.d,
    kid: candidate.kid,
    kty: candidate.kty,
    x: candidate.x,
    y: candidate.y,
  };

  if (
    signingKey.alg !== "ES256" ||
    signingKey.crv !== "P-256" ||
    signingKey.kty !== "EC" ||
    !isNonEmptyString(signingKey.d) ||
    !isNonEmptyString(signingKey.kid) ||
    !isNonEmptyString(signingKey.x) ||
    !isNonEmptyString(signingKey.y)
  ) {
    throw new Error("SUPABASE_JWT_SIGNING_KEY must be a valid ES256 private JWK.");
  }

  try {
    createPrivateKey({ format: "jwk", key: signingKey });
  } catch {
    throw new Error("SUPABASE_JWT_SIGNING_KEY must be a valid ES256 private JWK.");
  }

  return signingKey;
}

/**
 * @param {string} serializedKey
 * @returns {unknown}
 */
function parseJsonWebKey(serializedKey) {
  try {
    return JSON.parse(serializedKey);
  } catch {
    throw new Error("SUPABASE_JWT_SIGNING_KEY must be a valid private JWK.");
  }
}

/**
 * @param {Readonly<Record<string, string | undefined>>} environment
 * @returns {string}
 */
export function readMaintenanceSecret(environment) {
  const maintenanceSecret = readRequiredEnvironmentVariable(environment, "MAINTENANCE_SECRET");

  if (Buffer.byteLength(maintenanceSecret, "utf8") < 32) {
    throw new Error("MAINTENANCE_SECRET must contain at least 32 bytes.");
  }

  return maintenanceSecret;
}

/**
 * @param {Readonly<Record<string, string | undefined>>} environment
 * @param {string} key
 * @returns {string}
 */
function readRequiredEnvironmentVariable(environment, key) {
  const value = environment[key];

  if (value === undefined || value.trim() === "") {
    throw new Error(`${key} is required.`);
  }

  return value;
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * @param {string} secretText
 * @returns {Uint8Array}
 */
function decodeStandardBase64HmacKey(secretText) {
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
