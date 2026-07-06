import "server-only";
import { createClient } from "@supabase/supabase-js";

import { getServerEnv } from "./env";

export function createServiceClient() {
  const { supabaseServiceRoleKey, supabaseUrl } = getServerEnv();

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
    },
  });
}
