export const MIN_ROOM_PLAYERS = 3;
export const MAX_ROOM_PLAYERS = 10;
export const DEFAULT_TARGET_PLAYER_COUNT = 6;

export type RoleId = string;

const OPAQUE_IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const ACTION_KEY_PATTERN = /^[a-z0-9][a-z0-9:_-]{0,127}$/;

export function isRoleId(value: unknown): value is RoleId {
  return typeof value === "string" && OPAQUE_IDENTIFIER_PATTERN.test(value);
}

export type Team = string;

export type PlayerResult = "win" | "lose" | "draw" | "special";

export type RoomStatus = "waiting" | "playing" | "ended";

export type PlayerStatus = "joined" | "disconnected" | "left";

export type GameStatus = "assigning_roles" | "playing" | "ended";

export type GamePhase = "night" | "day" | "voting" | "execution";

export type ActionKind = string;

export type LocalizedText = {
  en: string;
  ja: string;
};

export type ActionPresentationText = {
  label: string;
  submitLabel: string;
};

export type ActionPresentation = {
  en: ActionPresentationText;
  ja: ActionPresentationText;
};

export const DEFAULT_ACTION_PRESENTATION: ActionPresentation = {
  en: {
    label: "Choose an action",
    submitLabel: "Submit",
  },
  ja: {
    label: "アクションを選ぶ",
    submitLabel: "送信",
  },
};

export function isActionKind(value: unknown): value is ActionKind {
  return typeof value === "string" && OPAQUE_IDENTIFIER_PATTERN.test(value);
}

export function isActionKey(value: unknown): value is string {
  return typeof value === "string" && ACTION_KEY_PATTERN.test(value);
}

export function isEventKind(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_IDENTIFIER_PATTERN.test(value);
}

export type DeathReason = string;

export type GameEventVisibility = "public" | "private" | "internal";

export type RoomSummary = {
  code: string;
  snapshotRevision: number;
  status: RoomStatus;
  waitingExpiresAt: string;
  targetPlayerCount: number;
  hostPlayerId: string | null;
  currentPlayerId: string | null;
  isHost: boolean;
  players: PublicPlayer[];
  defaultRoleCounts: RoleCounts;
  roleCatalog: RoleCatalogItem[];
  teamCatalog: TeamCatalogItem[];
  game: PublicGameView | null;
  self: SelfPrivateView | null;
  rolePrivate: RolePrivateView | null;
};

export type CurrentRoomResponse = {
  room: RoomSummary | null;
};

export type SwitchRoomRequest =
  | {
      kind: "create";
      expectedCurrentRoomCode: string;
      displayName: string;
      targetPlayerCount: number;
    }
  | {
      kind: "join";
      expectedCurrentRoomCode: string;
      targetRoomCode: string;
      displayName: string;
    };

export type PublicPlayer = {
  id: string;
  displayName: string;
  status: PlayerStatus;
  alive: boolean | null;
  isHost: boolean;
  isCurrent: boolean;
  revealedRoleId: RoleId | null;
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
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  presentation: EventPresentation | null;
  createdAt: string;
};

export type PublicActionProgressKind =
  | "current_speech_turn"
  | "day_ready"
  | "execution_last_words"
  | "first_night_ready"
  | "night_actions_hidden"
  | "role_actions"
  | "votes_submitted";

export type PublicActionProgress =
  | {
      kind: Exclude<PublicActionProgressKind, "night_actions_hidden">;
      visibility: "public";
      required: number;
      submitted: number;
    }
  | {
      kind: "night_actions_hidden";
      visibility: "hidden";
    };

export type PublicActionStatus = "open" | "submitted";

export type ActionSubmissionReceipt = {
  id: string;
  actionKey: string;
  kind: ActionKind;
  phaseInstanceId: string;
  submittedAt: string;
};

export type SelfPrivateView = {
  actionReceipts: ActionSubmissionReceipt[];
  playerId: string;
  roleId: RoleId | null;
  actions: PublicAction[];
  events: PrivateGameEvent[];
  result: PlayerResult | null;
};

export type PrivateGameEvent = {
  kind: string;
  presentation: EventPresentation;
  createdAt: string;
};

export type EventPresentation = {
  details: readonly EventPresentationDetail[];
  message: LocalizedText;
  title: LocalizedText;
};

export type EventPresentationDetail = {
  label: LocalizedText;
  value: LocalizedText;
};

export type RolePrivateView = {
  nightConversation: NightConversationView | null;
} | null;

export type NightConversationView = {
  canSend: boolean;
  groupId: string;
  label: LocalizedText;
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
  presentation: ActionPresentation;
  phaseInstanceId: string;
  status: PublicActionStatus;
  targetKind: "none" | "single_player";
  eligibleTargetIds: string[];
  closesAt: string | null;
};

export type RealtimeScope = "player_private" | "role_private" | "room";

export type RealtimeSubscription = {
  scope: RealtimeScope;
  topic: string;
};

export type RealtimeAuthorization = {
  accessToken: string;
  expiresAt: string;
  subscriptions: RealtimeSubscription[];
};

export type RuleSetInput = {
  roleCounts: Partial<Record<RoleId, number>>;
  roleOptions: RoleOptionValues;
  dayMode: "ready_check" | "ordered_speech";
  dayReadyCheckSecondsPerPlayer: number;
  daySpeechSeconds: number;
  executionLastWordsSeconds: number;
  firstDaySpeechRounds: number;
  firstNightSeconds: number;
  nightSeconds: number;
  normalDaySpeechRounds: number;
  voteResultVisibility: "count_only" | "voter_to_target";
  votingSeconds: number;
};

export type RoleCounts = Partial<Record<RoleId, number>>;

export type RuleSet = {
  roleCounts: RoleCounts;
  roleOptions: RoleOptionValues;
  dayMode: "ready_check" | "ordered_speech";
  dayReadyCheckSecondsPerPlayer: number;
  daySpeechSeconds: number;
  executionLastWordsSeconds: number;
  firstDaySpeechRounds: number;
  firstNightSeconds: number;
  nightSeconds: number;
  normalDaySpeechRounds: number;
  voteResultVisibility: "count_only" | "voter_to_target";
  votingSeconds: number;
};

export type RuleSetOptions = Omit<RuleSet, "roleCounts">;

export type RoleOptionValues = Partial<Record<RoleId, Readonly<Record<string, string>>>>;

export type RolePresentationText = {
  description: string;
  name: string;
  shortLabel: string;
};

export type RolePresentation = {
  en: RolePresentationText;
  ja: RolePresentationText;
};

export type RoleCatalogItem = {
  id: RoleId;
  maxCount: number | null;
  minCount: number;
  order: number;
  presentation: RolePresentation;
  specificOptions: readonly RoleSpecificOptionItem[];
};

export type TeamCatalogItem = {
  id: Team;
  presentation: LocalizedText;
};

export type RoleSpecificOptionItem = {
  choices: readonly RoleSpecificOptionChoice[];
  defaultValue: string;
  key: string;
  label: LocalizedText;
};

export type RoleSpecificOptionChoice = {
  label: LocalizedText;
  value: string;
};

export const DEFAULT_RULE_SET_OPTIONS: RuleSetOptions = {
  dayMode: "ready_check",
  dayReadyCheckSecondsPerPlayer: 90,
  daySpeechSeconds: 90,
  executionLastWordsSeconds: 60,
  firstDaySpeechRounds: 2,
  firstNightSeconds: 30,
  nightSeconds: 180,
  normalDaySpeechRounds: 1,
  roleOptions: {},
  voteResultVisibility: "count_only",
  votingSeconds: 30,
};
