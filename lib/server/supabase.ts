import "server-only";
import { createClient } from "@supabase/supabase-js";

import { getServerEnv } from "./env";

export function createServiceClient() {
  const { supabaseSecretKey, supabaseUrl } = getServerEnv();

  return createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
