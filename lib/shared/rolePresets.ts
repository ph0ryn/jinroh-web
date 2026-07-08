import { ROLE_IDS, type BuiltInRoleId, type RoleCounts } from "./game";

export type RolePreset = {
  readonly description: string;
  readonly id: string;
  readonly name: string;
  readonly playerCount: number;
  readonly roleCounts: Readonly<RoleCounts>;
  readonly shortLabel: string;
};

type RolePresetInput = Omit<RolePreset, "roleCounts"> & {
  readonly roleCounts: Partial<Record<BuiltInRoleId, number>>;
};

export const ROLE_PRESETS: readonly RolePreset[] = [
  createRolePreset({
    description: "Compact village setup for a six-player room.",
    id: "6p-classic",
    name: "Classic six",
    playerCount: 6,
    roleCounts: {
      madman: 1,
      seer: 1,
      villager: 3,
      werewolf: 1,
    },
    shortLabel: "6C",
  }),
  createRolePreset({
    description: "Seven-player setup with guard protection enabled.",
    id: "7p-guard",
    name: "Guard seven",
    playerCount: 7,
    roleCounts: {
      guard: 1,
      madman: 1,
      seer: 1,
      villager: 3,
      werewolf: 1,
    },
    shortLabel: "7G",
  }),
  createRolePreset({
    description: "Seven-player setup without guard protection.",
    id: "7p-open",
    name: "Open seven",
    playerCount: 7,
    roleCounts: {
      madman: 1,
      seer: 1,
      villager: 4,
      werewolf: 1,
    },
    shortLabel: "7O",
  }),
  createRolePreset({
    description: "Nine-player setup with execution result information.",
    id: "9p-spiritist",
    name: "Spiritist nine",
    playerCount: 9,
    roleCounts: {
      guard: 1,
      madman: 1,
      seer: 1,
      spiritist: 1,
      villager: 3,
      werewolf: 2,
    },
    shortLabel: "9S",
  }),
  createRolePreset({
    description: "Nine-player setup with execution retaliation pressure.",
    id: "9p-hunter",
    name: "Hunter nine",
    playerCount: 9,
    roleCounts: {
      guard: 1,
      hunter: 1,
      madman: 1,
      seer: 1,
      villager: 3,
      werewolf: 2,
    },
    shortLabel: "9H",
  }),
] as const;

export function getRolePresetsForPlayerCount(playerCount: number): readonly RolePreset[] {
  return ROLE_PRESETS.filter((preset) => preset.playerCount === playerCount);
}

export function getMatchingRolePreset(
  playerCount: number,
  roleCounts: Readonly<RoleCounts>,
): RolePreset | null {
  return (
    getRolePresetsForPlayerCount(playerCount).find((preset) =>
      isRolePresetMatch(preset, roleCounts),
    ) ?? null
  );
}

export function isRolePresetMatch(preset: RolePreset, roleCounts: Readonly<RoleCounts>): boolean {
  return ROLE_IDS.every((roleId) => roleCounts[roleId] === preset.roleCounts[roleId]);
}

function createRolePreset(input: RolePresetInput): RolePreset {
  return {
    ...input,
    roleCounts: Object.fromEntries(
      ROLE_IDS.map((roleId) => [roleId, input.roleCounts[roleId] ?? 0]),
    ) as RoleCounts,
  };
}
