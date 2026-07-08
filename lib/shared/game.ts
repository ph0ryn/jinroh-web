export const ROLE_IDS = [
  "werewolf",
  "villager",
  "madman",
  "seer",
  "guard",
  "spiritist",
  "hunter",
  "fox",
] as const;
export const MIN_ROOM_PLAYERS = 3;
export const MAX_ROOM_PLAYERS = 10;
export const DEFAULT_TARGET_PLAYER_COUNT = 6;

export type BuiltInRoleId = (typeof ROLE_IDS)[number];

export type RoleId = string;

export type Team = string;

export type CountGroup = "villager" | "werewolf" | "none";

export type InspectionResult = "human" | "werewolf";

export type PlayerResult = "win" | "lose" | "draw" | "special";

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
  | "end_speech"
  | "execution_skip"
  | "hunter_retaliate";

export type DeathReason = "attack" | "execution" | "retaliation" | "rule_effect";

export type GameEventVisibility = "public" | "private" | "internal";

export type RoomSummary = {
  code: string;
  status: RoomStatus;
  lobbyExpiresAt: string;
  targetPlayerCount: number;
  hostPlayerId: string | null;
  currentPlayerId: string | null;
  isHost: boolean;
  players: PublicPlayer[];
  roleCatalog: RoleCatalogItem[];
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
  revision: number;
  winnerTeam: Team | null;
  actionProgress: PublicActionProgress | null;
  events: PublicGameEvent[];
};

export type PublicGameEvent = {
  kind: string;
  message: string;
  createdAt: string;
  details: PublicGameEventDetail[];
};

export type PublicGameEventDetail = {
  label: string;
  value: string;
};

export type PublicActionProgress =
  | {
      visibility: "public";
      required: number;
      submitted: number;
      label: string;
    }
  | {
      visibility: "hidden";
      label: string;
    };

export type PublicActionStatus = "open" | "submitted";

export type PublicSubmittedAction = {
  kind: ActionKind;
  label: string;
  submittedAt: string;
};

export type SelfPrivateView = {
  playerId: string;
  roleId: RoleId | null;
  roleName: string | null;
  actions: PublicAction[];
  events: PrivateGameEvent[];
  submittedActions: PublicSubmittedAction[];
  result: PlayerResult | null;
};

export type PrivateGameEvent = {
  kind: string;
  message: string;
  createdAt: string;
};

export type RolePrivateView = {
  roleId: RoleId;
  label: string;
  nightConversation: NightConversationView | null;
} | null;

export type NightConversationView = {
  canSend: boolean;
  groupId: string;
  label: string;
  maxMessageLength: number;
  messages: NightConversationMessage[];
  nightNumber: number;
  participantPlayerIds: string[];
  readOnly: boolean;
};

export type NightConversationMessage = {
  body: string;
  createdAt: string;
  id: string;
  senderName: string;
  senderPlayerId: string;
};

export type PublicAction = {
  key: string;
  kind: ActionKind;
  label: string;
  phaseInstanceId: string;
  status: PublicActionStatus;
  targetKind: "none" | "single_player";
  eligibleTargetIds: string[];
  closesAt: string | null;
};

export type RealtimeScope = "player_private" | "role_private" | "room";

export type RealtimeSubscription = {
  expiresAt: string;
  grantId: string;
  scope: RealtimeScope;
  topic: string;
};

export type RealtimeView = {
  subscriptions: RealtimeSubscription[];
  topic: string;
};

export type RuleSetInput = {
  roleCounts: Partial<Record<RoleId, number>>;
  dayMode: "ready_check" | "ordered_speech";
  dayReadyCheckSecondsPerPlayer: number;
  daySpeechSeconds: number;
  executionLastWordsSeconds: number;
  firstDaySpeechRounds: number;
  firstNightSeconds: number;
  guardConsecutiveTargetPolicy: "allow" | "deny";
  initialInspectionPolicy: "enabled" | "disabled";
  nightSeconds: number;
  normalDaySpeechRounds: number;
  voteResultVisibility: "count_only" | "voter_to_target";
  votingSeconds: number;
};

export type RoleCounts = Record<BuiltInRoleId, number> & Partial<Record<RoleId, number>>;

export type RuleSet = {
  roleCounts: RoleCounts;
  dayMode: "ready_check" | "ordered_speech";
  dayReadyCheckSecondsPerPlayer: number;
  daySpeechSeconds: number;
  executionLastWordsSeconds: number;
  firstDaySpeechRounds: number;
  firstNightSeconds: number;
  guardConsecutiveTargetPolicy: "allow" | "deny";
  initialInspectionPolicy: "enabled" | "disabled";
  nightSeconds: number;
  normalDaySpeechRounds: number;
  voteResultVisibility: "count_only" | "voter_to_target";
  votingSeconds: number;
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

export type RoleCatalogItem = {
  description: string;
  id: RoleId;
  maxCount: number | null;
  minCount: number;
  name: string;
  order: number;
  shortLabel: string;
  team: Team;
};

export const ROLE_DEFINITIONS: Record<BuiltInRoleId, RoleDefinition> = {
  fox: {
    id: "fox",
    name: "Fox",
    team: "fox",
    countAs: "villager",
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
  hunter: {
    id: "hunter",
    name: "Hunter",
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
  spiritist: {
    id: "spiritist",
    name: "Spiritist",
    team: "villagers",
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
  dayReadyCheckSecondsPerPlayer: 90,
  daySpeechSeconds: 90,
  executionLastWordsSeconds: 60,
  firstDaySpeechRounds: 2,
  firstNightSeconds: 30,
  guardConsecutiveTargetPolicy: "deny",
  initialInspectionPolicy: "enabled",
  nightSeconds: 180,
  normalDaySpeechRounds: 1,
  roleCounts: {
    fox: 0,
    guard: 1,
    hunter: 0,
    madman: 1,
    spiritist: 0,
    seer: 1,
    villager: 3,
    werewolf: 2,
  },
  voteResultVisibility: "count_only",
  votingSeconds: 30,
};

export function normalizeRuleSet(input: RuleSetInput, playerCount: number): RuleSet {
  const options = normalizeRuleSetOptions(input);
  const roleCounts = Object.fromEntries(
    ROLE_IDS.map((roleId) => [roleId, input.roleCounts[roleId] ?? 0]),
  ) as RoleCounts;
  const specifiedCount = ROLE_IDS.reduce((total, roleId) => total + roleCounts[roleId], 0);

  if (specifiedCount === 0) {
    return {
      ...makeDefaultRuleSetForPlayers(playerCount),
      ...options,
    };
  }

  return {
    ...options,
    roleCounts,
  };
}

function normalizeRuleSetOptions(input: RuleSetInput): Omit<RuleSet, "roleCounts"> {
  return {
    dayMode: input.dayMode,
    dayReadyCheckSecondsPerPlayer: input.dayReadyCheckSecondsPerPlayer,
    daySpeechSeconds: input.daySpeechSeconds,
    executionLastWordsSeconds: input.executionLastWordsSeconds,
    firstDaySpeechRounds: input.firstDaySpeechRounds,
    firstNightSeconds: input.firstNightSeconds,
    guardConsecutiveTargetPolicy: input.guardConsecutiveTargetPolicy,
    initialInspectionPolicy: input.initialInspectionPolicy,
    nightSeconds: input.nightSeconds,
    normalDaySpeechRounds: input.normalDaySpeechRounds,
    voteResultVisibility: input.voteResultVisibility,
    votingSeconds: input.votingSeconds,
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
      hunter: 0,
      madman: madmanCount,
      spiritist: 0,
      seer: seerCount,
      villager: Math.max(playerCount - specialCount, 0),
      werewolf: werewolfCount,
    } satisfies RoleCounts,
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

  if (playerCount > 10) {
    errors.push("At most ten joined players are supported.");
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

  for (const [optionName, optionValue] of Object.entries(getPositiveIntegerOptions(ruleSet))) {
    if (!Number.isInteger(optionValue) || optionValue <= 0) {
      errors.push(`${optionName} must be a positive integer.`);
    }
  }

  if (ruleSet.initialInspectionPolicy === "enabled") {
    const humanInspectionCandidates = ROLE_IDS.filter(
      (roleId) => roleId !== "seer" && ROLE_DEFINITIONS[roleId].seenAs === "human",
    ).reduce((total, roleId) => total + ruleSet.roleCounts[roleId], 0);

    if (ruleSet.roleCounts["seer"] > 0 && humanInspectionCandidates <= 0) {
      errors.push("Initial inspection requires at least one non-seer human result candidate.");
    }
  }

  return errors.length === 0 ? { ok: true, ruleSet } : { errors, ok: false };
}

function getPositiveIntegerOptions(ruleSet: RuleSet): Readonly<Record<string, number>> {
  return {
    dayReadyCheckSecondsPerPlayer: ruleSet.dayReadyCheckSecondsPerPlayer,
    daySpeechSeconds: ruleSet.daySpeechSeconds,
    executionLastWordsSeconds: ruleSet.executionLastWordsSeconds,
    firstDaySpeechRounds: ruleSet.firstDaySpeechRounds,
    firstNightSeconds: ruleSet.firstNightSeconds,
    nightSeconds: ruleSet.nightSeconds,
    normalDaySpeechRounds: ruleSet.normalDaySpeechRounds,
    votingSeconds: ruleSet.votingSeconds,
  };
}

export function getRoleName(roleId: RoleId | null): string | null {
  if (roleId === null) {
    return null;
  }

  return isRoleId(roleId) ? ROLE_DEFINITIONS[roleId].name : roleId;
}

export function isRoleId(value: string): value is BuiltInRoleId {
  return (ROLE_IDS as readonly string[]).includes(value);
}
