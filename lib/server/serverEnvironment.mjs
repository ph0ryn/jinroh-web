const STANDARD_BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const HTTP_HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/**
 * @typedef {object} ApplicationServerEnvironment
 * @property {Uint8Array} accountTokenHashSecret
 * @property {string | null} rateLimitTrustedClientIpHeader
 * @property {string} supabaseServiceRoleKey
 * @property {string} supabaseUrl
 */

/**
 * @typedef {object} ServerEnvironmentValidationOptions
 * @property {boolean} [production]
 */

/**
 * @param {Readonly<Record<string, string | undefined>>} environment
 * @param {ServerEnvironmentValidationOptions} [options]
 * @returns {void}
 */
export function validateServerEnvironment(environment, options = {}) {
  readApplicationServerEnvironment(environment, options);
  readSupabaseJwtSecret(environment);
  readMaintenanceSecret(environment);
}

/**
 * @param {Readonly<Record<string, string | undefined>>} environment
 * @param {ServerEnvironmentValidationOptions} [options]
 * @returns {ApplicationServerEnvironment}
 */
export function readApplicationServerEnvironment(environment, options = {}) {
  const supabaseUrl = readRequiredEnvironmentVariable(environment, "SUPABASE_URL");
  const supabaseServiceRoleKey = readRequiredEnvironmentVariable(
    environment,
    "SUPABASE_SERVICE_ROLE_KEY",
  );
  const secretText = readRequiredEnvironmentVariable(environment, "ACCOUNT_TOKEN_HASH_SECRET");

  return {
    accountTokenHashSecret: decodeStandardBase64HmacKey(secretText),
    rateLimitTrustedClientIpHeader: readRateLimitTrustedClientIpHeader(environment, options),
    supabaseServiceRoleKey,
    supabaseUrl,
  };
}

/**
 * @param {Readonly<Record<string, string | undefined>>} environment
 * @returns {string}
 */
export function readSupabaseJwtSecret(environment) {
  return readRequiredEnvironmentVariable(environment, "SUPABASE_JWT_SECRET");
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
 * @param {ServerEnvironmentValidationOptions} options
 * @returns {string | null}
 */
function readRateLimitTrustedClientIpHeader(environment, options) {
  const configured = environment.RATE_LIMIT_TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase();
  let headerName = configured === undefined || configured === "" ? null : configured;

  if (headerName === null && environment.VERCEL === "1") {
    headerName = "x-vercel-forwarded-for";
  }

  const production = options.production ?? environment.NODE_ENV === "production";

  if (headerName === null) {
    if (production) {
      throw new Error("RATE_LIMIT_TRUSTED_CLIENT_IP_HEADER is required outside Vercel.");
    }

    return null;
  }

  if (!HTTP_HEADER_NAME_PATTERN.test(headerName)) {
    throw new Error("RATE_LIMIT_TRUSTED_CLIENT_IP_HEADER must be a valid HTTP header name.");
  }

  return headerName;
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
