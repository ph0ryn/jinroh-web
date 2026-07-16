import { afterEach, describe, expect, it, vi } from "vitest";

const createClient = vi.fn(() => ({ kind: "realtime-client" }));

vi.mock("@supabase/supabase-js", () => ({ createClient }));

describe("Supabase Realtime client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    createClient.mockClear();
  });

  it("uses the publishable API key", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test-key");

    const { getSupabaseRealtimeClient } = await import("./supabaseRealtime");

    expect(getSupabaseRealtimeClient()).toEqual({ kind: "realtime-client" });
    expect(createClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "sb_publishable_test-key",
      expect.any(Object),
    );
  });

  it("does not accept the legacy anon-key variable", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "legacy-anon-key");

    const { getSupabaseRealtimeClient } = await import("./supabaseRealtime");

    expect(getSupabaseRealtimeClient()).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });
});
