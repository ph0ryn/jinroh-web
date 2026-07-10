export const MIN_ROOM_PLAYERS = 3;
export const MAX_ROOM_PLAYERS = 10;
export const DEFAULT_TARGET_PLAYER_COUNT = 6;

export type RoleId = string;

export type Team = string;

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
  snapshotRevision: number;
  status: RoomStatus;
  lobbyExpiresAt: string;
  targetPlayerCount: number;
  hostPlayerId: string | null;
  currentPlayerId: string | null;
  isHost: boolean;
  players: PublicPlayer[];
  defaultRoleCounts: RoleCounts;
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
  phaseFocus: PublicPhaseFocus | null;
  events: PublicGameEvent[];
};

export type PublicPhaseFocus =
  | {
      kind: "current_speaker";
      playerId: string;
    }
  | {
      kind: "execution_candidate";
      playerId: string;
    };

export type PublicGameEvent = {
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type PublicActionProgressKind =
  | "current_speech_turn"
  | "day_ready"
  | "execution_last_words"
  | "first_night_ready"
  | "night_actions_hidden"
  | "votes_submitted";

export type PublicActionProgress =
  | {
      kind: Exclude<PublicActionProgressKind, "night_actions_hidden">;
      visibility: "public";
      required: number;
      submitted: number;
      label: string;
    }
  | {
      kind: "night_actions_hidden";
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
  payload: Record<string, unknown>;
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
  labelKey: string;
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

export type RoleCounts = Partial<Record<RoleId, number>>;

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

export type RuleSetOptions = Omit<RuleSet, "roleCounts">;

export type RoleCatalogItem = {
  description: string;
  id: RoleId;
  maxCount: number | null;
  minCount: number;
  name: string;
  order: number;
  shortLabel: string;
  specificOptions: readonly RoleSpecificOptionItem[];
  team: Team;
};

export type RoleSpecificOptionItem = {
  key: string;
  label: string;
  roleId: RoleId;
};

export const DEFAULT_RULE_SET_OPTIONS: RuleSetOptions = {
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
  voteResultVisibility: "count_only",
  votingSeconds: 30,
};
