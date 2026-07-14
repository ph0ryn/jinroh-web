import { describe, expect, it } from "vitest";

import { roleRegistry } from "@/lib/server/game/roles";
import { ROLE_PRESETS } from "@/lib/shared/rolePresets";

import { localizations } from "./localization";
import {
  getLocalizedActionProgressLabel,
  getLocalizedRole,
  getLocalizedRolePreset,
  LOCALIZED_ACTION_PROGRESS_KINDS,
  LOCALIZED_ROLE_PRESET_IDS,
} from "./localization/resolvers";

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

  it("keeps optional role overrides aligned with registered role metadata", () => {
    const registeredRoles = roleRegistry.getAll().map((role) => role.getPublicMetadata());

    for (const [locale, localization] of Object.entries(localizations)) {
      for (const role of registeredRoles) {
        expect(getLocalizedRole(localization, locale as "en" | "ja", role)).not.toEqual(
          localization.game.catalog.unknown.role,
        );
      }
    }
  });

  it("covers every action-progress kind", () => {
    for (const localization of Object.values(localizations)) {
      for (const progressKind of LOCALIZED_ACTION_PROGRESS_KINDS) {
        expect(getLocalizedActionProgressLabel(localization, progressKind)).not.toBe(
          localization.game.catalog.unknown.actionProgress,
        );
      }
    }
  });

  it("keeps optional preset overrides aligned with registered data", () => {
    for (const presetId of LOCALIZED_ROLE_PRESET_IDS) {
      expect(ROLE_PRESETS.some((preset) => preset.id === presetId)).toBe(true);
    }

    for (const localization of Object.values(localizations)) {
      for (const preset of ROLE_PRESETS.filter((candidate) =>
        LOCALIZED_ROLE_PRESET_IDS.some((presetId) => presetId === candidate.id),
      )) {
        expect(getLocalizedRolePreset(localization, preset.id)).not.toEqual(
          localization.game.catalog.unknown.rolePreset,
        );
      }
    }
  });

  it("resolves registered presentation and falls back through the active localization", () => {
    const unknownRole = getLocalizedRole(localizations.ja, "ja");
    const registeredPresentation = {
      description: "fixture-ja-description",
      name: "fixture-ja-name",
      shortLabel: "fixture-ja-short-label",
    };

    expect(unknownRole).toEqual(localizations.ja.game.catalog.unknown.role);
    expect(
      getLocalizedRole(localizations.ja, "ja", {
        presentation: {
          en: {
            description: "fixture-en-description",
            name: "fixture-en-name",
            shortLabel: "fixture-en-short-label",
          },
          ja: registeredPresentation,
        },
      }),
    ).toEqual(registeredPresentation);
    expect(getLocalizedActionProgressLabel(localizations.en, "future-progress")).toBe(
      localizations.en.game.catalog.unknown.actionProgress,
    );
    expect(getLocalizedRolePreset(localizations.ja, "future-preset")).toEqual(
      localizations.ja.game.catalog.unknown.rolePreset,
    );
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
