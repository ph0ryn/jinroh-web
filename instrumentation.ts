export async function register(): Promise<void> {
  if (process.env["NEXT_RUNTIME"] === "edge") {
    return;
  }

  const { validateServerEnv } = await import("./lib/server/env");

  validateServerEnv();
}
