"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { getSupabaseRealtimeClient } from "@/lib/client/supabaseRealtime";
import {
  DEFAULT_TARGET_PLAYER_COUNT,
  DEFAULT_RULE_SET,
  MAX_ROOM_PLAYERS,
  MIN_ROOM_PLAYERS,
  makeDefaultRuleSetForPlayers,
  ROLE_DEFINITIONS,
  type NightConversationView,
  type PublicAction,
  type PublicPlayer,
  type RealtimeSubscription,
  type RoleId,
  type RoomSummary,
  type RuleSetInput,
} from "@/lib/shared/game";

import type { CSSProperties, ReactNode } from "react";

type IdentityResponse = {
  token: string;
};

type ApiErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

type RequestOptions = {
  body?: unknown;
  method?: "GET" | "POST";
  token?: string;
};

type RememberRoomOptions = {
  readonly resetActionTargets?: boolean;
};

type RealtimeInvalidationPayload = {
  readonly reason: string;
  readonly roomCode: string;
  readonly scope: "player_private" | "role_private" | "room";
  readonly sentAt: string;
};

type RealtimeBroadcastEnvelope = {
  readonly payload?: unknown;
};

type RealtimeSubscriptionSnapshot = Pick<RealtimeSubscription, "scope" | "topic">;

type StartRuleSetSettings = RuleSetInput;

type DevLiveFixture = {
  readonly id: string;
  readonly label: string;
  readonly summary: RoomSummary;
};

type LivePageProps = {
  readonly devFixtures?: readonly DevLiveFixture[];
  readonly devInitialFixtureId?: string;
};

type LiveMood = "closed" | "day" | "execution" | "lobby" | "night" | "result" | "setup" | "voting";

type LiveSeatState = "eliminated" | "observing" | "pending" | "ready" | "speaking" | "voted";

type RoundTableSeatPosition = {
  readonly x: number;
  readonly y: number;
};

type LiveGuidance = {
  readonly label: string;
  readonly message: string;
};

type LivePlaySurfaceProps = {
  readonly canAdvancePhase: boolean;
  readonly controlHint: string;
  readonly isBusy: boolean;
  readonly isNightConversationOpen: boolean;
  readonly isPublicLogOpen: boolean;
  readonly nightConversationDraft: string;
  readonly roomStatusLabel: string;
  readonly selfActions: readonly PublicAction[];
  readonly statusMessage: string;
  readonly summary: RoomSummary;
  readonly targetByActionKey: Record<string, string>;
  readonly onAdvancePhase: () => void;
  readonly onCloseNightConversation: () => void;
  readonly onClosePublicLog: () => void;
  readonly onNightConversationDraftChange: (value: string) => void;
  readonly onOpenNightConversation: () => void;
  readonly onOpenPublicLog: () => void;
  readonly onSendNightConversation: (conversation: NightConversationView) => void;
  readonly onSubmitAction: (action: PublicAction) => void;
  readonly onTargetChange: (actionKey: string, playerId: string) => void;
};

type LiveSetupSurfaceProps = {
  readonly displayName: string;
  readonly isBusy: boolean;
  readonly roomCodeInput: string;
  readonly statusMessage: string;
  readonly targetPlayerCount: number;
  readonly onCreateRoom: () => void;
  readonly onDisplayNameChange: (displayName: string) => void;
  readonly onJoinRoom: () => void;
  readonly onRoomCodeChange: (roomCode: string) => void;
  readonly onTargetPlayerCountChange: (targetPlayerCount: number) => void;
};

type RuleSetNumberField =
  | "dayReadyCheckSecondsPerPlayer"
  | "daySpeechSeconds"
  | "executionLastWordsSeconds"
  | "firstDaySpeechRounds"
  | "firstNightSeconds"
  | "nightSeconds"
  | "normalDaySpeechRounds"
  | "votingSeconds";

type RuleSetNumberLimit = {
  readonly max: number;
  readonly min: number;
};

type StartSettingsTab = "general" | "roles" | "timers";

const IDENTITY_STORAGE_KEY = "jinrohWeb.identityToken";
const DISPLAY_NAME_STORAGE_KEY = "jinrohWeb.displayName";
const ROOM_CODE_STORAGE_KEY = "jinrohWeb.roomCode";
const HEARTBEAT_INTERVAL_MS = 20_000;
const ROOM_SYNC_INTERVAL_MS = 4_000;
const PLAYER_COUNT_OPTIONS = Array.from(
  { length: MAX_ROOM_PLAYERS - MIN_ROOM_PLAYERS + 1 },
  (unusedValue, index) => {
    void unusedValue;

    return MIN_ROOM_PLAYERS + index;
  },
);
const LIVE_MOOD_BACKGROUND_SOURCES = [
  "/images/jinroh-lobby-same-angle.jpg",
  "/images/jinroh-day-same-angle.jpg",
  "/images/jinroh-voting-same-angle.jpg",
  "/images/jinroh-night.jpg",
  "/images/jinroh-result-same-angle.jpg",
] as const;

const DEFAULT_START_RULE_SET_SETTINGS: StartRuleSetSettings = {
  dayMode: DEFAULT_RULE_SET.dayMode,
  dayReadyCheckSecondsPerPlayer: DEFAULT_RULE_SET.dayReadyCheckSecondsPerPlayer,
  daySpeechSeconds: DEFAULT_RULE_SET.daySpeechSeconds,
  executionLastWordsSeconds: DEFAULT_RULE_SET.executionLastWordsSeconds,
  firstDaySpeechRounds: DEFAULT_RULE_SET.firstDaySpeechRounds,
  firstNightSeconds: DEFAULT_RULE_SET.firstNightSeconds,
  guardConsecutiveTargetPolicy: DEFAULT_RULE_SET.guardConsecutiveTargetPolicy,
  initialInspectionPolicy: DEFAULT_RULE_SET.initialInspectionPolicy,
  nightSeconds: DEFAULT_RULE_SET.nightSeconds,
  normalDaySpeechRounds: DEFAULT_RULE_SET.normalDaySpeechRounds,
  roleCounts: {},
  voteResultVisibility: DEFAULT_RULE_SET.voteResultVisibility,
  votingSeconds: DEFAULT_RULE_SET.votingSeconds,
};

const RULE_SET_NUMBER_LIMITS: Record<RuleSetNumberField, RuleSetNumberLimit> = {
  dayReadyCheckSecondsPerPlayer: { max: 300, min: 1 },
  daySpeechSeconds: { max: 300, min: 1 },
  executionLastWordsSeconds: { max: 300, min: 1 },
  firstDaySpeechRounds: { max: 5, min: 1 },
  firstNightSeconds: { max: 300, min: 1 },
  nightSeconds: { max: 600, min: 1 },
  normalDaySpeechRounds: { max: 5, min: 1 },
  votingSeconds: { max: 300, min: 1 },
};

const START_SETTINGS_TABS: readonly {
  readonly id: StartSettingsTab;
  readonly label: string;
}[] = [
  { id: "general", label: "General" },
  { id: "timers", label: "Timers" },
  { id: "roles", label: "Roles" },
];

const START_SETTINGS_ROLE_ORDER = [
  "werewolf",
  "madman",
  "seer",
  "guard",
  "fox",
  "villager",
] as const;

const ROLE_META: Record<
  (typeof START_SETTINGS_ROLE_ORDER)[number],
  {
    readonly description: string;
    readonly shortLabel: string;
  }
> = {
  fox: {
    description: "Independent role. Max one.",
    shortLabel: "F",
  },
  guard: {
    description: "Protects one player at night when active.",
    shortLabel: "G",
  },
  madman: {
    description: "Wins with werewolves, seen as human.",
    shortLabel: "M",
  },
  seer: {
    description: "Inspects one player at night.",
    shortLabel: "Se",
  },
  villager: {
    description: "No special night action.",
    shortLabel: "V",
  },
  werewolf: {
    description: "Night attack role.",
    shortLabel: "W",
  },
};

export default function LivePage({ devFixtures = [], devInitialFixtureId }: LivePageProps = {}) {
  const isDevMode = devFixtures.length > 0;
  const initialDevFixture = getDevFixture(devFixtures, devInitialFixtureId);
  const [identityToken, setIdentityToken] = useState<string | null>(() =>
    isDevMode ? "dev-token" : null,
  );
  const [displayName, setDisplayName] = useState(
    () =>
      initialDevFixture?.summary.players.find((player) => player.isCurrent)?.displayName ?? "Sora",
  );
  const [roomCodeInput, setRoomCodeInput] = useState(() => initialDevFixture?.summary.code ?? "");
  const [targetPlayerCount, setTargetPlayerCount] = useState(DEFAULT_TARGET_PLAYER_COUNT);
  const [savedRoomCode, setSavedRoomCode] = useState<string | null>(
    () => initialDevFixture?.summary.code ?? null,
  );
  const [roomSummary, setRoomSummary] = useState<RoomSummary | null>(
    () => initialDevFixture?.summary ?? null,
  );
  const [activeDevFixtureId, setActiveDevFixtureId] = useState<string | null>(
    () => initialDevFixture?.id ?? null,
  );
  const [startRuleSetSettings, setStartRuleSetSettings] = useState<StartRuleSetSettings>(
    DEFAULT_START_RULE_SET_SETTINGS,
  );
  const [isStartSettingsOpen, setIsStartSettingsOpen] = useState(false);
  const [isNightConversationOpen, setIsNightConversationOpen] = useState(false);
  const [isPublicLogOpen, setIsPublicLogOpen] = useState(false);
  const [nightConversationDraft, setNightConversationDraft] = useState("");
  const [copiedInviteRoomCode, setCopiedInviteRoomCode] = useState<string | null>(null);
  const copiedInviteResetTimerRef = useRef<number | null>(null);
  const ignoredRoomCodeRef = useRef<string | null>(null);
  const [targetByActionKey, setTargetByActionKey] = useState<Record<string, string>>({});
  const [statusMessage, setStatusMessage] = useState(
    "Your browser identity stays local and can rejoin the room.",
  );
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    if (isDevMode) {
      return;
    }

    const timerId = window.setTimeout(() => {
      const savedIdentityToken = readStorage(IDENTITY_STORAGE_KEY);
      const savedDisplayName = readStorage(DISPLAY_NAME_STORAGE_KEY);
      const savedRoomCode = readStorage(ROOM_CODE_STORAGE_KEY);

      if (savedIdentityToken !== null) {
        setIdentityToken(savedIdentityToken);
      }

      if (savedDisplayName !== null) {
        setDisplayName(savedDisplayName);
      }

      if (savedRoomCode !== null) {
        setSavedRoomCode(savedRoomCode);
        setRoomCodeInput(savedRoomCode);
      }
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [isDevMode]);

  useEffect(() => {
    const preloadedImages: HTMLImageElement[] = [];
    const timerId = window.setTimeout(() => {
      for (const source of LIVE_MOOD_BACKGROUND_SOURCES) {
        const image = new window.Image();

        image.decoding = "async";
        image.src = source;
        preloadedImages.push(image);
      }
    }, 600);

    return () => {
      window.clearTimeout(timerId);
      preloadedImages.length = 0;
    };
  }, []);

  useEffect(
    () => () => {
      if (copiedInviteResetTimerRef.current !== null) {
        window.clearTimeout(copiedInviteResetTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!isStartSettingsOpen) {
      return;
    }

    function handleSettingsKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setIsStartSettingsOpen(false);
      }
    }

    const previousBodyOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleSettingsKeyDown);

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      window.removeEventListener("keydown", handleSettingsKeyDown);
    };
  }, [isStartSettingsOpen]);

  async function withBusy(work: () => Promise<void>): Promise<void> {
    setIsBusy(true);

    try {
      await work();
    } catch (error) {
      setStatusMessage(toRequestFailureMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function ensureIdentityToken(): Promise<string> {
    if (identityToken !== null) {
      return identityToken;
    }

    const identity = await apiFetch<IdentityResponse>("/api/identity", { method: "POST" });

    writeStorage(IDENTITY_STORAGE_KEY, identity.token);
    setIdentityToken(identity.token);
    setStatusMessage("This browser is ready to join a table.");

    return identity.token;
  }

  const rememberRoom = useCallback(
    (nextSummary: RoomSummary, options: RememberRoomOptions = {}) => {
      if (ignoredRoomCodeRef.current === nextSummary.code) {
        return;
      }

      writeStorage(DISPLAY_NAME_STORAGE_KEY, displayName);
      writeStorage(ROOM_CODE_STORAGE_KEY, nextSummary.code);
      setSavedRoomCode(nextSummary.code);
      setRoomCodeInput(nextSummary.code);
      setRoomSummary(nextSummary);

      if (options.resetActionTargets ?? true) {
        setTargetByActionKey({});
      }
    },
    [displayName],
  );

  useEffect(() => {
    if (isDevMode) {
      return;
    }

    if (identityToken === null && savedRoomCode !== null) {
      removeStorage(ROOM_CODE_STORAGE_KEY);
      setSavedRoomCode(null);
      setRoomCodeInput("");
      setStatusMessage("Saved room expired. Create or join a room.");
    }
  }, [identityToken, isDevMode, savedRoomCode]);

  useEffect(() => {
    if (isDevMode) {
      return;
    }

    if (identityToken === null || roomSummary !== null || savedRoomCode === null) {
      return;
    }

    if (ignoredRoomCodeRef.current === savedRoomCode) {
      return;
    }

    let isCancelled = false;
    const activeToken = identityToken;

    setStatusMessage(`Restoring room ${savedRoomCode}.`);

    async function restoreSavedRoom(): Promise<void> {
      try {
        const summary = await apiFetch<RoomSummary>(`/api/rooms/${savedRoomCode}`, {
          method: "GET",
          token: activeToken,
        });

        if (!isCancelled) {
          rememberRoom(summary, { resetActionTargets: false });
          setStatusMessage(`Room ${summary.code} restored.`);
        }
      } catch {
        if (!isCancelled) {
          removeStorage(ROOM_CODE_STORAGE_KEY);
          setSavedRoomCode(null);
          setRoomCodeInput("");
          setStatusMessage("Saved room could not be restored. Create or join a room.");
        }
      }
    }

    void restoreSavedRoom();

    return () => {
      isCancelled = true;
    };
  }, [identityToken, isDevMode, rememberRoom, roomSummary, savedRoomCode]);

  const activeRoomCode = roomSummary?.code ?? null;
  const activePhaseEndsAt = roomSummary?.game?.phaseEndsAt ?? null;
  const activePhaseInstanceId = roomSummary?.game?.phaseInstanceId ?? null;
  const activeRealtimeSubscriptionKey = toRealtimeSubscriptionKey(roomSummary?.realtime ?? null);
  const isHostInPlayingRoom =
    roomSummary?.isHost === true &&
    roomSummary.status === "playing" &&
    roomSummary.game?.status === "playing";

  useEffect(() => {
    if (isDevMode) {
      return;
    }

    if (identityToken === null || activeRoomCode === null) {
      return;
    }

    let isCancelled = false;
    const activeToken = identityToken;

    async function syncRoom(): Promise<void> {
      try {
        const summary = await apiFetch<RoomSummary>(`/api/rooms/${activeRoomCode}`, {
          method: "GET",
          token: activeToken,
        });

        if (!isCancelled) {
          rememberRoom(summary, { resetActionTargets: false });
        }
      } catch {
        if (!isCancelled) {
          setStatusMessage("Room sync failed. Use Refresh if the table looks stale.");
        }
      }
    }

    const intervalId = window.setInterval(() => {
      void syncRoom();
    }, ROOM_SYNC_INTERVAL_MS);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeRoomCode, identityToken, isDevMode, rememberRoom]);

  useEffect(() => {
    if (isDevMode) {
      return;
    }

    if (
      identityToken === null ||
      activeRoomCode === null ||
      roomSummary?.currentPlayerId === null
    ) {
      return;
    }

    let isCancelled = false;
    const activeToken = identityToken;

    async function heartbeatRoom(): Promise<void> {
      try {
        const summary = await apiFetch<RoomSummary>(`/api/rooms/${activeRoomCode}/heartbeat`, {
          method: "POST",
          token: activeToken,
        });

        if (!isCancelled) {
          rememberRoom(summary, { resetActionTargets: false });
        }
      } catch {
        // Heartbeat is presence maintenance; explicit room actions surface request errors.
      }
    }

    void heartbeatRoom();

    const intervalId = window.setInterval(() => {
      void heartbeatRoom();
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeRoomCode, identityToken, isDevMode, rememberRoom, roomSummary?.currentPlayerId]);

  useEffect(() => {
    if (isDevMode) {
      return;
    }

    if (
      identityToken === null ||
      activeRoomCode === null ||
      activeRealtimeSubscriptionKey === "[]"
    ) {
      return;
    }

    const realtimeClient = getSupabaseRealtimeClient();

    if (realtimeClient === null) {
      return;
    }

    const subscriptions = parseRealtimeSubscriptionKey(activeRealtimeSubscriptionKey);

    if (subscriptions.length === 0) {
      return;
    }

    let isCancelled = false;
    let isSyncing = false;
    const activeToken = identityToken;

    async function syncRoomFromRealtime(): Promise<void> {
      if (isSyncing) {
        return;
      }

      isSyncing = true;

      try {
        const summary = await apiFetch<RoomSummary>(`/api/rooms/${activeRoomCode}`, {
          method: "GET",
          token: activeToken,
        });

        if (!isCancelled) {
          rememberRoom(summary, { resetActionTargets: false });
        }
      } catch {
        if (!isCancelled) {
          setStatusMessage("Realtime update failed. Polling is still active.");
        }
      } finally {
        isSyncing = false;
      }
    }

    const channels = subscriptions.map((subscription) =>
      realtimeClient
        .channel(subscription.topic, { config: { broadcast: { self: false } } })
        .on("broadcast", { event: "room_changed" }, (message: RealtimeBroadcastEnvelope) => {
          if (!isRealtimeInvalidationPayload(message.payload, activeRoomCode)) {
            return;
          }

          void syncRoomFromRealtime();
        })
        .subscribe(),
    );

    return () => {
      isCancelled = true;
      for (const channel of channels) {
        void realtimeClient.removeChannel(channel);
      }
    };
  }, [activeRealtimeSubscriptionKey, activeRoomCode, identityToken, isDevMode, rememberRoom]);

  useEffect(() => {
    if (isDevMode) {
      return;
    }

    if (identityToken === null || activeRoomCode === null || activePhaseEndsAt === null) {
      return;
    }

    if (!isHostInPlayingRoom) {
      return;
    }

    let isCancelled = false;
    const activeToken = identityToken;
    const delayMs = Math.max(Date.parse(activePhaseEndsAt) - Date.now() + 600, 0);
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          const summary = await apiFetch<RoomSummary>(`/api/rooms/${activeRoomCode}/resolve`, {
            method: "POST",
            token: activeToken,
          });

          if (!isCancelled) {
            rememberRoom(summary, { resetActionTargets: false });
            setStatusMessage("Phase timer elapsed; the room checked whether it can advance.");
          }
        } catch {
          if (!isCancelled) {
            setStatusMessage("Phase timer elapsed, but the room could not advance yet.");
          }
        }
      })();
    }, delayMs);

    return () => {
      isCancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    activePhaseEndsAt,
    activePhaseInstanceId,
    activeRoomCode,
    identityToken,
    isDevMode,
    isHostInPlayingRoom,
    rememberRoom,
  ]);

  function handleDisplayNameChange(nextDisplayName: string): void {
    setDisplayName(nextDisplayName);
    writeStorage(DISPLAY_NAME_STORAGE_KEY, nextDisplayName);
  }

  function handleRoomCodeChange(nextRoomCode: string): void {
    const normalizedRoomCode = nextRoomCode.replace(/\D/g, "").slice(0, 6);

    setRoomCodeInput(normalizedRoomCode);
  }

  function handleTargetPlayerCountChange(nextTargetPlayerCount: number): void {
    if (
      Number.isInteger(nextTargetPlayerCount) &&
      nextTargetPlayerCount >= MIN_ROOM_PLAYERS &&
      nextTargetPlayerCount <= MAX_ROOM_PLAYERS
    ) {
      setTargetPlayerCount(nextTargetPlayerCount);
    }
  }

  function handleDevFixtureChange(fixture: DevLiveFixture): void {
    setActiveDevFixtureId(fixture.id);
    setSavedRoomCode(fixture.summary.code);
    setRoomCodeInput(fixture.summary.code);
    setRoomSummary(fixture.summary);
    setTargetByActionKey({});
    setIsNightConversationOpen(false);
    setIsPublicLogOpen(false);
    setNightConversationDraft("");
    setIsStartSettingsOpen(false);
    setStatusMessage(`Loaded ${fixture.label} dev fixture. No API calls will be made.`);
  }

  function handleCreateRoom(): void {
    if (isDevMode) {
      const fixture = getDevFixture(devFixtures, "night") ?? devFixtures[0];

      if (fixture !== undefined) {
        handleDevFixtureChange(fixture);
      }

      return;
    }

    void withBusy(async () => {
      if (roomSummary !== null || savedRoomCode !== null) {
        setStatusMessage("Leave the current room before creating another room.");
        return;
      }

      const token = await ensureIdentityToken();
      const summary = await apiFetch<RoomSummary>("/api/rooms", {
        body: { displayName, targetPlayerCount },
        method: "POST",
        token,
      });

      ignoredRoomCodeRef.current = null;
      rememberRoom(summary);
      setStatusMessage(`Room ${summary.code} created. Share the code with players.`);
    });
  }

  function handleJoinRoom(): void {
    if (isDevMode) {
      const fixture = getDevFixture(devFixtures, activeDevFixtureId) ?? devFixtures[0];

      if (fixture !== undefined) {
        handleDevFixtureChange(fixture);
      }

      return;
    }

    void withBusy(async () => {
      if (roomSummary !== null || savedRoomCode !== null) {
        setStatusMessage("Leave the current room before joining another room.");
        return;
      }

      const roomCode = requireRoomCode(roomCodeInput);
      const token = await ensureIdentityToken();
      const summary = await apiFetch<RoomSummary>(`/api/rooms/${roomCode}/join`, {
        body: { displayName },
        method: "POST",
        token,
      });

      ignoredRoomCodeRef.current = null;
      rememberRoom(summary);
      setStatusMessage(`Joined room ${summary.code}.`);
    });
  }

  function handleRefreshRoom(): void {
    if (isDevMode) {
      const fixture = getDevFixture(devFixtures, activeDevFixtureId) ?? devFixtures[0];

      if (fixture !== undefined) {
        handleDevFixtureChange(fixture);
        setStatusMessage(`Dev fixture reset to ${fixture.label}.`);
      }

      return;
    }

    void withBusy(async () => {
      const token = await ensureIdentityToken();
      const roomCode = requireRoomCode(roomSummary?.code ?? roomCodeInput);
      const summary = await apiFetch<RoomSummary>(`/api/rooms/${roomCode}`, {
        method: "GET",
        token,
      });

      rememberRoom(summary);
      setStatusMessage(`Room ${summary.code} synced.`);
    });
  }

  function handleStartGame(): void {
    if (isDevMode) {
      const fixture = getDevFixture(devFixtures, "night") ?? devFixtures[0];

      if (fixture !== undefined) {
        handleDevFixtureChange(fixture);
      }

      return;
    }

    void withBusy(async () => {
      const token = await ensureIdentityToken();
      const roomCode = requireRoomCode(roomSummary?.code ?? roomCodeInput);
      const summary = await apiFetch<RoomSummary>(`/api/rooms/${roomCode}/start`, {
        body: { ruleSet: buildStartRuleSetInput(startRuleSetSettings) },
        method: "POST",
        token,
      });

      rememberRoom(summary);
      setStatusMessage("Game started. Each player can check their private action card.");
    });
  }

  function handleResolvePhase(): void {
    if (isDevMode) {
      const nextFixture = getNextDevFixture(devFixtures, activeDevFixtureId);

      if (nextFixture !== null) {
        handleDevFixtureChange(nextFixture);
      }

      return;
    }

    void withBusy(async () => {
      const token = await ensureIdentityToken();
      const roomCode = requireRoomCode(roomSummary?.code ?? roomCodeInput);
      const previousStatus = formatRoomStatus(roomSummary);
      const summary = await apiFetch<RoomSummary>(`/api/rooms/${roomCode}/resolve`, {
        method: "POST",
        token,
      });
      const nextStatus = formatRoomStatus(summary);

      rememberRoom(summary);
      setStatusMessage(
        previousStatus === nextStatus
          ? "Still waiting for pending actions or the phase timer."
          : `Advanced to ${nextStatus}.`,
      );
    });
  }

  function handleLeaveRoom(): void {
    if (isDevMode) {
      setSavedRoomCode(null);
      setRoomSummary(null);
      setRoomCodeInput("");
      setTargetByActionKey({});
      setIsNightConversationOpen(false);
      setIsPublicLogOpen(false);
      setNightConversationDraft("");
      setIsStartSettingsOpen(false);
      setStatusMessage("Dev fixture cleared. Use the dev toolbar to load a phase.");
      return;
    }

    void withBusy(async () => {
      const token = await ensureIdentityToken();
      const roomCode = requireRoomCode(roomSummary?.code ?? roomCodeInput);
      await apiFetch<RoomSummary>(`/api/rooms/${roomCode}/leave`, {
        method: "POST",
        token,
      });

      ignoredRoomCodeRef.current = roomCode;
      removeStorage(ROOM_CODE_STORAGE_KEY);
      setSavedRoomCode(null);
      setRoomSummary(null);
      setRoomCodeInput("");
      setTargetByActionKey({});
      setIsNightConversationOpen(false);
      setIsPublicLogOpen(false);
      setNightConversationDraft("");
      setIsStartSettingsOpen(false);
      setStatusMessage("Left the room.");
    });
  }

  function handleSubmitAction(action: PublicAction): void {
    if (isDevMode) {
      setRoomSummary((currentSummary) => markDevActionSubmitted(currentSummary, action));
      setStatusMessage(`${action.label} submitted in the local dev fixture.`);
      return;
    }

    void withBusy(async () => {
      const token = await ensureIdentityToken();
      const roomCode = requireRoomCode(roomSummary?.code ?? roomCodeInput);
      const expectedRevision = roomSummary?.game?.revision;
      const targetPlayerId = action.targetKind === "single_player" ? getActionTarget(action) : null;

      if (expectedRevision === undefined) {
        throw new Error("Action window is not open.");
      }

      const summary = await apiFetch<RoomSummary>(`/api/rooms/${roomCode}/action`, {
        body: {
          actionKey: action.key,
          phaseInstanceId: action.phaseInstanceId,
          revision: expectedRevision,
          targetPlayerId,
        },
        method: "POST",
        token,
      });

      rememberRoom(summary);
      setStatusMessage(`${action.label} submitted. Waiting for the table to catch up.`);
    });
  }

  function handleSendNightConversation(conversation: NightConversationView): void {
    if (isDevMode) {
      setRoomSummary((currentSummary) =>
        appendDevNightConversationMessage(currentSummary, conversation, nightConversationDraft),
      );
      setNightConversationDraft("");
      setStatusMessage(`${conversation.label} message added to the dev fixture.`);
      return;
    }

    void withBusy(async () => {
      const token = await ensureIdentityToken();
      const roomCode = requireRoomCode(roomSummary?.code ?? roomCodeInput);
      const phaseInstanceId = roomSummary?.game?.phaseInstanceId;

      if (phaseInstanceId === null || phaseInstanceId === undefined) {
        throw new Error("Night chat is not open.");
      }

      const summary = await apiFetch<RoomSummary>(`/api/rooms/${roomCode}/night-conversation`, {
        body: {
          body: nightConversationDraft,
          conversationGroupId: conversation.groupId,
          nightNumber: conversation.nightNumber,
          phaseInstanceId,
        },
        method: "POST",
        token,
      });

      setNightConversationDraft("");
      rememberRoom(summary, { resetActionTargets: false });
      setStatusMessage(`${conversation.label} message sent.`);
    });
  }

  async function handleCopyRoomCode(roomCode: string): Promise<void> {
    const didCopy = await writeClipboardText(roomCode);

    if (didCopy) {
      if (copiedInviteResetTimerRef.current !== null) {
        window.clearTimeout(copiedInviteResetTimerRef.current);
      }

      setCopiedInviteRoomCode(roomCode);
      setStatusMessage(`Room code ${roomCode} copied.`);
      copiedInviteResetTimerRef.current = window.setTimeout(() => {
        setCopiedInviteRoomCode((currentRoomCode) =>
          currentRoomCode === roomCode ? null : currentRoomCode,
        );
        copiedInviteResetTimerRef.current = null;
      }, 1_600);
      return;
    }

    setRoomCodeInput(roomCode);
    setStatusMessage(`Copy is unavailable. Use room code ${roomCode}.`);
  }

  async function handleShareRoom(roomCode: string): Promise<void> {
    const roomUrl = getLiveRoomUrl();
    const inviteText = `Jinroh Web room ${roomCode}\nOpen ${roomUrl} and join with this code.`;

    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          text: `Join Jinroh Web room ${roomCode}.`,
          title: "Jinroh Web",
          url: roomUrl,
        });
        setStatusMessage(`Share sheet opened for room ${roomCode}.`);
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          setStatusMessage("Share cancelled.");
          return;
        }
      }
    }

    const didCopy = await writeClipboardText(inviteText);

    if (didCopy) {
      setStatusMessage(`Invite text copied for room ${roomCode}.`);
      return;
    }

    setRoomCodeInput(roomCode);
    setStatusMessage(`Share is unavailable. Use room code ${roomCode}.`);
  }

  function getActionTarget(action: PublicAction): string {
    return targetByActionKey[action.key] ?? action.eligibleTargetIds[0] ?? "";
  }

  const selfActions = roomSummary?.self?.actions ?? [];
  const roomStatusLabel = formatRoomStatus(roomSummary);
  const liveGuidance = getLiveGuidance(roomSummary, selfActions.length, isBusy);
  const canStartGame = !isBusy && canStartRoom(roomSummary);
  const canConfigureStartSettings = roomSummary?.isHost === true && roomSummary.status === "lobby";
  const isGameSurface = roomSummary !== null && roomSummary.status !== "lobby";
  const canAdvancePhase =
    !isBusy &&
    roomSummary?.isHost === true &&
    roomSummary.status === "playing" &&
    roomSummary.game?.status === "playing";
  const controlHint = getControlHint(roomSummary, isBusy);
  const liveMood = getLiveMood(roomSummary);
  const isRoomEntryAvailable = roomSummary === null && savedRoomCode === null;
  const liveGridClassName = getLiveGridClassName(roomSummary);

  return (
    <main className={`liveShell liveMood-${liveMood}`} data-live-mood={liveMood}>
      <section className="liveHero">
        <div className="liveHeroTitle">
          <h1>{getLivePageTitle(roomSummary)}</h1>
          <p>{roomStatusLabel}</p>
        </div>
      </section>

      {isDevMode ? (
        <DevLiveToolbar
          activeFixtureId={activeDevFixtureId}
          fixtures={devFixtures}
          onSelectFixture={handleDevFixtureChange}
        />
      ) : null}

      {isGameSurface ? null : (
        <>
          {isRoomEntryAvailable ? (
            <LiveSetupSurface
              displayName={displayName}
              isBusy={isBusy}
              roomCodeInput={roomCodeInput}
              statusMessage={statusMessage}
              targetPlayerCount={targetPlayerCount}
              onCreateRoom={handleCreateRoom}
              onDisplayNameChange={handleDisplayNameChange}
              onJoinRoom={handleJoinRoom}
              onRoomCodeChange={handleRoomCodeChange}
              onTargetPlayerCountChange={handleTargetPlayerCountChange}
            />
          ) : (
            <div className="liveTopStack liveTopStackCompact">
              <section className="liveStatusBar" aria-live="polite">
                <span>{liveGuidance.label}</span>
                <strong>{liveGuidance.message}</strong>
                <small>{statusMessage}</small>
              </section>
            </div>
          )}
        </>
      )}

      {isRoomEntryAvailable ? null : (
        <div className={liveGridClassName}>
          {roomSummary === null ? (
            <section className="livePanel liveRoomPanel" aria-label="Room state">
              <div className="livePanelHeading">
                <span>Room</span>
                <strong>{roomStatusLabel}</strong>
              </div>

              {savedRoomCode === null ? null : (
                <SavedRoomState isCompact roomCode={savedRoomCode} />
              )}
            </section>
          ) : null}

          {roomSummary?.status === "lobby" ? (
            <>
              <section className="livePanel liveInvitePanel" aria-label="Invite">
                <div className="livePanelHeading">
                  <span>Invite</span>
                  <div className="livePanelHeadingActions">
                    <strong>{roomStatusLabel}</strong>
                    <button
                      className="secondaryButton liveCompactButton"
                      type="button"
                      onClick={handleRefreshRoom}
                      disabled={isBusy}
                    >
                      Refresh
                    </button>
                  </div>
                </div>

                <RoomInviteTools
                  copiedRoomCode={copiedInviteRoomCode}
                  summary={roomSummary}
                  onCopyRoomCode={handleCopyRoomCode}
                  onShareRoom={handleShareRoom}
                />
                <LobbyRequirements summary={roomSummary} />
              </section>

              <section className="livePanel liveSeatPanel" aria-label="Lobby seats">
                <div className="livePanelHeading">
                  <span>Lobby</span>
                  <strong>
                    {countJoinedPlayers(roomSummary)} / {roomSummary.targetPlayerCount} seated
                  </strong>
                </div>
                <PlayerSeatGrid summary={roomSummary} />
              </section>
            </>
          ) : null}

          {roomSummary?.status === "lobby" ? (
            <section className="livePanel liveControlPanel" aria-label="Lobby controls">
              <div className="livePanelHeading">
                <span>{roomSummary.isHost ? "Host controls" : "Player controls"}</span>
                <div className="livePanelHeadingActions">
                  <strong>{roomSummary.isHost ? "Host" : "Player"}</strong>
                  {canConfigureStartSettings ? (
                    <button
                      className="secondaryButton liveCompactButton"
                      aria-controls="start-settings-dialog"
                      aria-expanded={isStartSettingsOpen}
                      aria-haspopup="dialog"
                      type="button"
                      onClick={() => setIsStartSettingsOpen(true)}
                    >
                      Settings
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="liveLobbyPanel">
                <strong>
                  {roomSummary.isHost ? "Start when everyone is seated" : "Waiting for host"}
                </strong>
                <p>{controlHint}</p>
              </div>

              <div className="liveLobbyActions">
                {roomSummary.isHost ? (
                  <button
                    className="primaryLiveButton"
                    aria-describedby="control-hint"
                    type="button"
                    onClick={handleStartGame}
                    disabled={!canStartGame}
                  >
                    Start game
                  </button>
                ) : null}
                <button
                  className="dangerButton"
                  aria-describedby="control-hint"
                  type="button"
                  onClick={handleLeaveRoom}
                  disabled={isBusy}
                >
                  Leave room
                </button>
              </div>
              <p className="srOnly" id="control-hint">
                {controlHint}
              </p>
            </section>
          ) : null}

          {roomSummary !== null && roomSummary.status !== "lobby" ? (
            <LivePlaySurface
              canAdvancePhase={canAdvancePhase}
              controlHint={controlHint}
              isBusy={isBusy}
              isNightConversationOpen={isNightConversationOpen}
              isPublicLogOpen={isPublicLogOpen}
              nightConversationDraft={nightConversationDraft}
              roomStatusLabel={roomStatusLabel}
              selfActions={selfActions}
              statusMessage={statusMessage}
              summary={roomSummary}
              targetByActionKey={targetByActionKey}
              onAdvancePhase={handleResolvePhase}
              onCloseNightConversation={() => setIsNightConversationOpen(false)}
              onClosePublicLog={() => setIsPublicLogOpen(false)}
              onNightConversationDraftChange={setNightConversationDraft}
              onOpenNightConversation={() => setIsNightConversationOpen(true)}
              onOpenPublicLog={() => setIsPublicLogOpen(true)}
              onSendNightConversation={handleSendNightConversation}
              onSubmitAction={handleSubmitAction}
              onTargetChange={(actionKey, playerId) =>
                setTargetByActionKey((current) => ({ ...current, [actionKey]: playerId }))
              }
            />
          ) : null}
        </div>
      )}

      {canConfigureStartSettings && isStartSettingsOpen ? (
        <StartSettingsDialog
          playerCount={roomSummary.targetPlayerCount}
          settings={startRuleSetSettings}
          onClose={() => setIsStartSettingsOpen(false)}
          onApplySettings={(nextSettings) => setStartRuleSetSettings(nextSettings)}
        />
      ) : null}
    </main>
  );
}

function DevLiveToolbar({
  activeFixtureId,
  fixtures,
  onSelectFixture,
}: {
  readonly activeFixtureId: string | null;
  readonly fixtures: readonly DevLiveFixture[];
  readonly onSelectFixture: (fixture: DevLiveFixture) => void;
}) {
  return (
    <section className="liveDevToolbar" aria-label="Development live fixtures">
      <div>
        <span>Dev live</span>
        <strong>Local fixtures only</strong>
      </div>
      <div className="liveDevToolbarActions">
        {fixtures.map((fixture) => (
          <button
            aria-pressed={fixture.id === activeFixtureId}
            className={fixture.id === activeFixtureId ? "active" : undefined}
            key={fixture.id}
            type="button"
            onClick={() => onSelectFixture(fixture)}
          >
            {fixture.label}
          </button>
        ))}
        <Link className="secondaryButton" href="/live">
          Real live
        </Link>
      </div>
    </section>
  );
}

function StartSettingsDialog({
  playerCount,
  settings,
  onClose,
  onApplySettings,
}: {
  readonly playerCount: number;
  readonly settings: StartRuleSetSettings;
  readonly onClose: () => void;
  readonly onApplySettings: (settings: StartRuleSetSettings) => void;
}) {
  const [activeTab, setActiveTab] = useState<StartSettingsTab>("general");
  const [draftSettings, setDraftSettings] = useState<StartRuleSetSettings>(() => ({
    ...settings,
    roleCounts: { ...settings.roleCounts },
  }));
  const canApplySettings =
    getStartRuleSetValidationMessages(draftSettings, playerCount).length === 0;

  function handleDraftSettingsChange<Key extends keyof StartRuleSetSettings>(
    key: Key,
    value: StartRuleSetSettings[Key],
  ): void {
    setDraftSettings((currentSettings) => ({
      ...currentSettings,
      [key]: value,
    }));
  }

  function handleDraftNumberChange(key: RuleSetNumberField, value: number): void {
    if (!Number.isFinite(value)) {
      return;
    }

    setDraftSettings((currentSettings) => ({
      ...currentSettings,
      [key]: clampRuleSetNumber(key, value),
    }));
  }

  function handleDraftRoleCountChange(roleId: RoleId, value: number): void {
    if (!Number.isFinite(value)) {
      return;
    }

    setDraftSettings((currentSettings) => ({
      ...currentSettings,
      roleCounts: {
        ...getEffectiveStartRoleCounts(currentSettings, playerCount),
        [roleId]: clampRoleCount(roleId, value, playerCount),
      },
    }));
  }

  function handleApplySettings(): void {
    if (!canApplySettings) {
      return;
    }

    onApplySettings(draftSettings);
    onClose();
  }

  return (
    <div
      className="liveModalBackdrop liveSettingsBackdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="liveModal liveSettingsModal"
        id="start-settings-dialog"
        aria-labelledby="start-settings-title"
        aria-modal="true"
        role="dialog"
      >
        <div className="liveSettingsHeader">
          <div>
            <span>Host settings</span>
            <h2 id="start-settings-title">Game settings</h2>
            <p>Adjust the room flow before the first night starts.</p>
          </div>
          <div className="liveSettingsHeaderActions">
            <span className="liveSettingsRoomBadge">{playerCount} seats</span>
            <button
              className="secondaryButton liveIconButton"
              aria-label="Close settings"
              type="button"
              onClick={onClose}
            >
              <span aria-hidden="true">X</span>
            </button>
          </div>
        </div>

        <div className="liveSettingsTabs" role="tablist" aria-label="Settings sections">
          {START_SETTINGS_TABS.map((tab) => (
            <button
              aria-controls={`start-settings-${tab.id}-panel`}
              aria-selected={activeTab === tab.id}
              className={activeTab === tab.id ? "active" : ""}
              id={`start-settings-${tab.id}-tab`}
              key={tab.id}
              role="tab"
              type="button"
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="liveSettingsBody">
          <StartRuleSetPanel
            activeTab={activeTab}
            playerCount={playerCount}
            settings={draftSettings}
            onNumberChange={handleDraftNumberChange}
            onRoleCountChange={handleDraftRoleCountChange}
            onSettingsChange={handleDraftSettingsChange}
          />
        </div>

        <div className="liveSettingsFooter">
          <button
            className="secondaryButton"
            type="button"
            onClick={() => setDraftSettings({ ...DEFAULT_START_RULE_SET_SETTINGS, roleCounts: {} })}
          >
            Reset
          </button>
          <div>
            <button className="secondaryButton" type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="button" disabled={!canApplySettings} onClick={handleApplySettings}>
              Apply settings
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function LivePopupDialog({
  children,
  id,
  meta,
  title,
  onClose,
}: {
  readonly children: ReactNode;
  readonly id: string;
  readonly meta: string;
  readonly title: string;
  readonly onClose: () => void;
}) {
  const titleId = `${id}-title`;

  return (
    <div
      className="liveModalBackdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="liveModal livePopupModal"
        id={id}
        aria-labelledby={titleId}
        aria-modal="true"
        role="dialog"
      >
        <div className="liveModalHeader">
          <div>
            <span>{meta}</span>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            className="secondaryButton liveIconButton"
            aria-label={`Close ${title}`}
            type="button"
            onClick={onClose}
          >
            <span aria-hidden="true">X</span>
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function LiveSetupSurface({
  displayName,
  isBusy,
  roomCodeInput,
  statusMessage,
  targetPlayerCount,
  onCreateRoom,
  onDisplayNameChange,
  onJoinRoom,
  onRoomCodeChange,
  onTargetPlayerCountChange,
}: LiveSetupSurfaceProps) {
  const roomCodeInputsRef = useRef<(HTMLInputElement | null)[]>([]);
  const roomCodeDigits = Array.from({ length: 6 }, (unusedValue, index) => {
    void unusedValue;

    return roomCodeInput[index] ?? "";
  });
  const normalizedDisplayName = displayName.trim() || "Player";
  const isJoinDisabled = isBusy || roomCodeInput.length !== 6;

  function focusRoomCodeInput(index: number): void {
    roomCodeInputsRef.current[index]?.focus();
  }

  function handleRoomCodeDigitChange(index: number, value: string): void {
    const pastedDigits = value.replace(/\D/g, "").slice(0, 6);
    const nextDigits = [...roomCodeDigits];

    if (pastedDigits.length > 1) {
      pastedDigits.split("").forEach((digit, offset) => {
        if (index + offset < nextDigits.length) {
          nextDigits[index + offset] = digit;
        }
      });
      onRoomCodeChange(nextDigits.join(""));
      focusRoomCodeInput(Math.min(index + pastedDigits.length, nextDigits.length - 1));
      return;
    }

    nextDigits[index] = pastedDigits;
    onRoomCodeChange(nextDigits.join(""));

    if (pastedDigits !== "" && index < nextDigits.length - 1) {
      focusRoomCodeInput(index + 1);
    }
  }

  function handleRoomCodeDigitKeyDown(index: number, key: string): void {
    if (key === "Backspace" && roomCodeDigits[index] === "" && index > 0) {
      focusRoomCodeInput(index - 1);
      return;
    }

    if (key === "ArrowLeft" && index > 0) {
      focusRoomCodeInput(index - 1);
      return;
    }

    if (key === "ArrowRight" && index < roomCodeDigits.length - 1) {
      focusRoomCodeInput(index + 1);
    }
  }

  function handleRoomCodePaste(index: number, clipboardText: string): void {
    const pastedDigits = clipboardText.replace(/\D/g, "").slice(0, 6);

    if (pastedDigits === "") {
      return;
    }

    const nextDigits = [...roomCodeDigits];
    pastedDigits.split("").forEach((digit, offset) => {
      if (index + offset < nextDigits.length) {
        nextDigits[index + offset] = digit;
      }
    });

    onRoomCodeChange(nextDigits.join(""));
    focusRoomCodeInput(Math.min(index + pastedDigits.length, nextDigits.length - 1));
  }

  return (
    <section className="liveSetupSurface" aria-label="Room setup">
      <section className="liveSetupHero" aria-labelledby="setup-title">
        <div>
          <div className="liveSetupEyebrow">Setup</div>
          <h2 id="setup-title">Create or join a private game room.</h2>
          <p>
            Keep the first screen focused on the decision players make here: host a new table, or
            enter a six-digit code from the host.
          </p>
        </div>
        <aside className="liveSetupMeter" aria-label="Setup progress">
          <div className="liveSetupMeterLabel">
            <span>Before room</span>
            <span>1 / 3</span>
          </div>
          <div className="liveSetupMeterTrack" aria-hidden="true" />
          <p className="liveSetupMeterCopy">
            Name first, then choose either Create room or Join room.
          </p>
          <p className="liveSetupStatus" aria-live="polite">
            {statusMessage}
          </p>
        </aside>
      </section>

      <section className="liveSetupActionGrid" aria-label="Room actions">
        <article className="liveSetupPanel liveSetupProfilePanel">
          <div className="liveSetupPanelHeader">
            <div>
              <p className="liveSetupPanelKicker">Player</p>
              <h3>Your seat</h3>
            </div>
          </div>
          <div className="liveSetupPanelBody">
            <label className="liveSetupField">
              Display name
              <input
                autoComplete="nickname"
                maxLength={32}
                value={displayName}
                onChange={(event) => onDisplayNameChange(event.target.value)}
              />
            </label>
            <div className="liveSetupProfileCard">
              <div className="liveSetupAvatar" aria-hidden="true">
                {getPlayerInitial(displayName)}
              </div>
              <div>
                <p className="liveSetupProfileName">{normalizedDisplayName}</p>
                <p className="liveSetupProfileNote">This identity stays in this browser.</p>
              </div>
            </div>
            <p className="liveSetupHint">
              Use this as the single source for player identity across create and join flows.
            </p>
          </div>
        </article>

        <article className="liveSetupPanel">
          <div className="liveSetupPanelHeader">
            <div>
              <p className="liveSetupPanelKicker">Host</p>
              <h3>Create a room</h3>
            </div>
            <div className="liveSetupPanelIcon" aria-hidden="true">
              +
            </div>
          </div>
          <div className="liveSetupPanelBody">
            <label className="liveSetupField">
              Players
              <select
                value={targetPlayerCount}
                onChange={(event) => onTargetPlayerCountChange(Number(event.target.value))}
              >
                {PLAYER_COUNT_OPTIONS.map((playerCount) => (
                  <option key={playerCount} value={playerCount}>
                    {playerCount} players
                  </option>
                ))}
              </select>
            </label>
            <p className="liveSetupHint">
              Start a lobby from this browser. The host controls stay attached to this session.
            </p>
            <div className="liveSetupButtonRow">
              <button
                className="liveSetupButton liveSetupButtonPrimary"
                type="button"
                onClick={onCreateRoom}
                disabled={isBusy}
              >
                Create room
              </button>
            </div>
          </div>
        </article>

        <article className="liveSetupPanel">
          <div className="liveSetupPanelHeader">
            <div>
              <p className="liveSetupPanelKicker">Guest</p>
              <h3>Join with code</h3>
            </div>
            <div className="liveSetupPanelIcon" aria-hidden="true">
              -&gt;
            </div>
          </div>
          <div className="liveSetupPanelBody">
            <div className="liveSetupField">
              <span id="live-room-code-label">Room code</span>
              <div className="liveSetupCodeGrid" aria-labelledby="live-room-code-label">
                {roomCodeDigits.map((digit, index) => (
                  <input
                    aria-label={`Room code digit ${index + 1}`}
                    autoComplete={index === 0 ? "one-time-code" : "off"}
                    className="liveSetupCodeCell"
                    inputMode="numeric"
                    key={index}
                    maxLength={1}
                    pattern="[0-9]*"
                    ref={(element) => {
                      roomCodeInputsRef.current[index] = element;
                    }}
                    value={digit}
                    onChange={(event) => handleRoomCodeDigitChange(index, event.target.value)}
                    onKeyDown={(event) => handleRoomCodeDigitKeyDown(index, event.key)}
                    onPaste={(event) => {
                      event.preventDefault();
                      handleRoomCodePaste(index, event.clipboardData.getData("text"));
                    }}
                  />
                ))}
              </div>
            </div>
            <p className="liveSetupHint">
              Paste or type the six-digit code. The join button becomes active once all digits are
              filled.
            </p>
            <div className="liveSetupButtonRow">
              <button
                className="liveSetupButton liveSetupButtonSecondary"
                type="button"
                onClick={() => onRoomCodeChange("")}
                disabled={isBusy || roomCodeInput.length === 0}
              >
                Clear
              </button>
              <button
                className="liveSetupButton liveSetupButtonPrimary"
                type="button"
                onClick={onJoinRoom}
                disabled={isJoinDisabled}
              >
                Join room
              </button>
            </div>
          </div>
        </article>
      </section>
    </section>
  );
}

function SavedRoomState({
  isCompact = false,
  roomCode,
}: {
  readonly isCompact?: boolean;
  readonly roomCode: string;
}) {
  return (
    <div className={isCompact ? "liveEmptyState compact" : "liveEmptyState"}>
      <strong>Restoring room {roomCode}</strong>
      <p>This browser already has a room. Leave that room before creating or joining another.</p>
    </div>
  );
}

function RoomInviteTools({
  copiedRoomCode,
  summary,
  onCopyRoomCode,
  onShareRoom,
}: {
  readonly copiedRoomCode: string | null;
  readonly summary: RoomSummary;
  readonly onCopyRoomCode: (roomCode: string) => void;
  readonly onShareRoom: (roomCode: string) => void;
}) {
  const joinedPlayerCount = countJoinedPlayers(summary);
  const openSeats = Math.max(summary.targetPlayerCount - joinedPlayerCount, 0);
  const didCopyCurrentRoom = copiedRoomCode === summary.code;

  return (
    <div className="liveInviteTools" aria-label="Room invite tools">
      <div>
        <span>Invite code</span>
        <strong>{summary.code}</strong>
        <small>{openSeats === 0 ? "Table full" : `${openSeats} seats open`}</small>
      </div>
      <div>
        <button
          className={didCopyCurrentRoom ? "secondaryButton liveCopiedButton" : "secondaryButton"}
          type="button"
          onClick={() => onCopyRoomCode(summary.code)}
        >
          {didCopyCurrentRoom ? "Copied!" : "Copy code"}
        </button>
        <button className="secondaryButton" type="button" onClick={() => onShareRoom(summary.code)}>
          Share invite
        </button>
      </div>
    </div>
  );
}

function LobbyRequirements({ summary }: { readonly summary: RoomSummary }) {
  const joinedPlayerCount = countJoinedPlayers(summary);
  const requiredPlayers = Math.max(summary.targetPlayerCount - joinedPlayerCount, 0);
  const progressPercent = Math.min(
    100,
    Math.round((joinedPlayerCount / summary.targetPlayerCount) * 100),
  );

  return (
    <div className="liveLobbyRequirements">
      <div>
        <span>Start requirement</span>
        <strong>
          {requiredPlayers === 0
            ? "All seats are filled."
            : `${requiredPlayers} more player${requiredPlayers === 1 ? "" : "s"} needed.`}
        </strong>
      </div>
      <div
        className="liveProgressTrack"
        aria-label={`${joinedPlayerCount} of ${summary.targetPlayerCount} seats filled`}
      >
        <span style={{ width: `${progressPercent}%` }} />
      </div>
      <ul>
        <li>Share the code with separate browser sessions.</li>
        <li>Settings stay behind the host Settings button.</li>
      </ul>
    </div>
  );
}

function LivePlaySurface({
  canAdvancePhase,
  controlHint,
  isBusy,
  isNightConversationOpen,
  isPublicLogOpen,
  nightConversationDraft,
  roomStatusLabel,
  selfActions,
  statusMessage,
  summary,
  targetByActionKey,
  onAdvancePhase,
  onCloseNightConversation,
  onClosePublicLog,
  onNightConversationDraftChange,
  onOpenNightConversation,
  onOpenPublicLog,
  onSendNightConversation,
  onSubmitAction,
  onTargetChange,
}: LivePlaySurfaceProps) {
  const actionProgress = summary.game?.actionProgress ?? null;
  const phaseEndsAt = summary.game?.phaseEndsAt ?? null;
  const phaseGuidance = getPlayPhaseGuidance(summary, isBusy);
  const playStatusMessage = getPlayStatusMessage(statusMessage, summary);
  const nightConversation = summary.rolePrivate?.nightConversation ?? null;
  const publicEventCount = summary.game?.events.length ?? 0;

  return (
    <>
      <section className="livePanel livePlayTablePanel" aria-label="Live game table">
        <LiveRoundTable summary={summary} />
      </section>

      <div className="livePlaySideStack">
        <section className="livePanel livePlayPhasePanel" aria-label="Current phase">
          <div className="livePanelHeading">
            <span>Current phase</span>
            <strong>{roomStatusLabel}</strong>
          </div>

          <div className="livePlayPhaseCard" aria-live="polite">
            <div>
              <span>{phaseGuidance.label}</span>
              <strong>{phaseGuidance.message}</strong>
              {playStatusMessage === "" ? null : <small>{playStatusMessage}</small>}
            </div>
            {phaseEndsAt === null ? null : (
              <time dateTime={phaseEndsAt}>
                <PhaseCountdown key={phaseEndsAt} phaseEndsAt={phaseEndsAt} />
              </time>
            )}
            {actionProgress === null ? null : (
              <em>
                {actionProgress.label}: {formatActionProgress(actionProgress)}
              </em>
            )}
          </div>

          {summary.isHost && summary.game?.status === "playing" ? (
            <div className="livePlayHostTools">
              <span>Table operation</span>
              <div>
                <button
                  className="secondaryButton"
                  aria-describedby="play-control-hint"
                  type="button"
                  onClick={onAdvancePhase}
                  disabled={!canAdvancePhase}
                >
                  Advance phase
                </button>
                <p id="play-control-hint">{controlHint}</p>
              </div>
            </div>
          ) : null}
        </section>

        <section
          className="livePanel liveNightActionPanel"
          aria-label={getActionPanelTitle(summary)}
        >
          <div className="livePanelHeading">
            <span>{getActionPanelTitle(summary)}</span>
            <strong>{summary.self?.roleName ?? "Role"}</strong>
          </div>

          <div className="liveNightActionStack">
            <ActionList
              actions={selfActions}
              isBusy={isBusy}
              players={summary.players}
              summary={summary}
              targetByActionKey={targetByActionKey}
              onSubmitAction={onSubmitAction}
              onTargetChange={onTargetChange}
            />
          </div>
        </section>

        <div className="livePopupActions" aria-label="Popup panels">
          <button
            className="secondaryButton"
            type="button"
            onClick={onOpenNightConversation}
            disabled={nightConversation === null}
          >
            Night chat
          </button>
          <button className="secondaryButton" type="button" onClick={onOpenPublicLog}>
            Public log
            <em>{publicEventCount}</em>
          </button>
        </div>
      </div>

      {nightConversation !== null && isNightConversationOpen ? (
        <LivePopupDialog
          id="night-chat-dialog"
          meta={nightConversation.readOnly ? "Read only" : "Night"}
          title={nightConversation.label}
          onClose={onCloseNightConversation}
        >
          <NightConversationPanel
            conversation={nightConversation}
            draft={nightConversationDraft}
            isBusy={isBusy}
            onDraftChange={onNightConversationDraftChange}
            onSend={onSendNightConversation}
          />
        </LivePopupDialog>
      ) : null}

      {isPublicLogOpen ? (
        <LivePopupDialog
          id="public-log-dialog"
          meta={`${publicEventCount} events`}
          title="Public log"
          onClose={onClosePublicLog}
        >
          <EventLog summary={summary} />
        </LivePopupDialog>
      ) : null}
    </>
  );
}

function LiveRoundTable({ summary }: { readonly summary: RoomSummary }) {
  const playerCount = summary.players.length;

  return (
    <div className="tableBoard liveTableBoard">
      <div className="tableSurface liveTableSurface">
        <div className="tableCenter liveTableCenter">
          <span className={`liveTablePhaseIcon ${getLiveMood(summary)}`} aria-hidden="true" />
          <strong>{getLiveTableTitle(summary)}</strong>
          <span>{getLiveTableNotice(summary)}</span>
        </div>

        {summary.players.map((player, index) => {
          const position = getRoundTableSeatPosition(index, playerCount);
          const seatState = getLiveSeatState(player, index, summary);
          const seatStatusLabel = getLiveSeatStatusLabel(player, index, summary);
          const seatStyle: CSSProperties & {
            readonly "--seat-x": string;
            readonly "--seat-y": string;
          } = {
            "--seat-x": `${position.x}%`,
            "--seat-y": `${position.y}%`,
          };
          const seatClassName = [
            "seat",
            "liveTableSeat",
            seatState,
            player.isCurrent ? "selected" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <div
              className={seatClassName}
              key={player.id}
              style={seatStyle}
              aria-label={`${player.displayName}, ${seatStatusLabel}`}
            >
              <span className="seatNumber">{index + 1}</span>
              <span className="avatar" aria-hidden="true">
                {getPlayerInitial(player.displayName)}
              </span>
              <span className="seatLabel">
                <strong>{player.displayName}</strong>
                <small>{seatStatusLabel}</small>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PhaseCountdown({ phaseEndsAt }: { readonly phaseEndsAt: string | null }) {
  const [currentTimeMs, setCurrentTimeMs] = useState(() => Date.now());

  useEffect(() => {
    if (phaseEndsAt === null) {
      return;
    }

    const intervalId = window.setInterval(() => setCurrentTimeMs(Date.now()), 1_000);

    return () => window.clearInterval(intervalId);
  }, [phaseEndsAt]);

  return <>{formatPhaseCountdown(phaseEndsAt, currentTimeMs)}</>;
}

function PlayerSeatGrid({ summary }: { readonly summary: RoomSummary }) {
  const joinedPlayers = summary.players.filter((player) => player.status === "joined");
  const emptySeats = Array.from(
    { length: Math.max(summary.targetPlayerCount - joinedPlayers.length, 0) },
    (unusedValue, index) => {
      void unusedValue;

      return index + joinedPlayers.length + 1;
    },
  );

  return (
    <div className="liveSeatGrid" aria-label="Lobby seats">
      {joinedPlayers.map((player, index) => (
        <div className={player.isCurrent ? "liveSeatCard current" : "liveSeatCard"} key={player.id}>
          <span className="liveAvatar" aria-hidden="true">
            {player.displayName.slice(0, 1)}
          </span>
          <span>
            <strong>{player.displayName}</strong>
            <small>Seat {index + 1}</small>
          </span>
          <em>{player.isHost ? "Host" : "Player"}</em>
        </div>
      ))}
      {emptySeats.map((seatNumber) => (
        <div className="liveSeatCard empty" key={`empty-${seatNumber}`}>
          <span className="liveAvatar" aria-hidden="true" />
          <span>
            <strong>Open seat</strong>
            <small>Seat {seatNumber}</small>
          </span>
          <em>Open</em>
        </div>
      ))}
    </div>
  );
}

function StartRuleSetPanel({
  activeTab,
  playerCount,
  settings,
  onNumberChange,
  onRoleCountChange,
  onSettingsChange,
}: {
  readonly activeTab: StartSettingsTab;
  readonly playerCount: number;
  readonly settings: StartRuleSetSettings;
  readonly onNumberChange: (key: RuleSetNumberField, value: number) => void;
  readonly onRoleCountChange: (roleId: RoleId, value: number) => void;
  readonly onSettingsChange: <Key extends keyof StartRuleSetSettings>(
    key: Key,
    value: StartRuleSetSettings[Key],
  ) => void;
}) {
  const canPreviewRoleMix = playerCount >= MIN_ROOM_PLAYERS && playerCount <= MAX_ROOM_PLAYERS;
  const roleCounts = canPreviewRoleMix ? getEffectiveStartRoleCounts(settings, playerCount) : null;
  const assignedRoleCount =
    roleCounts === null
      ? 0
      : START_SETTINGS_ROLE_ORDER.reduce((total, roleId) => total + roleCounts[roleId], 0);
  const roleValidationMessages = getStartRuleSetValidationMessages(settings, playerCount);
  const isRoleMixValid = roleValidationMessages.length === 0;
  const displayedRoleValidationMessages = isRoleMixValid
    ? ["Role counts are valid for this lobby."]
    : roleValidationMessages;
  const flowItems = getSettingsFlowItems(settings);

  return (
    <div className="liveRuleSetPanel">
      <section
        aria-labelledby="start-settings-general-tab"
        hidden={activeTab !== "general"}
        id="start-settings-general-panel"
        role="tabpanel"
      >
        <div className="liveSettingsSectionHead">
          <div>
            <h3>Overall settings</h3>
            <p>Set the day progression and vote result visibility for the room.</p>
          </div>
        </div>

        <div className="liveSettingsGridTwo">
          <article className="liveSettingsCard">
            <h4>Day progression</h4>
            <p>The selected mode changes which timer fields are used during the day phase.</p>

            <div className="liveSettingsChoiceGrid">
              <label className="liveSettingsChoice">
                <input
                  checked={settings.dayMode === "ordered_speech"}
                  name="dayMode"
                  type="radio"
                  value="ordered_speech"
                  onChange={() => onSettingsChange("dayMode", "ordered_speech")}
                />
                <span>Ordered</span>
                <strong>Ordered speech</strong>
                <em>Players speak through fixed slots before voting opens.</em>
              </label>

              <label className="liveSettingsChoice">
                <input
                  checked={settings.dayMode === "ready_check"}
                  name="dayMode"
                  type="radio"
                  value="ready_check"
                  onChange={() => onSettingsChange("dayMode", "ready_check")}
                />
                <span>Ready check</span>
                <strong>Ready check</strong>
                <em>Voting opens when players are ready or the meeting cap is reached.</em>
              </label>
            </div>
          </article>

          <article className="liveSettingsCard">
            <h4>Vote detail</h4>
            <p>Choose how much detail is shown after votes resolve.</p>
            <label className="liveRuleSetField">
              <span>Visibility</span>
              <select
                value={settings.voteResultVisibility}
                onChange={(event) =>
                  onSettingsChange(
                    "voteResultVisibility",
                    event.target.value as StartRuleSetSettings["voteResultVisibility"],
                  )
                }
              >
                <option value="count_only">Count only</option>
                <option value="voter_to_target">Voter to target</option>
              </select>
            </label>
          </article>
        </div>
      </section>

      <section
        aria-labelledby="start-settings-timers-tab"
        hidden={activeTab !== "timers"}
        id="start-settings-timers-panel"
        role="tabpanel"
      >
        <div className="liveSettingsSectionHead">
          <div>
            <h3>Time settings</h3>
            <p>Keep common phase timers separate from the selected day mode.</p>
          </div>
        </div>

        <div className="liveSettingsMainSide">
          <div className="liveSettingsStack">
            <article className="liveSettingsCard">
              <h4>Common phase timers</h4>
              <p>These timers are used regardless of the day progression mode.</p>
              <div className="liveTimingGrid common" aria-label="Common phase timing">
                <RuleSetNumberControl
                  field="firstNightSeconds"
                  label="First night"
                  value={settings.firstNightSeconds}
                  onChange={onNumberChange}
                />
                <RuleSetNumberControl
                  field="nightSeconds"
                  label="Night"
                  value={settings.nightSeconds}
                  onChange={onNumberChange}
                />
                <RuleSetNumberControl
                  field="votingSeconds"
                  label="Vote"
                  value={settings.votingSeconds}
                  onChange={onNumberChange}
                />
                <RuleSetNumberControl
                  field="executionLastWordsSeconds"
                  label="Last words"
                  value={settings.executionLastWordsSeconds}
                  onChange={onNumberChange}
                />
              </div>
            </article>

            <article className="liveSettingsCard">
              <h4>{settings.dayMode === "ordered_speech" ? "Ordered speech" : "Ready check"}</h4>
              <p>
                {settings.dayMode === "ordered_speech"
                  ? "Speech slot timing for first and normal days."
                  : "Meeting cap timing for ready-check days."}
              </p>
              {settings.dayMode === "ordered_speech" ? (
                <div className="liveTimingGrid day" aria-label="Ordered speech timing">
                  <RuleSetNumberControl
                    field="daySpeechSeconds"
                    label="Speech / player"
                    value={settings.daySpeechSeconds}
                    onChange={onNumberChange}
                  />
                  <RuleSetNumberControl
                    field="firstDaySpeechRounds"
                    label="First day rounds"
                    value={settings.firstDaySpeechRounds}
                    onChange={onNumberChange}
                  />
                  <RuleSetNumberControl
                    field="normalDaySpeechRounds"
                    label="Normal rounds"
                    value={settings.normalDaySpeechRounds}
                    onChange={onNumberChange}
                  />
                </div>
              ) : (
                <div className="liveTimingGrid day" aria-label="Ready check timing">
                  <RuleSetNumberControl
                    field="dayReadyCheckSecondsPerPlayer"
                    label="Ready / player"
                    value={settings.dayReadyCheckSecondsPerPlayer}
                    onChange={onNumberChange}
                  />
                </div>
              )}
            </article>
          </div>

          <aside className="liveSettingsCard liveSettingsSticky">
            <h4>Flow preview</h4>
            <p>
              {settings.dayMode === "ordered_speech" ? "Ordered speech flow." : "Ready check flow."}
            </p>
            <div className="liveSettingsFlow">
              {flowItems.map((item, index) => (
                <span key={item.label}>
                  {index > 0 ? <em aria-hidden="true">-&gt;</em> : null}
                  <strong>{item.label}</strong>
                  {item.value}
                </span>
              ))}
            </div>
          </aside>
        </div>
      </section>

      <section
        aria-labelledby="start-settings-roles-tab"
        hidden={activeTab !== "roles"}
        id="start-settings-roles-panel"
        role="tabpanel"
      >
        <div className="liveSettingsStack">
          <section className="liveSettingsCard">
            <div className="liveRolesHeader">
              <div>
                <h3>Role counts</h3>
                <p>Adjust role counts for the selected room size.</p>
              </div>
              <span
                className={isRoleMixValid ? "liveRoleTotal is-valid" : "liveRoleTotal is-invalid"}
              >
                <strong>
                  {assignedRoleCount} / {playerCount}
                </strong>{" "}
                assigned
              </span>
            </div>
            <div className="liveRoleGrid" aria-label="Automatic role counts">
              {roleCounts === null ? (
                <div className="liveSettingsEmptyOptions">
                  <strong>Role mix appears at 3 players</strong>
                </div>
              ) : (
                START_SETTINGS_ROLE_ORDER.map((roleId) => {
                  const count = roleCounts[roleId];
                  const roleName = ROLE_DEFINITIONS[roleId].name;
                  const canDecrease = canChangeRoleCount(roleCounts, roleId, -1, playerCount);
                  const canIncrease = canChangeRoleCount(roleCounts, roleId, 1, playerCount);

                  return (
                    <article
                      className={count === 0 ? "liveRoleCard is-zero" : "liveRoleCard"}
                      key={roleId}
                    >
                      <span className="liveRoleIcon" aria-hidden="true">
                        {ROLE_META[roleId].shortLabel}
                      </span>
                      <div>
                        <div className="liveRoleName">{roleName}</div>
                        <div className="liveRoleDescription">{ROLE_META[roleId].description}</div>
                      </div>
                      <div className="liveRoleCounter" aria-label={`${roleName} count`}>
                        <button
                          type="button"
                          aria-label={`Decrease ${roleName}`}
                          disabled={!canDecrease}
                          onClick={() => onRoleCountChange(roleId, count - 1)}
                        >
                          -
                        </button>
                        <span>{count}</span>
                        <button
                          type="button"
                          aria-label={`Increase ${roleName}`}
                          disabled={!canIncrease}
                          onClick={() => onRoleCountChange(roleId, count + 1)}
                        >
                          +
                        </button>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </section>

          <section className="liveSettingsCard">
            <div className="liveSettingsSectionHead">
              <div>
                <h3>Role-specific settings</h3>
                <p>Only options for active roles affect the game when it starts.</p>
              </div>
            </div>
            <div className="liveSettingsOptionGrid">
              {roleCounts !== null && roleCounts.seer > 0 ? (
                <div className="liveSettingsOptionCard">
                  <h4>Seer - Initial inspection</h4>
                  <div
                    className="liveSettingsSegments"
                    role="group"
                    aria-label="Initial inspection policy"
                  >
                    <button
                      aria-pressed={settings.initialInspectionPolicy === "enabled"}
                      type="button"
                      onClick={() => onSettingsChange("initialInspectionPolicy", "enabled")}
                    >
                      Enabled
                    </button>
                    <button
                      aria-pressed={settings.initialInspectionPolicy === "disabled"}
                      type="button"
                      onClick={() => onSettingsChange("initialInspectionPolicy", "disabled")}
                    >
                      Disabled
                    </button>
                  </div>
                </div>
              ) : null}

              {roleCounts !== null && roleCounts.guard > 0 ? (
                <div className="liveSettingsOptionCard">
                  <h4>Guard - Consecutive target</h4>
                  <div
                    className="liveSettingsSegments"
                    role="group"
                    aria-label="Guard consecutive target policy"
                  >
                    <button
                      aria-pressed={settings.guardConsecutiveTargetPolicy === "deny"}
                      type="button"
                      onClick={() => onSettingsChange("guardConsecutiveTargetPolicy", "deny")}
                    >
                      Deny same
                    </button>
                    <button
                      aria-pressed={settings.guardConsecutiveTargetPolicy === "allow"}
                      type="button"
                      onClick={() => onSettingsChange("guardConsecutiveTargetPolicy", "allow")}
                    >
                      Allow
                    </button>
                  </div>
                </div>
              ) : null}

              {roleCounts === null || (roleCounts.seer === 0 && roleCounts.guard === 0) ? (
                <div className="liveSettingsEmptyOptions">
                  No extra role options for the current automatic mix.
                </div>
              ) : null}
            </div>
          </section>

          <section
            className={
              isRoleMixValid
                ? "liveSettingsValidationBox is-valid"
                : "liveSettingsValidationBox is-invalid"
            }
          >
            <div>
              <h3>{isRoleMixValid ? "Ready to apply" : "Needs adjustment"}</h3>
              <ul>
                {displayedRoleValidationMessages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
            <span aria-hidden="true" />
          </section>
        </div>
      </section>
    </div>
  );
}

function RuleSetNumberControl({
  field,
  label,
  value,
  onChange,
}: {
  readonly field: RuleSetNumberField;
  readonly label: string;
  readonly value: number;
  readonly onChange: (field: RuleSetNumberField, value: number) => void;
}) {
  const limits = RULE_SET_NUMBER_LIMITS[field];

  return (
    <label className="liveRuleSetField">
      <span>{label}</span>
      <input
        inputMode="numeric"
        max={limits.max}
        min={limits.min}
        type="number"
        value={value}
        onChange={(event) => onChange(field, event.target.valueAsNumber)}
      />
    </label>
  );
}

function NightConversationPanel({
  conversation,
  draft,
  isBusy,
  onDraftChange,
  onSend,
}: {
  readonly conversation: NightConversationView;
  readonly draft: string;
  readonly isBusy: boolean;
  readonly onDraftChange: (value: string) => void;
  readonly onSend: (conversation: NightConversationView) => void;
}) {
  const trimmedDraft = draft.trim();
  const canSend =
    conversation.canSend &&
    !isBusy &&
    trimmedDraft.length >= 1 &&
    trimmedDraft.length <= conversation.maxMessageLength;

  return (
    <div className="liveNightChatPanel" aria-label="Night conversation">
      <div className="liveNightChatHeader">
        <strong>{conversation.label}</strong>
        <em>{conversation.readOnly ? "Read only" : "Night"}</em>
      </div>

      {conversation.messages.length === 0 ? (
        <p>No messages yet.</p>
      ) : (
        <ol className="liveNightChatMessages">
          {conversation.messages.map((message) => (
            <li key={message.id}>
              <div>
                <strong>{message.senderName}</strong>
                <time dateTime={message.createdAt}>{formatDateTime(message.createdAt)}</time>
              </div>
              <p>{message.body}</p>
            </li>
          ))}
        </ol>
      )}

      {conversation.canSend ? (
        <div className="liveNightChatComposer">
          <label>
            Message
            <input
              maxLength={conversation.maxMessageLength}
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
            />
          </label>
          <button type="button" disabled={!canSend} onClick={() => onSend(conversation)}>
            Send
          </button>
          <small>
            {trimmedDraft.length}/{conversation.maxMessageLength}
          </small>
        </div>
      ) : null}
    </div>
  );
}

function ActionList({
  actions,
  isBusy,
  players,
  summary,
  targetByActionKey,
  onTargetChange,
  onSubmitAction,
}: {
  readonly actions: readonly PublicAction[];
  readonly isBusy: boolean;
  readonly players: readonly PublicPlayer[];
  readonly summary: RoomSummary | null;
  readonly targetByActionKey: Record<string, string>;
  readonly onTargetChange: (actionKey: string, playerId: string) => void;
  readonly onSubmitAction: (action: PublicAction) => void;
}) {
  if (actions.length === 0) {
    const emptyCopy = getEmptyActionCopy(summary);

    return (
      <div className="liveEmptyState compact">
        <strong>{emptyCopy.title}</strong>
        <p>{emptyCopy.body}</p>
      </div>
    );
  }

  return (
    <div className="liveActionList">
      {actions.map((action) => {
        const selectedTarget = targetByActionKey[action.key] ?? action.eligibleTargetIds[0] ?? "";
        const targetPlayers = players.filter((player) =>
          action.eligibleTargetIds.includes(player.id),
        );

        return (
          <div
            className={action.status === "submitted" ? "liveActionRow submitted" : "liveActionRow"}
            key={action.key}
          >
            <div>
              <strong>{action.label}</strong>
              <span>
                {action.status === "submitted"
                  ? "Already submitted"
                  : formatDateTime(action.closesAt)}
              </span>
            </div>

            {action.targetKind === "single_player" && action.status === "open" ? (
              <select
                value={selectedTarget}
                onChange={(event) => onTargetChange(action.key, event.target.value)}
              >
                {targetPlayers.map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.displayName}
                  </option>
                ))}
              </select>
            ) : (
              <span className="liveActionState">
                {action.status === "submitted" ? "Target locked" : "No target"}
              </span>
            )}

            <button
              type="button"
              onClick={() => onSubmitAction(action)}
              disabled={isBusy || action.status === "submitted"}
            >
              {getActionButtonLabel(action, isBusy)}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function getEmptyActionCopy(summary: RoomSummary | null): { body: string; title: string } {
  if (summary === null) {
    return {
      body: "Join a room to load role-specific prompts.",
      title: "No private actions",
    };
  }

  if (summary.status === "disbanded") {
    return {
      body: "This room is closed. Create or join a new room to continue.",
      title: "Room closed",
    };
  }

  if (summary.game?.status === "ended") {
    return {
      body: "Private actions are closed. Review your result and the public log.",
      title: "Game complete",
    };
  }

  if (summary.status === "lobby") {
    return {
      body: "Private actions appear here after the host starts the game.",
      title: "Waiting for start",
    };
  }

  return {
    body: "This phase has no private action for you, or your action is already closed.",
    title: "No private actions",
  };
}

function EventLog({ summary }: { readonly summary: RoomSummary | null }) {
  const events = summary?.game?.events ?? [];

  if (events.length === 0) {
    return (
      <div className="liveEmptyState compact">
        <strong>No public events yet</strong>
        <p>Start the game or resolve a phase to build the public log.</p>
      </div>
    );
  }

  return (
    <ol className="liveEventList">
      {events.map((event) => (
        <li key={`${event.kind}:${event.createdAt}`}>
          <time dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time>
          <strong>{formatEventKind(event.kind)}</strong>
          <p>{event.message}</p>
          {event.details.length === 0 ? null : (
            <dl className="liveEventDetails">
              {event.details.map((detail) => (
                <div key={`${event.kind}:${event.createdAt}:${detail.label}`}>
                  <dt>{detail.label}</dt>
                  <dd>{detail.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </li>
      ))}
    </ol>
  );
}

async function apiFetch<Body>(path: string, options: RequestOptions): Promise<Body> {
  const headers = new Headers();

  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  if (options.token !== undefined) {
    headers.set("authorization", `Bearer ${options.token}`);
  }

  const response = await fetch(path, {
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers,
    method: options.method ?? "GET",
  });
  const json = await parseJson(response);

  if (!response.ok) {
    throw new Error(extractErrorMessage(json, response.status));
  }

  return json as Body;
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function writeClipboardText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function getLiveRoomUrl(): string {
  return `${window.location.origin}/live`;
}

function extractErrorMessage(value: unknown, status: number): string {
  if (isApiErrorResponse(value)) {
    return value.error.message;
  }

  return `Request failed with HTTP ${status}.`;
}

function toRequestFailureMessage(error: unknown): string {
  if (
    error instanceof TypeError ||
    (error instanceof Error && /failed to fetch|load failed|networkerror/iu.test(error.message))
  ) {
    return "Cannot reach the table. Check your connection, then try again.";
  }

  return error instanceof Error ? error.message : "The request failed.";
}

function toRealtimeSubscriptionKey(realtime: RoomSummary["realtime"]): string {
  if (realtime === null) {
    return "[]";
  }

  const subscriptions =
    Array.isArray(realtime.subscriptions) && realtime.subscriptions.length > 0
      ? realtime.subscriptions
      : [{ scope: "room" as const, topic: realtime.topic }];

  return JSON.stringify(
    subscriptions
      .map(({ scope, topic }) => ({ scope, topic }))
      .toSorted((left, right) =>
        `${left.scope}:${left.topic}`.localeCompare(`${right.scope}:${right.topic}`),
      ),
  );
}

function parseRealtimeSubscriptionKey(key: string): RealtimeSubscriptionSnapshot[] {
  const value = parseUnknownJson(key);

  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((candidate): RealtimeSubscriptionSnapshot[] => {
    if (
      !isRecord(candidate) ||
      typeof candidate["topic"] !== "string" ||
      !isRealtimeScope(candidate["scope"])
    ) {
      return [];
    }

    return [{ scope: candidate["scope"], topic: candidate["topic"] }];
  });
}

function parseUnknownJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isRealtimeInvalidationPayload(
  value: unknown,
  roomCode: string,
): value is RealtimeInvalidationPayload {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value["roomCode"] === roomCode &&
    typeof value["reason"] === "string" &&
    typeof value["sentAt"] === "string" &&
    (value["scope"] === "room" ||
      value["scope"] === "player_private" ||
      value["scope"] === "role_private")
  );
}

function isRealtimeScope(value: unknown): value is RealtimeInvalidationPayload["scope"] {
  return value === "room" || value === "player_private" || value === "role_private";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  if (typeof value !== "object" || value === null || !("error" in value)) {
    return false;
  }

  const candidate = value as { error: unknown };

  if (typeof candidate.error !== "object" || candidate.error === null) {
    return false;
  }

  return "message" in candidate.error;
}

function readStorage(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(key);
}

function writeStorage(key: string, value: string): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(key, value);
  }
}

function removeStorage(key: string): void {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(key);
  }
}

function requireRoomCode(roomCode: string): string {
  if (!/^\d{6}$/.test(roomCode)) {
    throw new Error("Enter a six-digit room code.");
  }

  return roomCode;
}

function buildStartRuleSetInput(settings: StartRuleSetSettings): RuleSetInput {
  return {
    ...settings,
    roleCounts: { ...settings.roleCounts },
  };
}

function getEffectiveStartRoleCounts(
  settings: StartRuleSetSettings,
  playerCount: number,
): Record<RoleId, number> {
  const specifiedRoleCount = START_SETTINGS_ROLE_ORDER.reduce(
    (total, roleId) => total + (settings.roleCounts[roleId] ?? 0),
    0,
  );

  if (specifiedRoleCount === 0) {
    return makeDefaultRuleSetForPlayers(playerCount).roleCounts;
  }

  return Object.fromEntries(
    START_SETTINGS_ROLE_ORDER.map((roleId) => [roleId, settings.roleCounts[roleId] ?? 0]),
  ) as Record<RoleId, number>;
}

function getStartRuleSetValidationMessages(
  settings: StartRuleSetSettings,
  playerCount: number,
): readonly string[] {
  const roleCounts = getEffectiveStartRoleCounts(settings, playerCount);
  const messages: string[] = [];
  const totalRoles = getRoleCountTotal(roleCounts);

  if (playerCount < MIN_ROOM_PLAYERS || playerCount > MAX_ROOM_PLAYERS) {
    messages.push(`Role counts are available for ${MIN_ROOM_PLAYERS}-${MAX_ROOM_PLAYERS} players.`);
  }

  if (totalRoles !== playerCount) {
    const diff = playerCount - totalRoles;
    messages.push(
      diff > 0
        ? `Add ${diff} more role${diff === 1 ? "" : "s"}.`
        : `Remove ${Math.abs(diff)} role${Math.abs(diff) === 1 ? "" : "s"}.`,
    );
  }

  for (const roleId of START_SETTINGS_ROLE_ORDER) {
    const definition = ROLE_DEFINITIONS[roleId];
    const count = roleCounts[roleId];
    const maxCount = getRoleMaxCount(roleId, playerCount);

    if (!Number.isInteger(count) || count < 0) {
      messages.push(`${definition.name} count must be a non-negative integer.`);
    }

    if (count < definition.minCount) {
      messages.push(`${definition.name} count must be at least ${definition.minCount}.`);
    }

    if (count > maxCount) {
      messages.push(`${definition.name} count must be at most ${maxCount}.`);
    }
  }

  if (settings.initialInspectionPolicy === "enabled" && roleCounts.seer > 0) {
    const humanInspectionCandidates = START_SETTINGS_ROLE_ORDER.filter(
      (roleId) => roleId !== "seer" && ROLE_DEFINITIONS[roleId].seenAs === "human",
    ).reduce((total, roleId) => total + roleCounts[roleId], 0);

    if (humanInspectionCandidates <= 0) {
      messages.push("Initial inspection requires at least one non-seer human result candidate.");
    }
  }

  return messages;
}

function getRoleCountTotal(roleCounts: Readonly<Record<RoleId, number>>): number {
  return START_SETTINGS_ROLE_ORDER.reduce((total, roleId) => total + roleCounts[roleId], 0);
}

function canChangeRoleCount(
  roleCounts: Readonly<Record<RoleId, number>>,
  roleId: RoleId,
  delta: -1 | 1,
  playerCount: number,
): boolean {
  const currentCount = roleCounts[roleId];
  const nextCount = currentCount + delta;

  if (
    nextCount < ROLE_DEFINITIONS[roleId].minCount ||
    nextCount > getRoleMaxCount(roleId, playerCount)
  ) {
    return false;
  }

  if (delta > 0 && getRoleCountTotal(roleCounts) >= playerCount) {
    return false;
  }

  return true;
}

function clampRoleCount(roleId: RoleId, value: number, playerCount: number): number {
  const integerValue = Math.trunc(value);

  return Math.min(
    getRoleMaxCount(roleId, playerCount),
    Math.max(ROLE_DEFINITIONS[roleId].minCount, integerValue),
  );
}

function getRoleMaxCount(roleId: RoleId, playerCount: number): number {
  return Math.min(ROLE_DEFINITIONS[roleId].maxCount, playerCount);
}

function getSettingsFlowItems(
  settings: StartRuleSetSettings,
): readonly { readonly label: string; readonly value: string }[] {
  const dayValue =
    settings.dayMode === "ordered_speech"
      ? `${settings.firstDaySpeechRounds}r first / ${settings.normalDaySpeechRounds}r normal x ${formatSettingsDuration(
          settings.daySpeechSeconds,
        )}`
      : `alive x ${formatSettingsDuration(settings.dayReadyCheckSecondsPerPlayer)} cap`;

  return [
    { label: "First night", value: formatSettingsDuration(settings.firstNightSeconds) },
    { label: "Day", value: dayValue },
    { label: "Vote", value: formatSettingsDuration(settings.votingSeconds) },
    { label: "Last words", value: formatSettingsDuration(settings.executionLastWordsSeconds) },
    { label: "Night", value: formatSettingsDuration(settings.nightSeconds) },
  ];
}

function formatSettingsDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return remainingSeconds === 0 ? `${minutes}m` : `${minutes}m ${remainingSeconds}s`;
}

function clampRuleSetNumber(field: RuleSetNumberField, value: number): number {
  const limits = RULE_SET_NUMBER_LIMITS[field];
  const integerValue = Math.trunc(value);

  return Math.min(limits.max, Math.max(limits.min, integerValue));
}

function getLiveMood(summary: RoomSummary | null): LiveMood {
  if (summary === null) {
    return "setup";
  }

  if (summary.status === "disbanded") {
    return "closed";
  }

  if (summary.game?.status === "ended") {
    return "result";
  }

  if (summary.status === "lobby") {
    return "lobby";
  }

  return summary.game?.phase ?? "setup";
}

function getLiveGridClassName(summary: RoomSummary | null): string {
  if (summary === null) {
    return "liveGrid liveGridSetup";
  }

  if (summary.status === "lobby") {
    return "liveGrid liveGridLobby";
  }

  return "liveGrid livePlayGrid";
}

function getLivePageTitle(summary: RoomSummary | null): string {
  if (summary === null) {
    return "Room setup";
  }

  if (summary.status === "lobby") {
    return `Room ${summary.code}`;
  }

  if (summary.status === "disbanded") {
    return "Room closed";
  }

  if (summary.game?.status === "ended") {
    return "Result";
  }

  return formatPhaseTitle(summary.game?.phase ?? null);
}

function getLiveTableTitle(summary: RoomSummary): string {
  if (summary.status === "disbanded") {
    return "Closed";
  }

  if (summary.game?.status === "ended") {
    return "Result";
  }

  return formatPhaseTitle(summary.game?.phase ?? null);
}

function getLiveTableNotice(summary: RoomSummary): string {
  if (summary.status === "disbanded") {
    return "This room is closed.";
  }

  if (summary.game?.status === "ended") {
    return `${formatWinner(summary.game.winnerTeam)} win.`;
  }

  if (summary.game?.phase === "night") {
    return "Private actions are open. The table view stays public.";
  }

  if (summary.game?.phase === "day") {
    return "Discussion is live. Track readiness without replacing table talk.";
  }

  if (summary.game?.phase === "voting") {
    return "Ballots are open for living players.";
  }

  if (summary.game?.phase === "execution") {
    return "Resolve the candidate and move the table forward.";
  }

  return "Game state is loading from the server.";
}

function getActionPanelTitle(summary: RoomSummary): string {
  if (summary.game?.phase === "night") {
    return "Night action";
  }

  if (summary.game?.phase === "day") {
    return "Day action";
  }

  if (summary.game?.phase === "voting") {
    return "Vote action";
  }

  if (summary.game?.phase === "execution") {
    return "Execution action";
  }

  return "Action";
}

function getPlayStatusMessage(statusMessage: string, summary: RoomSummary): string {
  if (statusMessage === "Your browser identity stays local and can rejoin the room.") {
    return "";
  }

  const roomPrefix = `Room ${summary.code} `;

  if (statusMessage.startsWith(roomPrefix)) {
    return `Table ${statusMessage.slice(roomPrefix.length)}`;
  }

  return statusMessage.replaceAll(summary.code, "this table");
}

function formatPhaseTitle(phase: NonNullable<RoomSummary["game"]>["phase"]): string {
  if (phase === "night") {
    return "Night";
  }

  if (phase === "day") {
    return "Day";
  }

  if (phase === "voting") {
    return "Voting";
  }

  if (phase === "execution") {
    return "Execution";
  }

  return "Game";
}

function getRoundTableSeatPosition(index: number, totalPlayers: number): RoundTableSeatPosition {
  const safeTotalPlayers = Math.max(totalPlayers, 1);
  let radius = 42;

  if (safeTotalPlayers <= 4) {
    radius = 38;
  } else if (safeTotalPlayers <= 6) {
    radius = 40;
  }

  const angle = -Math.PI / 2 + (index / safeTotalPlayers) * Math.PI * 2;

  return {
    x: Number((50 + Math.cos(angle) * radius).toFixed(3)),
    y: Number((50 + Math.sin(angle) * radius).toFixed(3)),
  };
}

function getLiveSeatState(
  player: PublicPlayer,
  index: number,
  summary: RoomSummary,
): LiveSeatState {
  if (player.alive === false) {
    return "eliminated";
  }

  if (player.status !== "joined") {
    return "observing";
  }

  if (summary.game?.status === "ended") {
    return "ready";
  }

  if (summary.game?.phase === "voting") {
    const progress = summary.game.actionProgress;

    if (progress?.visibility === "public") {
      const livingSeatIndex = getLivingSeatIndex(player, summary);

      return livingSeatIndex >= 0 && livingSeatIndex < progress.submitted ? "voted" : "pending";
    }

    return "pending";
  }

  if (summary.game?.phase === "execution") {
    return index % 3 === 2 ? "pending" : "observing";
  }

  if (summary.game?.phase === "day") {
    return index % 5 === 4 ? "speaking" : "ready";
  }

  if (summary.game?.phase === "night") {
    if (index % 4 === 2) {
      return "pending";
    }

    if (index % 5 === 4) {
      return "speaking";
    }

    return index % 3 === 0 ? "observing" : "ready";
  }

  return "observing";
}

function getLiveSeatStatusLabel(player: PublicPlayer, index: number, summary: RoomSummary): string {
  if (player.alive === false) {
    return "Out";
  }

  if (player.status === "disconnected") {
    return "Disconnected";
  }

  if (player.status === "left") {
    return "Left";
  }

  if (player.isHost) {
    return "Host";
  }

  if (player.isCurrent) {
    return "You";
  }

  const seatState = getLiveSeatState(player, index, summary);

  if (seatState === "voted") {
    return "Voted";
  }

  if (seatState === "pending") {
    return "Pending";
  }

  if (seatState === "speaking") {
    return "Speaking";
  }

  if (seatState === "ready") {
    return "Ready";
  }

  return "Watching";
}

function getLivingSeatIndex(player: PublicPlayer, summary: RoomSummary): number {
  return summary.players
    .filter((candidate) => candidate.status === "joined" && candidate.alive !== false)
    .findIndex((candidate) => candidate.id === player.id);
}

function getPlayerInitial(displayName: string): string {
  return displayName.trim().slice(0, 1).toLocaleUpperCase("en") || "?";
}

function getPlayPhaseGuidance(summary: RoomSummary, isBusy: boolean): LiveGuidance {
  if (isBusy) {
    return { label: "Syncing", message: "Reloading the latest table state." };
  }

  if (summary.status === "disbanded") {
    return { label: "Closed", message: "This table is closed." };
  }

  if (summary.game?.status === "ended") {
    return { label: "Result", message: `${formatWinner(summary.game.winnerTeam)} won.` };
  }

  if (summary.game?.phase === "night") {
    return { label: "Night", message: "Private actions are open. The public table stays quiet." };
  }

  if (summary.game?.phase === "day") {
    return { label: "Day", message: "Discussion is live. The app tracks table readiness only." };
  }

  if (summary.game?.phase === "voting") {
    return { label: "Voting", message: "Ballots are open for living players." };
  }

  if (summary.game?.phase === "execution") {
    return { label: "Execution", message: "Resolve the table outcome for this phase." };
  }

  return { label: "Game", message: "Loading the current table phase." };
}

function getLiveGuidance(
  summary: RoomSummary | null,
  actionCount: number,
  isBusy: boolean,
): LiveGuidance {
  if (isBusy) {
    return { label: "Syncing", message: "Updating the room from the server." };
  }

  if (summary === null) {
    return { label: "Setup", message: "Create a room or join one with a six-digit code." };
  }

  if (summary.status === "disbanded") {
    return { label: "Closed", message: "This room has been disbanded." };
  }

  if (summary.game?.status === "ended") {
    return {
      label: "Result",
      message: `${formatWinner(summary.game.winnerTeam)} won. Start a new room when ready.`,
    };
  }

  if (summary.status === "lobby") {
    const joinedPlayerCount = countJoinedPlayers(summary);

    if (!summary.isHost) {
      return {
        label: "Lobby",
        message: `${joinedPlayerCount}/${summary.targetPlayerCount} seats filled. Waiting for the host.`,
      };
    }

    if (joinedPlayerCount < summary.targetPlayerCount) {
      return {
        label: "Invite",
        message: `${summary.targetPlayerCount - joinedPlayerCount} more player${
          summary.targetPlayerCount - joinedPlayerCount === 1 ? "" : "s"
        } needed before starting.`,
      };
    }

    if (joinedPlayerCount > summary.targetPlayerCount) {
      return { label: "Full", message: "Leave extra seats before starting this room." };
    }

    return { label: "Ready", message: "Every selected seat is filled. Start when ready." };
  }

  if (actionCount > 0) {
    const openActionCount =
      summary.self?.actions.filter((action) => action.status === "open").length ?? 0;

    if (openActionCount > 0) {
      return { label: "Your turn", message: "Submit the private action shown below." };
    }
  }

  if (summary.game?.actionProgress?.visibility === "public") {
    return {
      label: "Progress",
      message: `${summary.game.actionProgress.submitted}/${summary.game.actionProgress.required} ${summary.game.actionProgress.label}`,
    };
  }

  if (summary.game?.actionProgress?.visibility === "hidden") {
    return { label: "Private night", message: summary.game.actionProgress.label };
  }

  if (summary.isHost) {
    return { label: "Host", message: "Advance the phase after all pending actions are submitted." };
  }

  return { label: "Waiting", message: "Waiting for other players or the host." };
}

function getStartHint(summary: RoomSummary | null, isBusy: boolean): string {
  if (isBusy) {
    return "Start is available after the current sync finishes.";
  }

  if (summary === null) {
    return "Create or join a room before starting.";
  }

  if (!summary.isHost) {
    return "Only the host can start the game.";
  }

  if (summary.status !== "lobby") {
    return "Start is only available while the room is in lobby.";
  }

  const joinedPlayerCount = countJoinedPlayers(summary);

  if (joinedPlayerCount < summary.targetPlayerCount) {
    return `${summary.targetPlayerCount - joinedPlayerCount} more active player${
      summary.targetPlayerCount - joinedPlayerCount === 1 ? "" : "s"
    } needed before starting.`;
  }

  if (joinedPlayerCount > summary.targetPlayerCount) {
    return "This room has more active players than the selected seat count.";
  }

  return "Start the game when every player is seated.";
}

function getControlHint(summary: RoomSummary | null, isBusy: boolean): string {
  if (summary === null) {
    return "Create or join a room to use table controls.";
  }

  if (summary.status === "lobby") {
    return getStartHint(summary, isBusy);
  }

  if (summary.status === "playing" && summary.game?.status === "playing") {
    return getAdvanceHint(summary, isBusy);
  }

  if (summary.status === "disbanded") {
    return "This room is closed.";
  }

  return "Review the result from this table.";
}

function canStartRoom(summary: RoomSummary | null): boolean {
  if (summary === null || !summary.isHost || summary.status !== "lobby") {
    return false;
  }

  const joinedPlayerCount = countJoinedPlayers(summary);

  return joinedPlayerCount === summary.targetPlayerCount;
}

function countJoinedPlayers(summary: RoomSummary): number {
  return summary.players.filter((player) => player.status === "joined").length;
}

function getAdvanceHint(summary: RoomSummary | null, isBusy: boolean): string {
  if (isBusy) {
    return "Advance is available after the current sync finishes.";
  }

  if (summary === null) {
    return "Create or join a room before advancing phases.";
  }

  if (!summary.isHost) {
    return "Only the host can advance phases.";
  }

  if (summary.status !== "playing" || summary.game?.status !== "playing") {
    return "Advance is available while a game is in progress.";
  }

  return "Advance after the table is ready or the phase timer has elapsed.";
}

function getActionButtonLabel(action: PublicAction, isBusy: boolean): string {
  if (action.status === "submitted") {
    return "Submitted";
  }

  if (isBusy) {
    return "Submitting";
  }

  return "Submit";
}

function formatRoomStatus(summary: RoomSummary | null): string {
  if (summary === null) {
    return "No room";
  }

  if (summary.game?.status === "ended") {
    return "Ended";
  }

  return `${summary.status} / ${summary.game?.phase ?? "setup"}`;
}

function formatWinner(winnerTeam: string | null): string {
  if (winnerTeam === null) {
    return "No team";
  }

  if (winnerTeam === "werewolves") {
    return "Werewolves";
  }

  if (winnerTeam === "villagers") {
    return "Villagers";
  }

  return "Fox";
}

function formatActionProgress(
  progress: NonNullable<RoomSummary["game"]>["actionProgress"],
): string {
  if (progress === null) {
    return "none";
  }

  if (progress.visibility === "hidden") {
    return "private";
  }

  return `${progress.submitted}/${progress.required}`;
}

function formatPhaseCountdown(phaseEndsAt: string | null, currentTimeMs: number): string {
  if (phaseEndsAt === null) {
    return "closed";
  }

  const phaseEndsAtMs = Date.parse(phaseEndsAt);

  if (!Number.isFinite(phaseEndsAtMs)) {
    return "unknown";
  }

  const remainingSeconds = Math.max(Math.ceil((phaseEndsAtMs - currentTimeMs) / 1_000), 0);

  if (remainingSeconds <= 0) {
    return "due now";
  }

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatEventKind(kind: string): string {
  return kind
    .split("_")
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatDateTime(value: string | null): string {
  if (value === null) {
    return "none";
  }

  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function getDevFixture(
  fixtures: readonly DevLiveFixture[],
  fixtureId: string | null | undefined,
): DevLiveFixture | null {
  return fixtures.find((fixture) => fixture.id === fixtureId) ?? fixtures[0] ?? null;
}

function getNextDevFixture(
  fixtures: readonly DevLiveFixture[],
  fixtureId: string | null,
): DevLiveFixture | null {
  if (fixtures.length === 0) {
    return null;
  }

  const currentIndex = fixtures.findIndex((fixture) => fixture.id === fixtureId);
  const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % fixtures.length;

  return fixtures[nextIndex] ?? null;
}

function markDevActionSubmitted(
  summary: RoomSummary | null,
  action: PublicAction,
): RoomSummary | null {
  if (summary?.self === null || summary?.self === undefined) {
    return summary;
  }

  const submittedAt = new Date().toISOString();

  return {
    ...summary,
    game:
      summary.game === null
        ? null
        : {
            ...summary.game,
            actionProgress: incrementDevActionProgress(summary.game.actionProgress),
            revision: summary.game.revision + 1,
          },
    self: {
      ...summary.self,
      actions: summary.self.actions.map((currentAction) =>
        currentAction.key === action.key
          ? {
              ...currentAction,
              status: "submitted",
            }
          : currentAction,
      ),
      submittedActions: [
        {
          kind: action.kind,
          label: action.label,
          submittedAt,
        },
        ...summary.self.submittedActions,
      ],
    },
  };
}

function incrementDevActionProgress(
  progress: NonNullable<RoomSummary["game"]>["actionProgress"],
): NonNullable<RoomSummary["game"]>["actionProgress"] {
  if (progress === null || progress.visibility === "hidden") {
    return progress;
  }

  return {
    ...progress,
    submitted: Math.min(progress.required, progress.submitted + 1),
  };
}

function appendDevNightConversationMessage(
  summary: RoomSummary | null,
  conversation: NightConversationView,
  draft: string,
): RoomSummary | null {
  const trimmedDraft = draft.trim();
  const rolePrivate = summary?.rolePrivate;

  if (
    summary === null ||
    rolePrivate === null ||
    rolePrivate === undefined ||
    rolePrivate.nightConversation === null ||
    trimmedDraft.length === 0
  ) {
    return summary;
  }

  const createdAt = new Date().toISOString();
  const currentPlayer = summary.players.find((player) => player.id === summary.currentPlayerId);
  const nextConversation: NightConversationView = {
    ...conversation,
    messages: [
      ...conversation.messages,
      {
        body: trimmedDraft,
        createdAt,
        id: `dev-night-message-${createdAt}`,
        senderName: currentPlayer?.displayName ?? "You",
        senderPlayerId: summary.currentPlayerId ?? "dev-player",
      },
    ],
  };

  return {
    ...summary,
    rolePrivate: {
      ...rolePrivate,
      nightConversation: nextConversation,
    },
  };
}
