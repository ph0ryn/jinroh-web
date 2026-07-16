import { generateKeyPairSync, randomUUID } from "node:crypto";

export function createTestSupabaseJwtSigningKey(): string {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });

  return JSON.stringify({
    ...privateKey.export({ format: "jwk" }),
    alg: "ES256",
    key_ops: ["sign", "verify"],
    kid: randomUUID(),
    use: "sig",
  });
}
