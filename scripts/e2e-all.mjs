import { spawn } from "node:child_process";

const checks = [
  {
    args: ["run", "test:e2e"],
    label: "live smoke",
  },
  {
    args: ["exec", "node", "scripts/e2e-live-smoke.mjs"],
    env: {
      E2E_PORT: "3015",
      E2E_RULESET: "ordered_speech",
    },
    label: "ordered speech smoke",
  },
  {
    args: ["run", "test:e2e:roles"],
    label: "role coverage",
  },
  {
    args: ["run", "test:e2e:security"],
    label: "security coverage",
  },
];

for (const check of checks) {
  console.log(`\n=== ${check.label} ===`);
  await runPnpm(check.args, check.env ?? {});
}

function runPnpm(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", args, {
      env: { ...process.env, ...env },
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();

        return;
      }

      reject(new Error(`pnpm ${args.join(" ")} failed with ${signal ?? code}.`));
    });
  });
}
