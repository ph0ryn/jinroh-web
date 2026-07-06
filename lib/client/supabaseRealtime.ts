"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedRealtimeClient: SupabaseClient | null | undefined = undefined;

export function getSupabaseRealtimeClient(): SupabaseClient | null {
  if (cachedRealtimeClient !== undefined) {
    return cachedRealtimeClient;
  }

  const supabaseUrl = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const supabaseAnonKey = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];

  if (
    supabaseUrl === undefined ||
    supabaseUrl.trim() === "" ||
    supabaseAnonKey === undefined ||
    supabaseAnonKey.trim() === ""
  ) {
    cachedRealtimeClient = null;

    return cachedRealtimeClient;
  }

  cachedRealtimeClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  return cachedRealtimeClient;
}
