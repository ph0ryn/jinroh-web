import { execFileSync } from "node:child_process";
import { isIP } from "node:net";

export const E2E_ACCOUNT_TOKEN_HASH_SECRET = "amlucm9oLWUyZS1hY2NvdW50LXRva2VuLXNlY3JldCE=";

/**
 * @typedef {object} LocalE2eEnvironmentValues
 * @property {string} ACCOUNT_TOKEN_HASH_SECRET
 * @property {string} NEXT_PUBLIC_SUPABASE_ANON_KEY
 * @property {string} NEXT_PUBLIC_SUPABASE_URL
 * @property {string} SUPABASE_JWT_SECRET
 * @property {string} SUPABASE_SERVICE_ROLE_KEY
 * @property {string} SUPABASE_URL
 */

export function readLocalSupabaseStatusEnvironment() {
  return parseSupabaseStatusEnvironment(
    execFileSync("pnpm", ["exec", "supabase", "status", "-o", "env"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }),
  );
}

/**
 * @param {string} output
 * @returns {Record<string, string>}
 */
export function parseSupabaseStatusEnvironment(output) {
  return Object.fromEntries(
    output.split("\n").flatMap((line) => {
      const separatorIndex = line.indexOf("=");

      if (separatorIndex <= 0) {
        return [];
      }

      const key = line.slice(0, separatorIndex).trim();
      const rawValue = line.slice(separatorIndex + 1).trim();

      if (key === "") {
        return [];
      }

      return [[key, parseEnvironmentValue(rawValue)]];
    }),
  );
}

/**
 * @template {Readonly<Record<string, string | undefined>>} BaseEnvironment
 * @param {BaseEnvironment} baseEnvironment
 * @param {Readonly<Record<string, string | undefined>>} statusEnvironment
 * @returns {BaseEnvironment & LocalE2eEnvironmentValues}
 */
export function createLocalE2eEnvironment(baseEnvironment, statusEnvironment) {
  const apiUrl = readRequiredStatusValue(statusEnvironment, "API_URL");
  const anonKey = readRequiredStatusValue(statusEnvironment, "ANON_KEY");
  const jwtSecret = readRequiredStatusValue(statusEnvironment, "JWT_SECRET");
  const serviceRoleKey = readRequiredStatusValue(statusEnvironment, "SERVICE_ROLE_KEY");

  assertLoopbackUrl(apiUrl);

  return {
    ...baseEnvironment,
    ACCOUNT_TOKEN_HASH_SECRET: E2E_ACCOUNT_TOKEN_HASH_SECRET,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    NEXT_PUBLIC_SUPABASE_URL: apiUrl,
    SUPABASE_JWT_SECRET: jwtSecret,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    SUPABASE_URL: apiUrl,
  };
}

/**
 * Resolve a remote application origin only when destructive preview writes were
 * explicitly authorized. The Playwright suites create identities and rooms, so
 * an arbitrary deployment must never be accepted implicitly.
 *
 * @param {Readonly<Record<string, string | undefined>>} environment
 * @returns {string | undefined}
 */
export function resolveExternalBaseUrl(environment) {
  const rawBaseUrl = environment.E2E_BASE_URL?.trim();

  if (rawBaseUrl === undefined || rawBaseUrl === "") {
    return undefined;
  }

  if (environment.E2E_ALLOW_REMOTE_WRITES !== "1") {
    throw new Error(
      "Remote E2E writes are disabled. Set E2E_ALLOW_REMOTE_WRITES=1 only for an isolated preview environment.",
    );
  }

  const url = parseUrl(rawBaseUrl);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("E2E_BASE_URL must use HTTP or HTTPS.");
  }

  if (url.username !== "" || url.password !== "") {
    throw new Error("E2E_BASE_URL must not include credentials.");
  }

  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new Error("E2E_BASE_URL must be an origin without a path, query, or fragment.");
  }

  return url.origin;
}

/**
 * @param {string} value
 */
export function assertLoopbackUrl(value) {
  const url = parseUrl(value);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Local Supabase API_URL must use HTTP or HTTPS.");
  }

  const hostname = url.hostname.replace(/^\[|\]$/gu, "");
  const addressKind = isIP(hostname);
  const isIpv4Loopback = addressKind === 4 && hostname.startsWith("127.");
  const isIpv6Loopback = addressKind === 6 && hostname === "::1";

  if (!isIpv4Loopback && !isIpv6Loopback) {
    throw new Error("Local Supabase API_URL must use a literal loopback address.");
  }
}

/**
 * @param {Readonly<Record<string, string | undefined>>} environment
 * @param {string} key
 */
function readRequiredStatusValue(environment, key) {
  const value = environment[key];

  if (value === undefined || value.trim() === "") {
    throw new Error(`Local Supabase status did not provide ${key}.`);
  }

  return value;
}

/**
 * @param {string} value
 */
function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    throw new Error("E2E environment URL must be valid.");
  }
}

function parseEnvironmentValue(rawValue) {
  if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
    try {
      const value = JSON.parse(rawValue);

      if (typeof value === "string") {
        return value;
      }
    } catch {
      throw new Error("Supabase status returned an invalid quoted environment value.");
    }
  }

  return rawValue;
}
