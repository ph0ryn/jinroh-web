import { describe, expect, it } from "vitest";

import { localizations } from "./localization";

type LeafKind = "function" | "string";

describe("localization", () => {
  it("keeps Japanese localization structurally aligned with English", () => {
    expect(flattenLocalization(localizations.ja)).toEqual(flattenLocalization(localizations.en));
  });

  it("does not define empty localized strings", () => {
    for (const [locale, localization] of Object.entries(localizations)) {
      const emptyPaths = collectEmptyStringPaths(localization);

      expect(emptyPaths, `${locale} has empty localization values`).toEqual([]);
    }
  });
});

function flattenLocalization(value: unknown, path = ""): Record<string, LeafKind> {
  if (typeof value === "string") {
    return { [path]: "string" };
  }

  if (typeof value === "function") {
    return { [path]: "function" };
  }

  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) =>
      Object.entries(flattenLocalization(child, path === "" ? key : `${path}.${key}`)),
    ),
  );
}

function collectEmptyStringPaths(value: unknown, path = ""): string[] {
  if (typeof value === "string") {
    return value.trim() === "" ? [path] : [];
  }

  if (!isRecord(value)) {
    return [];
  }

  return Object.entries(value).flatMap(([key, child]) =>
    collectEmptyStringPaths(child, path === "" ? key : `${path}.${key}`),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
