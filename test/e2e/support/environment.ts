import { readFile } from "node:fs/promises";

export async function getPublicSupabaseEnvironment(): Promise<{
  readonly anonKey: string;
  readonly url: string;
}> {
  const fileEnvironment = await readEnvironmentFile(".env.local");
  const url =
    process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? fileEnvironment["NEXT_PUBLIC_SUPABASE_URL"];
  const anonKey =
    process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] ??
    fileEnvironment["NEXT_PUBLIC_SUPABASE_ANON_KEY"];

  if (url === undefined || anonKey === undefined) {
    throw new Error("Public Supabase E2E environment is not configured.");
  }

  return { anonKey, url };
}

async function readEnvironmentFile(path: string): Promise<Record<string, string>> {
  try {
    const contents = await readFile(path, "utf8");

    return Object.fromEntries(
      contents.split("\n").flatMap((line) => {
        const separatorIndex = line.indexOf("=");

        if (separatorIndex <= 0 || line.trimStart().startsWith("#")) {
          return [];
        }

        const key = line.slice(0, separatorIndex).trim();
        const rawValue = line.slice(separatorIndex + 1).trim();
        const value =
          rawValue.startsWith('"') && rawValue.endsWith('"') ? rawValue.slice(1, -1) : rawValue;

        return [[key, value]];
      }),
    );
  } catch {
    return {};
  }
}
