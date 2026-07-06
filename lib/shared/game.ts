export const ROLE_IDS = ["werewolf", "villager", "madman", "seer", "guard", "fox"] as const;

export type RoleId = (typeof ROLE_IDS)[number];

export type Team = "villagers" | "werewolves" | "fox";

export type CountGroup = "villager" | "werewolf" | "none";

export type InspectionResult = "human" | "werewolf";

export type RoomStatus = "lobby" | "playing" | "disbanded" | "ended";

export type PlayerStatus = "joined" | "disconnected" | "left";

export type GameStatus = "waiting" | "assigning_roles" | "playing" | "ended";

export type GamePhase = "night" | "day" | "voting" | "execution";

export type ActionKind =
  | "first_night_ready"
  | "inspect"
  | "guard"
  | "attack"
  | "day_ready"
  | "vote"
  | "execution_skip";

export type DeathReason = "attack" | "execution" | "rule_effect";

export type GameEventVisibility = "public" | "private" | "internal";

export type RoomSummary = {
  code: string;
  status: RoomStatus;
  lobbyExpiresAt: string;
  hostPlayerId: string | null;
  currentPlayerId: string | null;
  isHost: boolean;
  players: PublicPlayer[];
  game: PublicGameView | null;
  self: SelfPrivateView | null;
  rolePrivate: RolePrivateView | null;
  realtime: RealtimeView | null;
};

export type PublicPlayer = {
  id: string;
  displayName: string;
  status: PlayerStatus;
  alive: boolean | null;
  isHost: boolean;
  isCurrent: boolean;
};

export type PublicGameView = {
  status: GameStatus;
  phase: GamePhase | null;
  dayNumber: number;
  nightNumber: number;
  phaseInstanceId: string | null;
  phaseEndsAt: string | null;
  winnerTeam: Team | null;
  events: PublicGameEvent[];
};

export type PublicGameEvent = {
  kind: string;
  message: string;
  createdAt: string;
};

export type SelfPrivateView = {
  playerId: string;
  roleId: RoleId | null;
  roleName: string | null;
  actions: PublicAction[];
  events: PrivateGameEvent[];
  result: "win" | "lose" | null;
};

export type PrivateGameEvent = {
  kind: string;
  message: string;
  createdAt: string;
};

export type RolePrivateView = {
  roleId: RoleId;
  label: string;
  werewolfPartnerIds: string[];
  consultation: WerewolfConsultationSlot[];
} | null;

export type WerewolfConsultationSlot = {
  templateId: string;
  label: string;
  value: string | null;
  status: "empty" | "submitted" | "retracted" | "resubmitted";
  readOnly: boolean;
};

export type PublicAction = {
  key: string;
  kind: ActionKind;
  label: string;
  phaseInstanceId: string;
  targetKind: "none" | "single_player";
  eligibleTargetIds: string[];
  closesAt: string | null;
};

export type RealtimeView = {
  topic: string;
};

export type RuleSetInput = {
  roleCounts: Partial<Record<RoleId, number>>;
  dayMode: "ready_check" | "ordered_speech";
  guardConsecutiveTargetPolicy: "allow" | "deny";
  initialInspectionPolicy: "enabled" | "disabled";
  voteResultVisibility: "count_only" | "voter_to_target";
};

export type RuleSet = {
  roleCounts: Record<RoleId, number>;
  dayMode: "ready_check" | "ordered_speech";
  guardConsecutiveTargetPolicy: "allow" | "deny";
  initialInspectionPolicy: "enabled" | "disabled";
  voteResultVisibility: "count_only" | "voter_to_target";
};

export type RoleDefinition = {
  id: RoleId;
  name: string;
  team: Team;
  countAs: CountGroup;
  seenAs: InspectionResult;
  minCount: number;
  maxCount: number;
};

export const ROLE_DEFINITIONS: Record<RoleId, RoleDefinition> = {
  fox: {
    id: "fox",
    name: "Fox",
    team: "fox",
    countAs: "none",
    seenAs: "human",
    minCount: 0,
    maxCount: 1,
  },
  guard: {
    id: "guard",
    name: "Guard",
    team: "villagers",
    countAs: "villager",
    seenAs: "human",
    minCount: 0,
    maxCount: 1,
  },
  madman: {
    id: "madman",
    name: "Madman",
    team: "werewolves",
    countAs: "villager",
    seenAs: "human",
    minCount: 0,
    maxCount: 1,
  },
  seer: {
    id: "seer",
    name: "Seer",
    team: "villagers",
    countAs: "villager",
    seenAs: "human",
    minCount: 0,
    maxCount: 1,
  },
  villager: {
    id: "villager",
    name: "Villager",
    team: "villagers",
    countAs: "villager",
    seenAs: "human",
    minCount: 0,
    maxCount: 99,
  },
  werewolf: {
    id: "werewolf",
    name: "Werewolf",
    team: "werewolves",
    countAs: "werewolf",
    seenAs: "werewolf",
    minCount: 1,
    maxCount: 99,
  },
};

export const DEFAULT_RULE_SET: RuleSet = {
  dayMode: "ready_check",
  guardConsecutiveTargetPolicy: "deny",
  initialInspectionPolicy: "enabled",
  roleCounts: {
    fox: 0,
    guard: 1,
    madman: 1,
    seer: 1,
    villager: 3,
    werewolf: 2,
  },
  voteResultVisibility: "count_only",
};

export function normalizeRuleSet(input: RuleSetInput, playerCount: number): RuleSet {
  const roleCounts = Object.fromEntries(
    ROLE_IDS.map((roleId) => [roleId, input.roleCounts[roleId] ?? 0]),
  ) as Record<RoleId, number>;
  const specifiedCount = ROLE_IDS.reduce((total, roleId) => total + roleCounts[roleId], 0);

  if (specifiedCount === 0) {
    return makeDefaultRuleSetForPlayers(playerCount);
  }

  return {
    dayMode: input.dayMode,
    guardConsecutiveTargetPolicy: input.guardConsecutiveTargetPolicy,
    initialInspectionPolicy: input.initialInspectionPolicy,
    roleCounts,
    voteResultVisibility: input.voteResultVisibility,
  };
}

export function makeDefaultRuleSetForPlayers(playerCount: number): RuleSet {
  const werewolfCount = playerCount >= 7 ? 2 : 1;
  const seerCount = playerCount >= 4 ? 1 : 0;
  const guardCount = playerCount >= 5 ? 1 : 0;
  const madmanCount = playerCount >= 6 ? 1 : 0;
  const foxCount = playerCount >= 8 ? 1 : 0;
  const specialCount = werewolfCount + seerCount + guardCount + madmanCount + foxCount;

  return {
    ...DEFAULT_RULE_SET,
    roleCounts: {
      fox: foxCount,
      guard: guardCount,
      madman: madmanCount,
      seer: seerCount,
      villager: Math.max(playerCount - specialCount, 0),
      werewolf: werewolfCount,
    },
  };
}

export type RuleSetValidationResult =
  | { ok: true; ruleSet: RuleSet }
  | { ok: false; errors: string[] };

export function validateRuleSet(ruleSet: RuleSet, playerCount: number): RuleSetValidationResult {
  const errors: string[] = [];
  const totalRoles = ROLE_IDS.reduce((total, roleId) => total + ruleSet.roleCounts[roleId], 0);

  if (playerCount < 3) {
    errors.push("At least three joined players are required.");
  }

  if (totalRoles !== playerCount) {
    errors.push(`Role count (${totalRoles}) must match joined player count (${playerCount}).`);
  }

  for (const roleId of ROLE_IDS) {
    const definition = ROLE_DEFINITIONS[roleId];
    const count = ruleSet.roleCounts[roleId];

    if (!Number.isInteger(count) || count < 0) {
      errors.push(`${definition.name} count must be a non-negative integer.`);
    }

    if (count < definition.minCount) {
      errors.push(`${definition.name} count must be at least ${definition.minCount}.`);
    }

    if (count > definition.maxCount) {
      errors.push(`${definition.name} count must be at most ${definition.maxCount}.`);
    }
  }

  if (ruleSet.initialInspectionPolicy === "enabled") {
    const humanInspectionCandidates =
      ruleSet.roleCounts.villager + ruleSet.roleCounts.guard + ruleSet.roleCounts.madman;

    if (ruleSet.roleCounts.seer > 0 && humanInspectionCandidates <= 0) {
      errors.push("Initial inspection requires at least one non-seer human result candidate.");
    }
  }

  return errors.length === 0 ? { ok: true, ruleSet } : { errors, ok: false };
}

export function getRoleName(roleId: RoleId | null): string | null {
  return roleId === null ? null : ROLE_DEFINITIONS[roleId].name;
}

export function isRoleId(value: string): value is RoleId {
  return (ROLE_IDS as readonly string[]).includes(value);
}
