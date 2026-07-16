import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const isLocal = process.argv.includes("--local");
const supabaseExecutable = resolve("node_modules/.bin/supabase");

if (isLocal) {
  generateLocalSigningKey();
} else {
  printStandaloneSigningKey();
}

function generateLocalSigningKey() {
  const signingKeyPath = resolve("supabase/signing_keys.json");

  if (existsSync(signingKeyPath)) {
    console.error("supabase/signing_keys.json already exists; remove it to rotate the local key.");
    process.exitCode = 1;
    return;
  }

  writeFileSync(signingKeyPath, "[]\n", { flag: "wx", mode: 0o600 });
  const result = runSupabase(
    ["gen", "signing-key", "--algorithm", "ES256", "--append"],
    process.cwd(),
  );

  if (result.status !== 0) {
    rmSync(signingKeyPath, { force: true });
    process.exitCode = result.status ?? 1;
  }
}

function printStandaloneSigningKey() {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "jinroh-web-signing-key-"));

  try {
    const result = runSupabase(
      ["gen", "signing-key", "--algorithm", "ES256", "--output-format", "json"],
      temporaryDirectory,
    );

    process.exitCode = result.status ?? 1;
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

function runSupabase(arguments_, workingDirectory) {
  return spawnSync(supabaseExecutable, arguments_, {
    cwd: workingDirectory,
    stdio: "inherit",
  });
}
