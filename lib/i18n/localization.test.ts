import { describe, expect, it } from "vitest";

import { roleRegistry } from "@/lib/server/game/roles";
import { ROLE_PRESETS } from "@/lib/shared/rolePresets";

import { localizations } from "./localization";
import {
  getLocalizedActionButtonLabel,
  getLocalizedActionLabel,
  getLocalizedActionProgressLabel,
  getLocalizedNightConversationLabel,
  getLocalizedRole,
  getLocalizedRoleOptionLabel,
  getLocalizedRolePreset,
  LOCALIZED_ACTION_KINDS,
  LOCALIZED_ACTION_PROGRESS_KINDS,
  LOCALIZED_NIGHT_CONVERSATION_KEYS,
  LOCALIZED_ROLE_IDS,
  LOCALIZED_ROLE_OPTIONS,
  LOCALIZED_ROLE_PRESET_IDS,
} from "./localization/resolvers";

import type { ActionKind } from "@/lib/shared/game";

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

  it("covers every registered role and role-specific option", () => {
    const registeredRoles = roleRegistry.getAll().map((role) => role.getPublicMetadata());

    expect([...LOCALIZED_ROLE_IDS].sort()).toEqual(registeredRoles.map((role) => role.id).sort());
    expect(
      LOCALIZED_ROLE_OPTIONS.map(({ optionKey, roleId }) => `${roleId}:${optionKey}`).sort(),
    ).toEqual(
      registeredRoles
        .flatMap((role) => role.specificOptions.map((option) => `${option.roleId}:${option.key}`))
        .sort(),
    );

    for (const localization of Object.values(localizations)) {
      for (const role of registeredRoles) {
        expect(getLocalizedRole(localization, role.id)).not.toEqual(
          localization.game.catalog.unknown.role,
        );

        for (const option of role.specificOptions) {
          expect(getLocalizedRoleOptionLabel(localization, role.id, option.key)).not.toBe(
            localization.game.catalog.unknown.roleOption,
          );
        }
      }
    }
  });

  it("covers every public action and action-progress kind", () => {
    const actionKinds = [
      "first_night_ready",
      "inspect",
      "guard",
      "attack",
      "day_ready",
      "vote",
      "end_speech",
      "execution_skip",
      "hunter_retaliate",
    ] as const satisfies readonly ActionKind[];

    expect([...LOCALIZED_ACTION_KINDS].sort()).toEqual([...actionKinds].sort());

    for (const localization of Object.values(localizations)) {
      for (const actionKind of actionKinds) {
        expect(getLocalizedActionLabel(localization, actionKind)).not.toBe(
          localization.game.catalog.unknown.action,
        );
        expect(getLocalizedActionButtonLabel(localization, actionKind)).not.toBe(
          localization.game.actions.button.submit,
        );
      }

      for (const progressKind of LOCALIZED_ACTION_PROGRESS_KINDS) {
        expect(getLocalizedActionProgressLabel(localization, progressKind)).not.toBe(
          localization.game.catalog.unknown.actionProgress,
        );
      }
    }
  });

  it("covers every role preset and night-conversation key", () => {
    expect([...LOCALIZED_ROLE_PRESET_IDS].sort()).toEqual(
      ROLE_PRESETS.map((preset) => preset.id).sort(),
    );

    const nightConversationKeys = roleRegistry
      .getAll()
      .flatMap((role) =>
        role.nightConversation === null ? [] : [role.nightConversation.labelKey],
      );
    expect([...LOCALIZED_NIGHT_CONVERSATION_KEYS].sort()).toEqual(nightConversationKeys.sort());

    for (const localization of Object.values(localizations)) {
      for (const preset of ROLE_PRESETS) {
        expect(getLocalizedRolePreset(localization, preset.id)).not.toEqual(
          localization.game.catalog.unknown.rolePreset,
        );
      }

      for (const labelKey of nightConversationKeys) {
        expect(getLocalizedNightConversationLabel(localization, labelKey)).not.toBe(
          localization.game.catalog.unknown.nightConversation,
        );
      }
    }
  });

  it("uses localized fallbacks instead of unknown source text", () => {
    expect(getLocalizedRole(localizations.ja, "future-role").name).toBe("不明な役職");
    expect(getLocalizedActionLabel(localizations.ja, "Future action in English")).toBe(
      "不明な行動",
    );
    expect(getLocalizedActionProgressLabel(localizations.en, "future-progress")).toBe(
      "Progress unavailable",
    );
    expect(getLocalizedNightConversationLabel(localizations.ja, "future-chat")).toBe(
      "非公開の会話",
    );
    expect(getLocalizedRoleOptionLabel(localizations.en, "future-role", "future-option")).toBe(
      "Role option",
    );
    expect(getLocalizedRolePreset(localizations.ja, "future-preset").name).toBe("不明な役職構成");
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
