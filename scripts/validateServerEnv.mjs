import nextEnvironment from "@next/env";

import { validateServerEnvironment } from "../lib/server/serverEnvironment.mjs";

process.env.NODE_ENV = "production";
nextEnvironment.loadEnvConfig(process.cwd(), false);

try {
  validateServerEnvironment(process.env, { production: true });
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown environment validation error.";

  console.error(`[startup] ${message}`);
  process.exitCode = 1;
}
