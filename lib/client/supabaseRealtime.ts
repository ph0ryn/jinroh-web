"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedRealtimeClient: SupabaseClient | null | undefined = undefined;

export function getSupabaseRealtimeClient(): SupabaseClient | null {
  if (cachedRealtimeClient !== undefined) {
    return cachedRealtimeClient;
  }

  const supabaseUrl = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const supabasePublishableKey = process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];

  if (
    supabaseUrl === undefined ||
    supabaseUrl.trim() === "" ||
    supabasePublishableKey === undefined ||
    !supabasePublishableKey.startsWith("sb_publishable_")
  ) {
    cachedRealtimeClient = null;

    return cachedRealtimeClient;
  }

  cachedRealtimeClient = createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  return cachedRealtimeClient;
}
