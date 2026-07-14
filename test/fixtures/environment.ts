import { execFileSync } from "node:child_process";
import { isIP } from "node:net";

export async function getPublicSupabaseEnvironment(): Promise<{
  readonly anonKey: string;
  readonly url: string;
}> {
  const localEnvironment = readLocalSupabasePublicEnvironment();

  return {
    anonKey: localEnvironment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    url: localEnvironment.NEXT_PUBLIC_SUPABASE_URL,
  };
}

function readLocalSupabasePublicEnvironment() {
  const status: unknown = JSON.parse(
    execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }),
  );
  const apiUrl = readRequiredStatusValue(status, "API_URL");
  const anonKey = readRequiredStatusValue(status, "ANON_KEY");
  const url = new URL(apiUrl);
  const hostname = url.hostname.replace(/^\[|\]$/gu, "");
  const addressKind = isIP(hostname);

  if (
    !["http:", "https:"].includes(url.protocol) ||
    !(
      (addressKind === 4 && hostname.startsWith("127.")) ||
      (addressKind === 6 && hostname === "::1")
    )
  ) {
    throw new Error("Local Supabase API_URL must use a literal loopback address.");
  }

  return {
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    NEXT_PUBLIC_SUPABASE_URL: apiUrl,
  };
}

function readRequiredStatusValue(status: unknown, key: string): string {
  const value =
    typeof status === "object" && status !== null ? Reflect.get(status, key) : undefined;

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Local Supabase status did not provide ${key}.`);
  }

  return value;
}
