import type { RoleCounts, RoleId } from "./game";

export type RolePreset = {
  readonly description: string;
  readonly id: string;
  readonly name: string;
  readonly playerCount: number;
  readonly roleCounts: Readonly<Partial<Record<RoleId, number>>>;
  readonly shortLabel: string;
};

export const ROLE_PRESETS: readonly RolePreset[] = [
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
] as const;

export function getRolePresetsForPlayerCount(
  playerCount: number,
  roleIds?: readonly RoleId[],
): readonly RolePreset[] {
  return ROLE_PRESETS.filter(
    (preset) =>
      preset.playerCount === playerCount &&
      (roleIds === undefined || isRolePresetAvailable(preset, roleIds)),
  );
}

export function getMatchingRolePreset(
  playerCount: number,
  roleCounts: Readonly<Partial<Record<RoleId, number>>>,
  roleIds: readonly RoleId[],
): RolePreset | null {
  return (
    getRolePresetsForPlayerCount(playerCount, roleIds).find((preset) =>
      isRolePresetMatch(preset, roleCounts, roleIds),
    ) ?? null
  );
}

export function isRolePresetMatch(
  preset: RolePreset,
  roleCounts: Readonly<Partial<Record<RoleId, number>>>,
  roleIds: readonly RoleId[],
): boolean {
  return roleIds.every((roleId) => (roleCounts[roleId] ?? 0) === (preset.roleCounts[roleId] ?? 0));
}

export function expandRolePresetCounts(preset: RolePreset, roleIds: readonly RoleId[]): RoleCounts {
  return Object.fromEntries(
    roleIds.map((roleId) => [roleId, preset.roleCounts[roleId] ?? 0]),
  ) as RoleCounts;
}

function isRolePresetAvailable(preset: RolePreset, roleIds: readonly RoleId[]): boolean {
  const roleIdSet = new Set(roleIds);

  return Object.entries(preset.roleCounts).every(([roleId, count]) => {
    return (count ?? 0) <= 0 || roleIdSet.has(roleId);
  });
}
