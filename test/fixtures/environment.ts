import {
  createLocalE2eEnvironment,
  readLocalSupabaseStatusEnvironment,
} from "../../scripts/test/localEnvironment.mjs";

export async function getPublicSupabaseEnvironment(): Promise<{
  readonly anonKey: string;
  readonly url: string;
}> {
  if (process.env["E2E_BASE_URL"] !== undefined) {
    return readRemotePublicSupabaseEnvironment();
  }

  const localEnvironment = createLocalE2eEnvironment(
    process.env,
    readLocalSupabaseStatusEnvironment(),
  );

  return {
    anonKey: localEnvironment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    url: localEnvironment.NEXT_PUBLIC_SUPABASE_URL,
  };
}

function readRemotePublicSupabaseEnvironment(): { readonly anonKey: string; readonly url: string } {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const anonKey = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];

  if (url === undefined || anonKey === undefined) {
    throw new Error("Remote public Supabase test environment is not configured.");
  }

  return { anonKey, url };
}
