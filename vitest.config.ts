import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": new URL(".", import.meta.url).pathname,
      "server-only": new URL("./test/setup/server-only.ts", import.meta.url).pathname,
    },
  },
  test: {
    include: ["app/**/*.test.ts", "lib/**/*.test.ts", "test/unit/**/*.test.ts"],
  },
});
