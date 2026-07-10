"use client";

import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useI18n } from "@/app/i18nProvider";
import { LanguageSwitcher } from "@/app/languageSwitcher";
import { getLiveSeatPresentation } from "@/app/live/liveSeatPresentation";
import { getSupabaseRealtimeClient } from "@/lib/client/supabaseRealtime";
import {
  getLocalizedActionButtonLabel,
  getLocalizedActionLabel,
  getLocalizedActionProgressLabel,
  getLocalizedNightConversationLabel,
  getLocalizedRole,
  getLocalizedRoleOptionLabel,
  getLocalizedRolePreset,
  type Locale,
  type Localization,
} from "@/lib/i18n/localization";
import {
  DEFAULT_TARGET_PLAYER_COUNT,
  DEFAULT_RULE_SET_OPTIONS,
  MAX_ROOM_PLAYERS,
  MIN_ROOM_PLAYERS,
  type NightConversationView,
  type PublicAction,
  type PublicPlayer,
  type RealtimeSubscription,
  type RoleCounts,
  type RoleCatalogItem,
  type RoleId,
  type RoleSpecificOptionItem,
  type RoomSummary,
  type RuleSetInput,
} from "@/lib/shared/game";
import {
  expandRolePresetCounts,
  getMatchingRolePreset,
  getRolePresetsForPlayerCount,
  type RolePreset,
} from "@/lib/shared/rolePresets";

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

type ClearCurrentRoomOptions = {
  readonly ignoredRoomCode?: string | null;
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

type LiveMood = "closed" | "day" | "execution" | "lobby" | "night" | "result" | "setup" | "voting";

type RoundTableSeatPosition = {
  readonly x: number;
  readonly y: number;
};

type LiveGuidance = {
  readonly label: string;
  readonly message: string;
};

type LiveToastTone = "error" | "info" | "success" | "warning";

type LiveToast = {
  readonly message: string;
  readonly tone: LiveToastTone;
};

type PublicEventDetail = {
  readonly label: string;
  readonly value: string;
};

type LivePlaySurfaceProps = {
  readonly isBusy: boolean;
  readonly isNightConversationOpen: boolean;
  readonly isPublicLogOpen: boolean;
  readonly locale: Locale;
  readonly nightConversationDraft: string;
  readonly selfActions: readonly PublicAction[];
  readonly summary: RoomSummary;
  readonly targetByActionKey: Record<string, string>;
  readonly t: Localization;
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
  readonly t: Localization;
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
const TOAST_DEFAULT_DURATION_MS = 4_800;
const TOAST_IMPORTANT_DURATION_MS = 7_000;
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
  dayMode: DEFAULT_RULE_SET_OPTIONS.dayMode,
  dayReadyCheckSecondsPerPlayer: DEFAULT_RULE_SET_OPTIONS.dayReadyCheckSecondsPerPlayer,
  daySpeechSeconds: DEFAULT_RULE_SET_OPTIONS.daySpeechSeconds,
  executionLastWordsSeconds: DEFAULT_RULE_SET_OPTIONS.executionLastWordsSeconds,
  firstDaySpeechRounds: DEFAULT_RULE_SET_OPTIONS.firstDaySpeechRounds,
  firstNightSeconds: DEFAULT_RULE_SET_OPTIONS.firstNightSeconds,
  guardConsecutiveTargetPolicy: DEFAULT_RULE_SET_OPTIONS.guardConsecutiveTargetPolicy,
  initialInspectionPolicy: DEFAULT_RULE_SET_OPTIONS.initialInspectionPolicy,
  nightSeconds: DEFAULT_RULE_SET_OPTIONS.nightSeconds,
  normalDaySpeechRounds: DEFAULT_RULE_SET_OPTIONS.normalDaySpeechRounds,
  roleCounts: {},
  voteResultVisibility: DEFAULT_RULE_SET_OPTIONS.voteResultVisibility,
  votingSeconds: DEFAULT_RULE_SET_OPTIONS.votingSeconds,
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

const START_SETTINGS_TABS: readonly StartSettingsTab[] = ["general", "timers", "roles"];

export default function LivePage() {
  const { locale, t } = useI18n();
  const invalidIdentityStatusMessage = t.live.room.identityExpired;
  const roomClosedStatusMessage = t.live.room.closed;
  const [identityToken, setIdentityToken] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("Sora");
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [targetPlayerCount, setTargetPlayerCount] = useState(DEFAULT_TARGET_PLAYER_COUNT);
  const [savedRoomCode, setSavedRoomCode] = useState<string | null>(null);
  const [roomSummary, setRoomSummary] = useState<RoomSummary | null>(null);
  const [startRuleSetSettings, setStartRuleSetSettings] = useState<StartRuleSetSettings>(
    DEFAULT_START_RULE_SET_SETTINGS,
  );
  const [isStartSettingsOpen, setIsStartSettingsOpen] = useState(false);
  const [isNightConversationOpen, setIsNightConversationOpen] = useState(false);
  const [isPublicLogOpen, setIsPublicLogOpen] = useState(false);
  const [toast, setToast] = useState<LiveToast | null>(null);
  const [nightConversationDraft, setNightConversationDraft] = useState("");
  const [copiedInviteRoomCode, setCopiedInviteRoomCode] = useState<string | null>(null);
  const copiedInviteResetTimerRef = useRef<number | null>(null);
  const toastDismissTimerRef = useRef<number | null>(null);
  const ignoredRoomCodeRef = useRef<string | null>(null);
  const [targetByActionKey, setTargetByActionKey] = useState<Record<string, string>>({});
  const [isBusy, setIsBusy] = useState(false);
  const [liveOrigin, setLiveOrigin] = useState<string | null>(null);

  const dismissToast = useCallback(() => {
    if (toastDismissTimerRef.current !== null) {
      window.clearTimeout(toastDismissTimerRef.current);
      toastDismissTimerRef.current = null;
    }

    setToast(null);
  }, []);

  const showToast = useCallback(
    (message: string, tone: LiveToastTone = "info", durationMs = TOAST_DEFAULT_DURATION_MS) => {
      if (toastDismissTimerRef.current !== null) {
        window.clearTimeout(toastDismissTimerRef.current);
      }

      setToast({ message, tone });

      if (durationMs <= 0) {
        toastDismissTimerRef.current = null;
        return;
      }

      toastDismissTimerRef.current = window.setTimeout(() => {
        toastDismissTimerRef.current = null;
        setToast(null);
      }, durationMs);
    },
    [setToast],
  );

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      const requestedRoomCode = getRoomCodeSearchParam(window.location.search);
      const savedIdentityToken = readStorage(IDENTITY_STORAGE_KEY);
      const savedDisplayName = readStorage(DISPLAY_NAME_STORAGE_KEY);
      const savedRoomCode = readStorage(ROOM_CODE_STORAGE_KEY);

      setLiveOrigin(window.location.origin);

      if (savedIdentityToken !== null) {
        setIdentityToken(savedIdentityToken);
      }

      if (savedDisplayName !== null) {
        setDisplayName(savedDisplayName);
      }

      if (requestedRoomCode !== null) {
        setSavedRoomCode(null);
        setRoomCodeInput(requestedRoomCode);
        return;
      }

      if (savedRoomCode !== null) {
        setSavedRoomCode(savedRoomCode);
        setRoomCodeInput(savedRoomCode);
      }
    }, 0);

    return () => window.clearTimeout(timerId);
  }, []);

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

      if (toastDismissTimerRef.current !== null) {
        window.clearTimeout(toastDismissTimerRef.current);
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

  async function createIdentityToken(): Promise<string> {
    const identity = await apiFetch<IdentityResponse>("/api/identity", { method: "POST" });

    writeStorage(IDENTITY_STORAGE_KEY, identity.token);
    setIdentityToken(identity.token);

    return identity.token;
  }

  async function ensureIdentityToken(): Promise<string> {
    if (identityToken !== null) {
      return identityToken;
    }

    return createIdentityToken();
  }

  const clearCurrentRoom = useCallback((options: ClearCurrentRoomOptions = {}) => {
    ignoredRoomCodeRef.current = options.ignoredRoomCode ?? null;
    removeStorage(ROOM_CODE_STORAGE_KEY);
    setSavedRoomCode(null);
    setRoomSummary(null);
    setRoomCodeInput("");
    setTargetByActionKey({});
    setIsNightConversationOpen(false);
    setIsPublicLogOpen(false);
    setNightConversationDraft("");
    setIsStartSettingsOpen(false);
  }, []);

  const resetInvalidIdentity = useCallback(
    (nextStatusMessage = invalidIdentityStatusMessage) => {
      removeStorage(IDENTITY_STORAGE_KEY);
      setIdentityToken(null);
      showToast(nextStatusMessage, "warning", TOAST_IMPORTANT_DURATION_MS);
      clearCurrentRoom();
    },
    [clearCurrentRoom, invalidIdentityStatusMessage, showToast],
  );

  async function withBusy(work: () => Promise<void>): Promise<void> {
    setIsBusy(true);

    try {
      await work();
    } catch (error) {
      if (isUnauthorizedRequestError(error)) {
        resetInvalidIdentity();
        return;
      }

      const failureMessage = toRequestFailureMessage(error, t);

      showToast(failureMessage, "error", TOAST_IMPORTANT_DURATION_MS);
    } finally {
      setIsBusy(false);
    }
  }

  async function withFreshIdentityToken<Body>(
    request: (token: string) => Promise<Body>,
  ): Promise<Body> {
    const token = await ensureIdentityToken();

    try {
      return await request(token);
    } catch (error) {
      if (!isUnauthorizedRequestError(error)) {
        throw error;
      }

      resetInvalidIdentity(t.live.room.identityResetting);
      const nextToken = await createIdentityToken();

      return request(nextToken);
    }
  }

  const rememberRoom = useCallback(
    (nextSummary: RoomSummary, options: RememberRoomOptions = {}) => {
      if (ignoredRoomCodeRef.current === nextSummary.code) {
        return false;
      }

      if (nextSummary.status === "disbanded") {
        clearCurrentRoom({ ignoredRoomCode: nextSummary.code });
        showToast(roomClosedStatusMessage, "warning", TOAST_IMPORTANT_DURATION_MS);
        return false;
      }

      writeStorage(DISPLAY_NAME_STORAGE_KEY, displayName);
      writeStorage(ROOM_CODE_STORAGE_KEY, nextSummary.code);
      setSavedRoomCode(nextSummary.code);
      setRoomCodeInput(nextSummary.code);
      setRoomSummary(nextSummary);

      if (options.resetActionTargets ?? true) {
        setTargetByActionKey({});
      }

      return true;
    },
    [clearCurrentRoom, displayName, roomClosedStatusMessage, showToast],
  );

  useEffect(() => {
    if (identityToken === null && savedRoomCode !== null) {
      const nextStatusMessage = t.live.room.savedExpired;

      removeStorage(ROOM_CODE_STORAGE_KEY);
      setSavedRoomCode(null);
      setRoomCodeInput("");
      showToast(nextStatusMessage, "warning", TOAST_IMPORTANT_DURATION_MS);
    }
  }, [identityToken, savedRoomCode, showToast, t]);

  useEffect(() => {
    if (identityToken === null || roomSummary !== null || savedRoomCode === null) {
      return;
    }

    if (ignoredRoomCodeRef.current === savedRoomCode) {
      return;
    }

    let isCancelled = false;
    const activeToken = identityToken;

    async function restoreSavedRoom(): Promise<void> {
      try {
        const summary = await apiFetch<RoomSummary>(`/api/rooms/${savedRoomCode}`, {
          method: "GET",
          token: activeToken,
        });

        if (!isCancelled) {
          rememberRoom(summary, { resetActionTargets: false });
        }
      } catch (error) {
        if (!isCancelled) {
          if (isUnauthorizedRequestError(error)) {
            resetInvalidIdentity();
            return;
          }

          if (isNotFoundRequestError(error)) {
            clearCurrentRoom({ ignoredRoomCode: savedRoomCode });
            showToast(roomClosedStatusMessage, "warning", TOAST_IMPORTANT_DURATION_MS);
            return;
          }

          const nextStatusMessage = t.live.room.savedCouldNotRestore;

          clearCurrentRoom({
            ignoredRoomCode: savedRoomCode,
          });
          showToast(nextStatusMessage, "error", TOAST_IMPORTANT_DURATION_MS);
        }
      }
    }

    void restoreSavedRoom();

    return () => {
      isCancelled = true;
    };
  }, [
    clearCurrentRoom,
    identityToken,
    rememberRoom,
    resetInvalidIdentity,
    roomClosedStatusMessage,
    roomSummary,
    savedRoomCode,
    showToast,
    t,
  ]);

  const activeRoomCode = roomSummary?.code ?? null;
  const activePhaseEndsAt = roomSummary?.game?.phaseEndsAt ?? null;
  const activePhaseInstanceId = roomSummary?.game?.phaseInstanceId ?? null;
  const activeRealtimeSubscriptionKey = toRealtimeSubscriptionKey(roomSummary?.realtime ?? null);

  useEffect(() => {
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
      } catch (error) {
        if (!isCancelled) {
          if (isUnauthorizedRequestError(error)) {
            resetInvalidIdentity();
            return;
          }

          if (isNotFoundRequestError(error)) {
            clearCurrentRoom({ ignoredRoomCode: activeRoomCode });
            showToast(roomClosedStatusMessage, "warning", TOAST_IMPORTANT_DURATION_MS);
            return;
          }

          const nextStatusMessage = t.live.room.syncFailed;

          showToast(nextStatusMessage, "warning", TOAST_IMPORTANT_DURATION_MS);
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
  }, [
    activeRoomCode,
    clearCurrentRoom,
    identityToken,
    rememberRoom,
    resetInvalidIdentity,
    roomClosedStatusMessage,
    showToast,
    t,
  ]);

  useEffect(() => {
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
      } catch (error) {
        if (!isCancelled && isUnauthorizedRequestError(error)) {
          resetInvalidIdentity();
        }
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
  }, [
    activeRoomCode,
    identityToken,
    rememberRoom,
    resetInvalidIdentity,
    roomSummary?.currentPlayerId,
  ]);

  useEffect(() => {
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
      } catch (error) {
        if (!isCancelled) {
          if (isUnauthorizedRequestError(error)) {
            resetInvalidIdentity();
            return;
          }

          if (isNotFoundRequestError(error)) {
            clearCurrentRoom({ ignoredRoomCode: activeRoomCode });
            showToast(roomClosedStatusMessage, "warning", TOAST_IMPORTANT_DURATION_MS);
            return;
          }

          const nextStatusMessage = t.live.status.realtimeFailed;

          showToast(nextStatusMessage, "warning", TOAST_IMPORTANT_DURATION_MS);
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
  }, [
    activeRealtimeSubscriptionKey,
    activeRoomCode,
    clearCurrentRoom,
    identityToken,
    rememberRoom,
    resetInvalidIdentity,
    roomClosedStatusMessage,
    showToast,
    t,
  ]);

  useEffect(() => {
    if (identityToken === null || activeRoomCode === null || activePhaseEndsAt === null) {
      return;
    }

    let isCancelled = false;
    const activeToken = identityToken;
    const delayMs = Math.max(Date.parse(activePhaseEndsAt) - Date.now() + 600, 0);
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          const summary = await apiFetch<RoomSummary>(`/api/rooms/${activeRoomCode}`, {
            method: "GET",
            token: activeToken,
          });

          if (!isCancelled) {
            rememberRoom(summary, { resetActionTargets: false });
          }
        } catch (error) {
          if (!isCancelled) {
            if (isUnauthorizedRequestError(error)) {
              resetInvalidIdentity();
              return;
            }
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
    rememberRoom,
    resetInvalidIdentity,
    t,
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

  function handleCreateRoom(): void {
    void withBusy(async () => {
      if (roomSummary !== null || savedRoomCode !== null) {
        const nextStatusMessage = t.live.room.currentAlreadyExistsCreate;

        showToast(nextStatusMessage, "warning");
        return;
      }

      const summary = await withFreshIdentityToken((token) =>
        apiFetch<RoomSummary>("/api/rooms", {
          body: { displayName, targetPlayerCount },
          method: "POST",
          token,
        }),
      );

      ignoredRoomCodeRef.current = null;
      rememberRoom(summary);
    });
  }

  function handleJoinRoom(): void {
    void withBusy(async () => {
      if (roomSummary !== null || savedRoomCode !== null) {
        const nextStatusMessage = t.live.room.currentAlreadyExistsJoin;

        showToast(nextStatusMessage, "warning");
        return;
      }

      const roomCode = requireRoomCode(roomCodeInput, t);
      const summary = await withFreshIdentityToken((token) =>
        apiFetch<RoomSummary>(`/api/rooms/${roomCode}/join`, {
          body: { displayName },
          method: "POST",
          token,
        }),
      );

      ignoredRoomCodeRef.current = null;
      rememberRoom(summary);
    });
  }

  function handleRefreshRoom(): void {
    void withBusy(async () => {
      const token = await ensureIdentityToken();
      const roomCode = requireRoomCode(roomSummary?.code ?? roomCodeInput, t);

      try {
        const summary = await apiFetch<RoomSummary>(`/api/rooms/${roomCode}`, {
          method: "GET",
          token,
        });

        rememberRoom(summary);
      } catch (error) {
        if (isNotFoundRequestError(error)) {
          clearCurrentRoom({ ignoredRoomCode: roomCode });
          showToast(roomClosedStatusMessage, "warning", TOAST_IMPORTANT_DURATION_MS);
          return;
        }

        throw error;
      }
    });
  }

  function handleStartGame(): void {
    void withBusy(async () => {
      const token = await ensureIdentityToken();
      const roomCode = requireRoomCode(roomSummary?.code ?? roomCodeInput, t);
      const summary = await apiFetch<RoomSummary>(`/api/rooms/${roomCode}/start`, {
        body: { ruleSet: buildStartRuleSetInput(startRuleSetSettings) },
        method: "POST",
        token,
      });

      rememberRoom(summary);
    });
  }

  function handleLeaveRoom(): void {
    void withBusy(async () => {
      const token = await ensureIdentityToken();
      const roomCode = requireRoomCode(roomSummary?.code ?? roomCodeInput, t);
      await apiFetch<RoomSummary>(`/api/rooms/${roomCode}/leave`, {
        method: "POST",
        token,
      });

      clearCurrentRoom({ ignoredRoomCode: roomCode });
    });
  }

  function handleSubmitAction(action: PublicAction): void {
    void withBusy(async () => {
      const token = await ensureIdentityToken();
      const roomCode = requireRoomCode(roomSummary?.code ?? roomCodeInput, t);
      const expectedRevision = roomSummary?.game?.revision;
      const targetPlayerId = action.targetKind === "single_player" ? getActionTarget(action) : null;

      if (expectedRevision === undefined) {
        throw new Error(t.live.status.actionWindowClosed);
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
    });
  }

  function handleSendNightConversation(conversation: NightConversationView): void {
    void withBusy(async () => {
      const token = await ensureIdentityToken();
      const roomCode = requireRoomCode(roomSummary?.code ?? roomCodeInput, t);
      const phaseInstanceId = roomSummary?.game?.phaseInstanceId;

      if (phaseInstanceId === null || phaseInstanceId === undefined) {
        throw new Error(t.live.status.nightChatClosed);
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
    });
  }

  async function handleCopyRoomCode(roomCode: string): Promise<void> {
    const didCopy = await writeClipboardText(roomCode);

    if (didCopy) {
      if (copiedInviteResetTimerRef.current !== null) {
        window.clearTimeout(copiedInviteResetTimerRef.current);
      }

      setCopiedInviteRoomCode(roomCode);
      copiedInviteResetTimerRef.current = window.setTimeout(() => {
        setCopiedInviteRoomCode((currentRoomCode) =>
          currentRoomCode === roomCode ? null : currentRoomCode,
        );
        copiedInviteResetTimerRef.current = null;
      }, 1_600);
      return;
    }

    setRoomCodeInput(roomCode);
  }

  async function handleShareRoom(roomCode: string): Promise<void> {
    const roomUrl = getLiveRoomUrl(roomCode, window.location.origin);
    const inviteText = t.live.invite.inviteText(roomCode, roomUrl);

    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          text: t.live.invite.shareText(roomCode),
          title: "Jinroh Web",
          url: roomUrl,
        });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
      }
    }

    const didCopy = await writeClipboardText(inviteText);

    if (didCopy) {
      return;
    }

    setRoomCodeInput(roomCode);
  }

  function getActionTarget(action: PublicAction): string {
    return targetByActionKey[action.key] ?? action.eligibleTargetIds[0] ?? "";
  }

  const selfActions = roomSummary?.self?.actions ?? [];
  const roomStatusLabel = formatRoomStatus(roomSummary, t);
  const liveGuidance = getLiveGuidance(roomSummary, selfActions.length, isBusy, t);
  const canStartGame = !isBusy && canStartRoom(roomSummary);
  const canConfigureStartSettings = roomSummary?.isHost === true && roomSummary.status === "lobby";
  const isGameSurface =
    roomSummary !== null &&
    roomSummary.game !== null &&
    (roomSummary.status === "playing" || roomSummary.status === "ended");
  const controlHint = getControlHint(roomSummary, isBusy, t);
  const liveMood = getLiveMood(roomSummary);
  const isRoomEntryAvailable = roomSummary === null && savedRoomCode === null;
  const liveGridClassName = getLiveGridClassName(roomSummary);
  const roomInviteUrl =
    liveOrigin === null || roomSummary === null
      ? null
      : getLiveRoomUrl(roomSummary.code, liveOrigin);

  return (
    <main className={`liveShell liveMood-${liveMood}`} data-live-mood={liveMood}>
      <section className={isGameSurface ? "liveHero liveHeroUtility" : "liveHero"}>
        <div className="liveHeroTitle">
          <h1 className={isGameSurface ? "srOnly" : undefined}>
            {getLivePageTitle(roomSummary, t)}
          </h1>
          {isGameSurface ? null : <p>{roomStatusLabel}</p>}
        </div>
        <LanguageSwitcher />
      </section>

      {isGameSurface ? null : (
        <>
          {isRoomEntryAvailable ? (
            <LiveSetupSurface
              displayName={displayName}
              isBusy={isBusy}
              roomCodeInput={roomCodeInput}
              t={t}
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
              </section>
            </div>
          )}
        </>
      )}

      {isRoomEntryAvailable ? null : (
        <div className={liveGridClassName}>
          {roomSummary === null ? (
            <section className="livePanel liveRoomPanel" aria-label={t.live.aria.roomState}>
              <div className="livePanelHeading">
                <span>{t.live.page.roomSetup}</span>
                <strong>{roomStatusLabel}</strong>
              </div>

              {savedRoomCode === null ? null : (
                <SavedRoomState isCompact roomCode={savedRoomCode} t={t} />
              )}
            </section>
          ) : null}

          {roomSummary?.status === "lobby" ? (
            <>
              <section className="livePanel liveInvitePanel" aria-label={t.live.aria.invite}>
                <div className="livePanelHeading">
                  <span>{t.live.aria.invite}</span>
                  <div className="livePanelHeadingActions">
                    <strong>{roomStatusLabel}</strong>
                    <button
                      className="secondaryButton liveCompactButton"
                      type="button"
                      onClick={handleRefreshRoom}
                      disabled={isBusy}
                    >
                      {t.live.buttons.refresh}
                    </button>
                  </div>
                </div>

                <RoomInviteTools
                  copiedRoomCode={copiedInviteRoomCode}
                  roomUrl={roomInviteUrl}
                  summary={roomSummary}
                  t={t}
                  onCopyRoomCode={handleCopyRoomCode}
                  onShareRoom={handleShareRoom}
                />
                <LobbyRequirements summary={roomSummary} t={t} />
              </section>

              <section className="livePanel liveSeatPanel" aria-label={t.live.aria.lobbySeats}>
                <div className="livePanelHeading">
                  <span>{t.game.phase.lobby}</span>
                  <strong>
                    {t.live.lobby.seated(
                      countJoinedPlayers(roomSummary),
                      roomSummary.targetPlayerCount,
                    )}
                  </strong>
                </div>
                <PlayerSeatGrid summary={roomSummary} t={t} />
              </section>
            </>
          ) : null}

          {roomSummary?.status === "lobby" ? (
            <section className="livePanel liveControlPanel" aria-label={t.live.aria.lobbyControls}>
              <div className="livePanelHeading">
                <span>
                  {roomSummary.isHost ? t.live.lobby.hostControls : t.live.lobby.playerControls}
                </span>
                <div className="livePanelHeadingActions">
                  <strong>{roomSummary.isHost ? t.live.lobby.host : t.live.lobby.player}</strong>
                  {canConfigureStartSettings ? (
                    <button
                      className="secondaryButton liveCompactButton"
                      aria-controls="start-settings-dialog"
                      aria-expanded={isStartSettingsOpen}
                      aria-haspopup="dialog"
                      type="button"
                      onClick={() => setIsStartSettingsOpen(true)}
                    >
                      {t.live.buttons.settings}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="liveLobbyPanel">
                <strong>
                  {roomSummary.isHost
                    ? t.live.lobby.startWhenEveryoneSeated
                    : t.live.lobby.waitingForHost}
                </strong>
                {canStartGame ? null : <p>{controlHint}</p>}
              </div>

              <div className="liveLobbyActions">
                {roomSummary.isHost ? (
                  <button
                    className="primaryLiveButton"
                    aria-describedby={canStartGame ? undefined : "control-hint"}
                    type="button"
                    onClick={handleStartGame}
                    disabled={!canStartGame}
                  >
                    {t.live.buttons.startGame}
                  </button>
                ) : null}
                <button
                  className="dangerButton"
                  type="button"
                  onClick={handleLeaveRoom}
                  disabled={isBusy}
                >
                  {t.live.buttons.leaveRoom}
                </button>
              </div>
              {canStartGame ? null : (
                <p className="srOnly" id="control-hint">
                  {controlHint}
                </p>
              )}
            </section>
          ) : null}

          {roomSummary !== null && isGameSurface ? (
            <LivePlaySurface
              isBusy={isBusy}
              isNightConversationOpen={isNightConversationOpen}
              isPublicLogOpen={isPublicLogOpen}
              nightConversationDraft={nightConversationDraft}
              selfActions={selfActions}
              summary={roomSummary}
              targetByActionKey={targetByActionKey}
              locale={locale}
              t={t}
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
          defaultRoleCounts={roomSummary.defaultRoleCounts}
          playerCount={roomSummary.targetPlayerCount}
          roleCatalog={roomSummary.roleCatalog}
          settings={startRuleSetSettings}
          t={t}
          onClose={() => setIsStartSettingsOpen(false)}
          onApplySettings={(nextSettings) => setStartRuleSetSettings(nextSettings)}
        />
      ) : null}

      <LiveToastRegion toast={toast} t={t} onDismiss={dismissToast} />
    </main>
  );
}

function LiveToastRegion({
  toast,
  t,
  onDismiss,
}: {
  readonly toast: LiveToast | null;
  readonly t: Localization;
  readonly onDismiss: () => void;
}) {
  if (toast === null) {
    return null;
  }

  return (
    <div
      className="liveToastViewport"
      aria-label={t.live.aria.notifications}
      aria-live={toast.tone === "error" ? "assertive" : "polite"}
    >
      <section
        className="liveToast"
        data-tone={toast.tone}
        role={toast.tone === "error" ? "alert" : "status"}
      >
        <span className="liveToastTone">{t.live.toast.tones[toast.tone]}</span>
        <p>{toast.message}</p>
        <button
          className="secondaryButton liveIconButton liveToastClose"
          aria-label={t.live.buttons.dismissNotification}
          type="button"
          onClick={onDismiss}
        >
          <span aria-hidden="true">X</span>
        </button>
      </section>
    </div>
  );
}

function StartSettingsDialog({
  defaultRoleCounts,
  playerCount,
  roleCatalog,
  settings,
  t,
  onClose,
  onApplySettings,
}: {
  readonly defaultRoleCounts: Readonly<RoleCounts>;
  readonly playerCount: number;
  readonly roleCatalog: readonly RoleCatalogItem[];
  readonly settings: StartRuleSetSettings;
  readonly t: Localization;
  readonly onClose: () => void;
  readonly onApplySettings: (settings: StartRuleSetSettings) => void;
}) {
  const [activeTab, setActiveTab] = useState<StartSettingsTab>("general");
  const [draftSettings, setDraftSettings] = useState<StartRuleSetSettings>(() => ({
    ...settings,
    roleCounts: { ...settings.roleCounts },
  }));
  const canApplySettings =
    getStartRuleSetValidationMessages(draftSettings, playerCount, roleCatalog, defaultRoleCounts, t)
      .length === 0;

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
        ...getEffectiveStartRoleCounts(currentSettings, roleCatalog, defaultRoleCounts),
        [roleId]: clampRoleCount(roleId, value, playerCount, roleCatalog),
      },
    }));
  }

  function handleDraftRolePresetSelect(preset: RolePreset): void {
    setDraftSettings((currentSettings) => ({
      ...currentSettings,
      roleCounts: expandRolePresetCounts(preset, getRoleIdsFromCatalog(roleCatalog)),
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
            <span>{t.live.lobby.hostControls}</span>
            <h2 id="start-settings-title">{t.live.settings.title}</h2>
            <p>{t.live.settings.description}</p>
          </div>
          <div className="liveSettingsHeaderActions">
            <span className="liveSettingsRoomBadge">{t.live.settings.seats(playerCount)}</span>
            <button
              className="secondaryButton liveIconButton"
              aria-label={t.live.buttons.closeSettings}
              type="button"
              onClick={onClose}
            >
              <span aria-hidden="true">X</span>
            </button>
          </div>
        </div>

        <div className="liveSettingsTabs" role="tablist" aria-label={t.live.aria.settingsSections}>
          {START_SETTINGS_TABS.map((tab) => (
            <button
              aria-controls={`start-settings-${tab}-panel`}
              aria-selected={activeTab === tab}
              className={activeTab === tab ? "active" : ""}
              id={`start-settings-${tab}-tab`}
              key={tab}
              role="tab"
              type="button"
              onClick={() => setActiveTab(tab)}
            >
              {t.live.settings.tabs[tab]}
            </button>
          ))}
        </div>

        <div className="liveSettingsBody">
          <StartRuleSetPanel
            activeTab={activeTab}
            defaultRoleCounts={defaultRoleCounts}
            playerCount={playerCount}
            roleCatalog={roleCatalog}
            settings={draftSettings}
            onNumberChange={handleDraftNumberChange}
            onRoleCountChange={handleDraftRoleCountChange}
            onRolePresetSelect={handleDraftRolePresetSelect}
            onSettingsChange={handleDraftSettingsChange}
            t={t}
          />
        </div>

        <div className="liveSettingsFooter">
          <button
            className="secondaryButton"
            type="button"
            onClick={() => setDraftSettings({ ...DEFAULT_START_RULE_SET_SETTINGS, roleCounts: {} })}
          >
            {t.live.buttons.reset}
          </button>
          <div>
            <button className="secondaryButton" type="button" onClick={onClose}>
              {t.live.buttons.cancel}
            </button>
            <button type="button" disabled={!canApplySettings} onClick={handleApplySettings}>
              {t.live.buttons.applySettings}
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
  t,
  title,
  onClose,
}: {
  readonly children: ReactNode;
  readonly id: string;
  readonly meta: string;
  readonly t: Localization;
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
            aria-label={t.live.buttons.closeDialog(title)}
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
  t,
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
  const normalizedDisplayName = displayName.trim() || t.live.setup.player;
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
    <section className="liveSetupSurface" aria-label={t.live.aria.roomSetup}>
      <section className="liveSetupActionGrid" aria-label={t.live.aria.roomActions}>
        <article className="liveSetupPanel liveSetupProfilePanel">
          <div className="liveSetupPanelHeader">
            <div>
              <p className="liveSetupPanelKicker">{t.live.setup.player}</p>
              <h3>{t.live.setup.yourSeat}</h3>
            </div>
          </div>
          <div className="liveSetupPanelBody">
            <label className="liveSetupField">
              {t.live.setup.displayName}
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
                <p className="liveSetupProfileNote">{t.live.setup.profileNote}</p>
              </div>
            </div>
            <p className="liveSetupHint">{t.live.setup.useIdentityHint}</p>
          </div>
        </article>

        <article className="liveSetupPanel">
          <div className="liveSetupPanelHeader">
            <div>
              <p className="liveSetupPanelKicker">{t.live.setup.host}</p>
              <h3>{t.live.setup.createTitle}</h3>
            </div>
            <div className="liveSetupPanelIcon" aria-hidden="true">
              +
            </div>
          </div>
          <div className="liveSetupPanelBody">
            <label className="liveSetupField">
              {t.live.setup.players}
              <select
                value={targetPlayerCount}
                onChange={(event) => onTargetPlayerCountChange(Number(event.target.value))}
              >
                {PLAYER_COUNT_OPTIONS.map((playerCount) => (
                  <option key={playerCount} value={playerCount}>
                    {playerCount}
                  </option>
                ))}
              </select>
            </label>
            <p className="liveSetupHint">{t.live.setup.createHint}</p>
            <div className="liveSetupButtonRow">
              <button
                className="liveSetupButton liveSetupButtonPrimary"
                type="button"
                onClick={onCreateRoom}
                disabled={isBusy}
              >
                {t.live.buttons.createRoom}
              </button>
            </div>
          </div>
        </article>

        <article className="liveSetupPanel">
          <div className="liveSetupPanelHeader">
            <div>
              <p className="liveSetupPanelKicker">{t.live.setup.guest}</p>
              <h3>{t.live.setup.joinTitle}</h3>
            </div>
            <div className="liveSetupPanelIcon" aria-hidden="true">
              -&gt;
            </div>
          </div>
          <div className="liveSetupPanelBody">
            <div className="liveSetupField">
              <span id="live-room-code-label">{t.live.setup.roomCode}</span>
              <div className="liveSetupCodeGrid" aria-labelledby="live-room-code-label">
                {roomCodeDigits.map((digit, index) => (
                  <input
                    aria-label={t.live.setup.roomCodeDigit(index + 1)}
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
            <p className="liveSetupHint">{t.live.setup.joinHint}</p>
            <div className="liveSetupButtonRow">
              <button
                className="liveSetupButton liveSetupButtonSecondary"
                type="button"
                onClick={() => onRoomCodeChange("")}
                disabled={isBusy || roomCodeInput.length === 0}
              >
                {t.live.buttons.clear}
              </button>
              <button
                className="liveSetupButton liveSetupButtonPrimary"
                type="button"
                onClick={onJoinRoom}
                disabled={isJoinDisabled}
              >
                {t.live.buttons.joinRoom}
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
  t,
}: {
  readonly isCompact?: boolean;
  readonly roomCode: string;
  readonly t: Localization;
}) {
  return (
    <div className={isCompact ? "liveEmptyState compact" : "liveEmptyState"}>
      <strong>{t.live.room.restoring(roomCode)}</strong>
    </div>
  );
}

function RoomInviteTools({
  copiedRoomCode,
  roomUrl,
  summary,
  t,
  onCopyRoomCode,
  onShareRoom,
}: {
  readonly copiedRoomCode: string | null;
  readonly roomUrl: string | null;
  readonly summary: RoomSummary;
  readonly t: Localization;
  readonly onCopyRoomCode: (roomCode: string) => void;
  readonly onShareRoom: (roomCode: string) => void;
}) {
  const didCopyCurrentRoom = copiedRoomCode === summary.code;

  return (
    <div className="liveInviteTools" aria-label={t.live.aria.roomInviteTools}>
      <div>
        <span>{t.live.invite.codeLabel}</span>
        <strong>{summary.code}</strong>
        {roomUrl === null ? null : (
          <div className="liveInviteQrCode" aria-hidden="true">
            <QRCodeSVG
              bgColor="#ffffff"
              fgColor="#000000"
              level="M"
              marginSize={4}
              size={136}
              value={roomUrl}
            />
          </div>
        )}
      </div>
      <div>
        <button
          className={didCopyCurrentRoom ? "secondaryButton liveCopiedButton" : "secondaryButton"}
          type="button"
          onClick={() => onCopyRoomCode(summary.code)}
        >
          {didCopyCurrentRoom ? t.live.buttons.copied : t.live.buttons.copyCode}
        </button>
        <button className="secondaryButton" type="button" onClick={() => onShareRoom(summary.code)}>
          {t.live.buttons.shareInvite}
        </button>
      </div>
    </div>
  );
}

function LobbyRequirements({
  summary,
  t,
}: {
  readonly summary: RoomSummary;
  readonly t: Localization;
}) {
  const joinedPlayerCount = countJoinedPlayers(summary);
  const requiredPlayers = Math.max(summary.targetPlayerCount - joinedPlayerCount, 0);
  const progressPercent = Math.min(
    100,
    Math.round((joinedPlayerCount / summary.targetPlayerCount) * 100),
  );

  return (
    <div className="liveLobbyRequirements">
      <div>
        <span>{t.live.invite.requirement}</span>
        <strong>
          {requiredPlayers === 0
            ? t.live.invite.allSeatsFilled
            : t.live.invite.morePlayersNeeded(requiredPlayers)}
        </strong>
      </div>
      <div
        className="liveProgressTrack"
        aria-label={t.live.invite.progressLabel(joinedPlayerCount, summary.targetPlayerCount)}
      >
        <span style={{ width: `${progressPercent}%` }} />
      </div>
    </div>
  );
}

function LivePlaySurface({
  isBusy,
  isNightConversationOpen,
  isPublicLogOpen,
  locale,
  nightConversationDraft,
  selfActions,
  summary,
  targetByActionKey,
  t,
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
  const phaseGuidance = getPlayPhaseGuidance(summary, isBusy, t);
  const nightConversation = summary.rolePrivate?.nightConversation ?? null;
  const publicEventCount = summary.game?.events.length ?? 0;

  return (
    <>
      <section className="livePanel livePlayTablePanel" aria-label={t.live.aria.liveGameTable}>
        <LiveRoundTable summary={summary} t={t} />
      </section>

      <div className="livePlaySideStack">
        <section className="livePanel livePlayPhasePanel" aria-label={t.live.aria.currentPhase}>
          <div className="livePanelHeading">
            <span>{t.live.aria.currentPhase}</span>
          </div>

          <div className="livePlayPhaseCard" aria-live="polite">
            <div>
              <span className="srOnly">{phaseGuidance.label}</span>
              <strong>{phaseGuidance.message}</strong>
            </div>
            {phaseEndsAt === null ? null : (
              <time dateTime={phaseEndsAt}>
                <PhaseCountdown key={phaseEndsAt} phaseEndsAt={phaseEndsAt} t={t} />
              </time>
            )}
            {actionProgress === null ? null : (
              <em>
                {getLocalizedActionProgressLabel(t, actionProgress.kind)}:{" "}
                {formatActionProgress(actionProgress, t)}
              </em>
            )}
          </div>
        </section>

        {summary.self?.roleId === null || summary.self?.roleId === undefined ? null : (
          <section
            className="livePanel liveSelfRolePanel"
            aria-label={`${t.live.player.yourRole}: ${getLocalizedRole(t, summary.self.roleId).name}`}
          >
            <span>{t.live.player.yourRole}</span>
            <strong>{getLocalizedRole(t, summary.self.roleId).name}</strong>
          </section>
        )}

        {selfActions.length === 0 ? null : (
          <section
            className="livePanel liveNightActionPanel"
            aria-label={getActionPanelTitle(summary, t)}
          >
            <div className="livePanelHeading">
              <span>{getActionPanelTitle(summary, t)}</span>
            </div>

            <div className="liveNightActionStack">
              <ActionList
                actions={selfActions}
                isBusy={isBusy}
                players={summary.players}
                targetByActionKey={targetByActionKey}
                t={t}
                onSubmitAction={onSubmitAction}
                onTargetChange={onTargetChange}
              />
            </div>
          </section>
        )}

        <div className="livePopupActions" aria-label={t.live.aria.popupPanels}>
          {nightConversation === null ? null : (
            <button className="secondaryButton" type="button" onClick={onOpenNightConversation}>
              {t.live.buttons.nightChat}
            </button>
          )}
          <button className="secondaryButton" type="button" onClick={onOpenPublicLog}>
            {t.live.buttons.publicLog}
            <em>{publicEventCount}</em>
          </button>
        </div>
      </div>

      {nightConversation !== null && isNightConversationOpen ? (
        <LivePopupDialog
          id="night-chat-dialog"
          meta={nightConversation.readOnly ? t.live.nightConversation.readOnly : t.game.phase.night}
          t={t}
          title={getLocalizedNightConversationLabel(t, nightConversation.labelKey)}
          onClose={onCloseNightConversation}
        >
          <NightConversationPanel
            conversation={nightConversation}
            draft={nightConversationDraft}
            isBusy={isBusy}
            locale={locale}
            t={t}
            onDraftChange={onNightConversationDraftChange}
            onSend={onSendNightConversation}
          />
        </LivePopupDialog>
      ) : null}

      {isPublicLogOpen ? (
        <LivePopupDialog
          id="public-log-dialog"
          meta={t.live.eventLog.meta(publicEventCount)}
          t={t}
          title={t.live.eventLog.title}
          onClose={onClosePublicLog}
        >
          <EventLog locale={locale} summary={summary} t={t} />
        </LivePopupDialog>
      ) : null}
    </>
  );
}

function LiveRoundTable({
  summary,
  t,
}: {
  readonly summary: RoomSummary;
  readonly t: Localization;
}) {
  const playerCount = summary.players.length;

  return (
    <div className="tableBoard liveTableBoard">
      <div className="tableSurface liveTableSurface">
        <div className="tableCenter liveTableCenter">
          <span className={`liveTablePhaseIcon ${getLiveMood(summary)}`} aria-hidden="true" />
          <strong>{getLiveTableTitle(summary, t)}</strong>
        </div>

        {summary.players.map((player, index) => {
          const position = getRoundTableSeatPosition(index, playerCount);
          const seatPresentation = getLiveSeatPresentation(player, summary, t);
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
            seatPresentation.state,
            player.isHost ? "host" : "",
            player.isCurrent ? "selected" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <div
              className={seatClassName}
              key={player.id}
              style={seatStyle}
              aria-label={[player.displayName, ...seatPresentation.ariaLabels].join(", ")}
            >
              <span className="seatNumber">{index + 1}</span>
              <span className="avatar" aria-hidden="true">
                {getPlayerInitial(player.displayName)}
              </span>
              <span className="seatLabel">
                <strong>{player.displayName}</strong>
                {seatPresentation.visibleLabel === null ? null : (
                  <small>{seatPresentation.visibleLabel}</small>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PhaseCountdown({
  phaseEndsAt,
  t,
}: {
  readonly phaseEndsAt: string | null;
  readonly t: Localization;
}) {
  const [currentTimeMs, setCurrentTimeMs] = useState(() => Date.now());

  useEffect(() => {
    if (phaseEndsAt === null) {
      return;
    }

    const intervalId = window.setInterval(() => setCurrentTimeMs(Date.now()), 1_000);

    return () => window.clearInterval(intervalId);
  }, [phaseEndsAt]);

  return <>{formatPhaseCountdown(phaseEndsAt, currentTimeMs, t)}</>;
}

function PlayerSeatGrid({
  summary,
  t,
}: {
  readonly summary: RoomSummary;
  readonly t: Localization;
}) {
  const joinedPlayers = summary.players.filter((player) => player.status === "joined");
  const emptySeats = Array.from(
    { length: Math.max(summary.targetPlayerCount - joinedPlayers.length, 0) },
    (unusedValue, index) => {
      void unusedValue;

      return index + joinedPlayers.length + 1;
    },
  );

  return (
    <div className="liveSeatGrid" aria-label={t.live.aria.lobbySeats}>
      {joinedPlayers.map((player, index) => (
        <div className={player.isCurrent ? "liveSeatCard current" : "liveSeatCard"} key={player.id}>
          <span className="liveAvatar" aria-hidden="true">
            {player.displayName.slice(0, 1)}
          </span>
          <span>
            <strong>{player.displayName}</strong>
            <small>{t.live.lobby.seat(index + 1)}</small>
          </span>
          <em>{player.isHost ? t.live.lobby.host : t.live.lobby.player}</em>
        </div>
      ))}
      {emptySeats.map((seatNumber) => (
        <div className="liveSeatCard empty" key={`empty-${seatNumber}`}>
          <span className="liveAvatar" aria-hidden="true" />
          <span>
            <strong>{t.live.lobby.openSeat}</strong>
            <small>{t.live.lobby.seat(seatNumber)}</small>
          </span>
          <em>{t.live.lobby.open}</em>
        </div>
      ))}
    </div>
  );
}

function StartRuleSetPanel({
  activeTab,
  defaultRoleCounts,
  playerCount,
  roleCatalog,
  settings,
  t,
  onNumberChange,
  onRoleCountChange,
  onRolePresetSelect,
  onSettingsChange,
}: {
  readonly activeTab: StartSettingsTab;
  readonly defaultRoleCounts: Readonly<RoleCounts>;
  readonly playerCount: number;
  readonly roleCatalog: readonly RoleCatalogItem[];
  readonly settings: StartRuleSetSettings;
  readonly t: Localization;
  readonly onNumberChange: (key: RuleSetNumberField, value: number) => void;
  readonly onRoleCountChange: (roleId: RoleId, value: number) => void;
  readonly onRolePresetSelect: (preset: RolePreset) => void;
  readonly onSettingsChange: <Key extends keyof StartRuleSetSettings>(
    key: Key,
    value: StartRuleSetSettings[Key],
  ) => void;
}) {
  const canPreviewRoleMix = playerCount >= MIN_ROOM_PLAYERS && playerCount <= MAX_ROOM_PLAYERS;
  const startRoleCatalog = getStartRoleCatalog(roleCatalog);
  const startRoleIds = startRoleCatalog.map((role) => role.id);
  const roleCounts = canPreviewRoleMix
    ? getEffectiveStartRoleCounts(settings, roleCatalog, defaultRoleCounts)
    : null;
  const rolePresets = getRolePresetsForPlayerCount(playerCount, startRoleIds);
  const selectedRolePreset =
    roleCounts === null ? null : getMatchingRolePreset(playerCount, roleCounts, startRoleIds);
  const assignedRoleCount =
    roleCounts === null
      ? 0
      : startRoleCatalog.reduce((total, role) => total + getRoleCount(roleCounts, role.id), 0);
  const roleValidationMessages = getStartRuleSetValidationMessages(
    settings,
    playerCount,
    roleCatalog,
    defaultRoleCounts,
    t,
  );
  const activeRoleOptions =
    roleCounts === null ? [] : getActiveRoleSpecificOptions(roleCatalog, roleCounts);
  const isRoleMixValid = roleValidationMessages.length === 0;
  const displayedRoleValidationMessages = isRoleMixValid
    ? [t.live.settings.validation.validForLobby]
    : roleValidationMessages;
  const flowItems = getSettingsFlowItems(settings, t);

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
            <h3>{t.live.settings.general.heading}</h3>
            <p>{t.live.settings.general.summary}</p>
          </div>
        </div>

        <div className="liveSettingsGridTwo">
          <article className="liveSettingsCard">
            <h4>{t.live.settings.general.dayProgressionTitle}</h4>
            <p>{t.live.settings.general.dayProgressionBody}</p>

            <div className="liveSettingsChoiceGrid">
              <label className="liveSettingsChoice">
                <input
                  checked={settings.dayMode === "ordered_speech"}
                  name="dayMode"
                  type="radio"
                  value="ordered_speech"
                  onChange={() => onSettingsChange("dayMode", "ordered_speech")}
                />
                <span>{t.live.settings.dayMode.ordered.label}</span>
                <strong>{t.live.settings.dayMode.ordered.title}</strong>
                <em>{t.live.settings.dayMode.ordered.body}</em>
              </label>

              <label className="liveSettingsChoice">
                <input
                  checked={settings.dayMode === "ready_check"}
                  name="dayMode"
                  type="radio"
                  value="ready_check"
                  onChange={() => onSettingsChange("dayMode", "ready_check")}
                />
                <span>{t.live.settings.dayMode.readyCheck.label}</span>
                <strong>{t.live.settings.dayMode.readyCheck.title}</strong>
                <em>{t.live.settings.dayMode.readyCheck.body}</em>
              </label>
            </div>
          </article>

          <article className="liveSettingsCard">
            <h4>{t.live.settings.general.voteDetailTitle}</h4>
            <p>{t.live.settings.general.voteDetailBody}</p>
            <label className="liveRuleSetField">
              <span>{t.live.settings.general.voteVisibility}</span>
              <select
                value={settings.voteResultVisibility}
                onChange={(event) =>
                  onSettingsChange(
                    "voteResultVisibility",
                    event.target.value as StartRuleSetSettings["voteResultVisibility"],
                  )
                }
              >
                <option value="count_only">
                  {t.live.settings.general.voteVisibilityCountOnly}
                </option>
                <option value="voter_to_target">
                  {t.live.settings.general.voteVisibilityVoterToTarget}
                </option>
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
            <h3>{t.live.settings.timers.heading}</h3>
            <p>{t.live.settings.timers.summary}</p>
          </div>
        </div>

        <div className="liveSettingsMainSide">
          <div className="liveSettingsStack">
            <article className="liveSettingsCard">
              <h4>{t.live.settings.timers.commonTitle}</h4>
              <p>{t.live.settings.timers.commonBody}</p>
              <div className="liveTimingGrid common" aria-label={t.live.aria.commonPhaseTiming}>
                <RuleSetNumberControl
                  field="firstNightSeconds"
                  label={t.live.settings.timers.firstNight}
                  value={settings.firstNightSeconds}
                  onChange={onNumberChange}
                />
                <RuleSetNumberControl
                  field="nightSeconds"
                  label={t.live.settings.timers.night}
                  value={settings.nightSeconds}
                  onChange={onNumberChange}
                />
                <RuleSetNumberControl
                  field="votingSeconds"
                  label={t.live.settings.timers.vote}
                  value={settings.votingSeconds}
                  onChange={onNumberChange}
                />
                <RuleSetNumberControl
                  field="executionLastWordsSeconds"
                  label={t.live.settings.timers.lastWords}
                  value={settings.executionLastWordsSeconds}
                  onChange={onNumberChange}
                />
              </div>
            </article>

            <article className="liveSettingsCard">
              <h4>
                {settings.dayMode === "ordered_speech"
                  ? t.live.settings.timers.orderedSpeech
                  : t.live.settings.timers.readyCheck}
              </h4>
              <p>
                {settings.dayMode === "ordered_speech"
                  ? t.live.settings.timers.orderedSpeechBody
                  : t.live.settings.timers.readyCheckBody}
              </p>
              {settings.dayMode === "ordered_speech" ? (
                <div
                  className="liveTimingGrid day"
                  aria-label={t.live.settings.timers.orderedSpeechTiming}
                >
                  <RuleSetNumberControl
                    field="daySpeechSeconds"
                    label={t.live.settings.timers.speechPerPlayer}
                    value={settings.daySpeechSeconds}
                    onChange={onNumberChange}
                  />
                  <RuleSetNumberControl
                    field="firstDaySpeechRounds"
                    label={t.live.settings.timers.firstDayRounds}
                    value={settings.firstDaySpeechRounds}
                    onChange={onNumberChange}
                  />
                  <RuleSetNumberControl
                    field="normalDaySpeechRounds"
                    label={t.live.settings.timers.normalRounds}
                    value={settings.normalDaySpeechRounds}
                    onChange={onNumberChange}
                  />
                </div>
              ) : (
                <div
                  className="liveTimingGrid day"
                  aria-label={t.live.settings.timers.readyCheckTiming}
                >
                  <RuleSetNumberControl
                    field="dayReadyCheckSecondsPerPlayer"
                    label={t.live.settings.timers.readyPerPlayer}
                    value={settings.dayReadyCheckSecondsPerPlayer}
                    onChange={onNumberChange}
                  />
                </div>
              )}
            </article>
          </div>

          <aside className="liveSettingsCard liveSettingsSticky">
            <h4>{t.live.settings.timers.flowPreview}</h4>
            <p>
              {settings.dayMode === "ordered_speech"
                ? t.live.settings.timers.orderedFlow
                : t.live.settings.timers.readyCheckFlow}
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
          {roleCounts !== null && rolePresets.length > 0 ? (
            <section className="liveSettingsCard liveRolePresetSection">
              <div className="liveRolesHeader">
                <div>
                  <h3>{t.live.settings.roles.presetsTitle}</h3>
                  <p>{t.live.settings.roles.presetsBody}</p>
                </div>
                <span
                  className={
                    selectedRolePreset === null
                      ? "liveRolePresetStatus"
                      : "liveRolePresetStatus is-selected"
                  }
                >
                  {selectedRolePreset === null
                    ? t.live.settings.roles.custom
                    : getLocalizedRolePreset(t, selectedRolePreset.id).name}
                </span>
              </div>

              <div className="liveRolePresetGrid" aria-label={t.live.aria.rolePresets}>
                {rolePresets.map((preset) => {
                  const isSelected = selectedRolePreset?.id === preset.id;
                  const localizedPreset = getLocalizedRolePreset(t, preset.id);
                  const presetRoleEntries = getPresetRoleEntries(
                    preset.roleCounts,
                    startRoleCatalog,
                  );

                  return (
                    <button
                      aria-pressed={isSelected}
                      className={
                        isSelected ? "liveRolePresetCard is-selected" : "liveRolePresetCard"
                      }
                      key={preset.id}
                      type="button"
                      onClick={() => onRolePresetSelect(preset)}
                    >
                      <span className="liveRolePresetMark" aria-hidden="true">
                        {localizedPreset.shortLabel}
                      </span>
                      <span className="liveRolePresetCopy">
                        <strong>{localizedPreset.name}</strong>
                        <em>{localizedPreset.description}</em>
                      </span>
                      <span
                        className="liveRolePresetChips"
                        aria-label={t.live.settings.roles.presetRoleMix(localizedPreset.name)}
                      >
                        {presetRoleEntries.map(({ count, role }) => {
                          const localizedRole = getLocalizedRole(t, role.id);

                          return (
                            <span
                              className="liveRolePresetChip"
                              key={role.id}
                              title={localizedRole.name}
                            >
                              <strong>{count}</strong>
                              {localizedRole.shortLabel}
                            </span>
                          );
                        })}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section className="liveSettingsCard">
            <div className="liveRolesHeader">
              <div>
                <h3>{t.live.settings.roles.countsTitle}</h3>
                <p>{t.live.settings.roles.countsBody}</p>
              </div>
              <span
                className={isRoleMixValid ? "liveRoleTotal is-valid" : "liveRoleTotal is-invalid"}
              >
                <strong>
                  {assignedRoleCount} / {playerCount}
                </strong>{" "}
                {t.live.settings.roles.assigned}
              </span>
            </div>
            <div className="liveRoleGrid" aria-label={t.live.aria.roleCounts}>
              {roleCounts === null ? (
                <div className="liveSettingsEmptyOptions">
                  <strong>{t.live.settings.roles.mixAppearsAt(MIN_ROOM_PLAYERS)}</strong>
                </div>
              ) : (
                startRoleCatalog.map((role) => {
                  const roleId = role.id;
                  const count = getRoleCount(roleCounts, roleId);
                  const localizedRole = getLocalizedRole(t, roleId);
                  const roleName = localizedRole.name;
                  const canDecrease = canChangeRoleCount(
                    roleCounts,
                    roleId,
                    -1,
                    playerCount,
                    roleCatalog,
                  );
                  const canIncrease = canChangeRoleCount(
                    roleCounts,
                    roleId,
                    1,
                    playerCount,
                    roleCatalog,
                  );

                  return (
                    <article
                      className={count === 0 ? "liveRoleCard is-zero" : "liveRoleCard"}
                      key={roleId}
                    >
                      <span className="liveRoleIcon" aria-hidden="true">
                        {localizedRole.shortLabel}
                      </span>
                      <div>
                        <div className="liveRoleName">{roleName}</div>
                        <div className="liveRoleDescription">{localizedRole.description}</div>
                      </div>
                      <div
                        className="liveRoleCounter"
                        aria-label={t.live.settings.roles.count(roleName)}
                      >
                        <button
                          type="button"
                          aria-label={t.live.settings.roles.decrease(roleName)}
                          disabled={!canDecrease}
                          onClick={() => onRoleCountChange(roleId, count - 1)}
                        >
                          -
                        </button>
                        <span>{count}</span>
                        <button
                          type="button"
                          aria-label={t.live.settings.roles.increase(roleName)}
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
                <h3>{t.live.settings.roles.specificTitle}</h3>
                <p>{t.live.settings.roles.specificBody}</p>
              </div>
            </div>
            <div className="liveSettingsOptionGrid">
              {activeRoleOptions.map(({ option, role }) => (
                <div className="liveSettingsOptionCard" key={`${role.id}:${option.key}`}>
                  <h4>
                    {getLocalizedRole(t, role.id).name} -{" "}
                    {getLocalizedRoleOptionLabel(t, role.id, option.key)}
                  </h4>
                  {renderRoleSpecificOptionControl(
                    option,
                    getLocalizedRoleOptionLabel(t, role.id, option.key),
                    settings,
                    onSettingsChange,
                    t,
                  )}
                </div>
              ))}

              {activeRoleOptions.length === 0 ? (
                <div className="liveSettingsEmptyOptions">
                  {t.live.settings.roles.noExtraOptions}
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
              <h3>
                {isRoleMixValid
                  ? t.live.settings.validation.readyToApply
                  : t.live.settings.validation.needsAdjustment}
              </h3>
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
  locale,
  t,
  onDraftChange,
  onSend,
}: {
  readonly conversation: NightConversationView;
  readonly draft: string;
  readonly isBusy: boolean;
  readonly locale: Locale;
  readonly t: Localization;
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
    <div className="liveNightChatPanel" aria-label={t.live.aria.nightConversation}>
      <div className="liveNightChatHeader">
        <strong>{getLocalizedNightConversationLabel(t, conversation.labelKey)}</strong>
        <em>{conversation.readOnly ? t.live.nightConversation.readOnly : t.game.phase.night}</em>
      </div>

      {conversation.messages.length === 0 ? (
        <p>{t.live.nightConversation.noMessages}</p>
      ) : (
        <ol className="liveNightChatMessages">
          {conversation.messages.map((message) => (
            <li key={message.id}>
              <div>
                <strong>{message.senderName}</strong>
                <time dateTime={message.createdAt}>
                  {formatDateTime(message.createdAt, locale, t)}
                </time>
              </div>
              <p>{message.body}</p>
            </li>
          ))}
        </ol>
      )}

      {conversation.canSend ? (
        <div className="liveNightChatComposer">
          <label>
            {t.live.nightConversation.message}
            <input
              maxLength={conversation.maxMessageLength}
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
            />
          </label>
          <button type="button" disabled={!canSend} onClick={() => onSend(conversation)}>
            {t.live.buttons.send}
          </button>
          <small>
            {t.live.nightConversation.draftCount(
              trimmedDraft.length,
              conversation.maxMessageLength,
            )}
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
  t,
  targetByActionKey,
  onTargetChange,
  onSubmitAction,
}: {
  readonly actions: readonly PublicAction[];
  readonly isBusy: boolean;
  readonly players: readonly PublicPlayer[];
  readonly t: Localization;
  readonly targetByActionKey: Record<string, string>;
  readonly onTargetChange: (actionKey: string, playerId: string) => void;
  readonly onSubmitAction: (action: PublicAction) => void;
}) {
  if (actions.length === 0) {
    return null;
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
              <strong>{getLocalizedActionLabel(t, action.kind)}</strong>
              {action.status === "submitted" ? <span>{t.game.actionStatus.submitted}</span> : null}
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
                {action.status === "submitted"
                  ? t.game.actionStatus.locked
                  : t.game.actionStatus.noTarget}
              </span>
            )}

            <button
              type="button"
              onClick={() => onSubmitAction(action)}
              disabled={isBusy || action.status === "submitted"}
            >
              {getActionButtonLabel(action, isBusy, t)}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function EventLog({
  locale,
  summary,
  t,
}: {
  readonly locale: Locale;
  readonly summary: RoomSummary | null;
  readonly t: Localization;
}) {
  const events = summary?.game?.events ?? [];

  if (events.length === 0) {
    return (
      <div className="liveEmptyState compact">
        <strong>{t.live.eventLog.emptyTitle}</strong>
        <p>{t.live.eventLog.emptyBody}</p>
      </div>
    );
  }

  return (
    <ol className="liveEventList">
      {events.map((event) => {
        const display = formatPublicEvent(event, summary?.players ?? [], t);

        return (
          <li key={`${event.kind}:${event.createdAt}`}>
            <time dateTime={event.createdAt}>{formatDateTime(event.createdAt, locale, t)}</time>
            <strong>{display.kindLabel}</strong>
            <p>{display.message}</p>
            {display.details.length === 0 ? null : (
              <dl className="liveEventDetails">
                {display.details.map((detail) => (
                  <div key={`${event.kind}:${event.createdAt}:${detail.label}`}>
                    <dt>{detail.label}</dt>
                    <dd>{detail.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        );
      })}
    </ol>
  );
}

class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.status = status;
  }
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
    const apiError = extractApiError(json, response.status);

    throw new ApiRequestError(apiError.message, response.status, apiError.code);
  }

  return json as Body;
}

function isNotFoundRequestError(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 404;
}

function isUnauthorizedRequestError(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 401;
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

function getLiveRoomUrl(roomCode: string, origin: string): string {
  const url = new URL("/live", origin);

  url.searchParams.set("roomCode", roomCode);

  return url.toString();
}

function getRoomCodeSearchParam(search: string): string | null {
  const roomCode = new URLSearchParams(search).get("roomCode");

  return roomCode !== null && /^\d{6}$/.test(roomCode) ? roomCode : null;
}

function extractApiError(
  value: unknown,
  status: number,
): { readonly code: string; readonly message: string } {
  if (isApiErrorResponse(value)) {
    return {
      code: value.error.code,
      message: value.error.message,
    };
  }

  return {
    code: "unknown",
    message: `Request failed with HTTP ${status}.`,
  };
}

function toRequestFailureMessage(error: unknown, t: Localization): string {
  if (
    error instanceof TypeError ||
    (error instanceof Error && /failed to fetch|load failed|networkerror/iu.test(error.message))
  ) {
    return t.api.networkFailure;
  }

  if (error instanceof ApiRequestError) {
    return formatApiError(error, t);
  }

  return error instanceof Error ? error.message : t.api.errors.unknown;
}

function formatApiError(error: ApiRequestError, t: Localization): string {
  switch (error.code) {
    case "bad_request":
      return t.api.errors.bad_request;
    case "conflict":
      return t.api.errors.conflict;
    case "not_found":
      return t.api.errors.not_found;
    case "server_error":
      return t.api.errors.server_error;
    case "unauthorized":
      return t.api.errors.unauthorized;
    default:
      return t.api.errors.unknown;
  }
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

  return "code" in candidate.error && "message" in candidate.error;
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

function requireRoomCode(roomCode: string, t: Localization): string {
  if (!/^\d{6}$/.test(roomCode)) {
    throw new Error(t.live.room.enterCode);
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
  roleCatalog: readonly RoleCatalogItem[],
  defaultRoleCounts: Readonly<RoleCounts>,
): RoleCounts {
  const roleIds = getRoleIdsFromCatalog(roleCatalog);
  const specifiedRoleCount = roleIds.reduce(
    (total, roleId) => total + getRoleCount(settings.roleCounts, roleId),
    0,
  );

  if (specifiedRoleCount === 0) {
    return buildCatalogRoleCounts(defaultRoleCounts, roleCatalog);
  }

  return buildCatalogRoleCounts(settings.roleCounts, roleCatalog);
}

function getStartRuleSetValidationMessages(
  settings: StartRuleSetSettings,
  playerCount: number,
  roleCatalog: readonly RoleCatalogItem[],
  defaultRoleCounts: Readonly<RoleCounts>,
  t: Localization,
): readonly string[] {
  const startRoleCatalog = getStartRoleCatalog(roleCatalog);
  const roleCounts = getEffectiveStartRoleCounts(settings, roleCatalog, defaultRoleCounts);
  const messages: string[] = [];
  const totalRoles = getRoleCountTotal(roleCounts, startRoleCatalog);

  if (playerCount < MIN_ROOM_PLAYERS || playerCount > MAX_ROOM_PLAYERS) {
    messages.push(
      t.live.settings.validation.availableForPlayers(MIN_ROOM_PLAYERS, MAX_ROOM_PLAYERS),
    );
  }

  if (totalRoles !== playerCount) {
    const diff = playerCount - totalRoles;
    messages.push(
      diff > 0
        ? t.live.settings.validation.addRoles(diff)
        : t.live.settings.validation.removeRoles(Math.abs(diff)),
    );
  }

  for (const definition of startRoleCatalog) {
    const count = getRoleCount(roleCounts, definition.id);
    const maxCount = getRoleMaxCount(definition.id, playerCount, roleCatalog);

    if (!Number.isInteger(count) || count < 0) {
      messages.push(t.live.settings.validation.countNonNegative(definition.name));
    }

    if (count < definition.minCount) {
      messages.push(t.live.settings.validation.countAtLeast(definition.name, definition.minCount));
    }

    if (count > maxCount) {
      messages.push(t.live.settings.validation.countAtMost(definition.name, maxCount));
    }
  }

  return messages;
}

function getRoleCountTotal(
  roleCounts: Readonly<Partial<Record<RoleId, number>>>,
  roleCatalog: readonly RoleCatalogItem[],
): number {
  return roleCatalog.reduce((total, role) => total + getRoleCount(roleCounts, role.id), 0);
}

function canChangeRoleCount(
  roleCounts: Readonly<Partial<Record<RoleId, number>>>,
  roleId: RoleId,
  delta: -1 | 1,
  playerCount: number,
  roleCatalog: readonly RoleCatalogItem[],
): boolean {
  const currentCount = getRoleCount(roleCounts, roleId);
  const nextCount = currentCount + delta;

  if (
    nextCount < getStartRoleCatalogItem(roleCatalog, roleId).minCount ||
    nextCount > getRoleMaxCount(roleId, playerCount, roleCatalog)
  ) {
    return false;
  }

  if (delta > 0 && getRoleCountTotal(roleCounts, roleCatalog) >= playerCount) {
    return false;
  }

  return true;
}

function clampRoleCount(
  roleId: RoleId,
  value: number,
  playerCount: number,
  roleCatalog: readonly RoleCatalogItem[],
): number {
  const integerValue = Math.trunc(value);

  return Math.min(
    getRoleMaxCount(roleId, playerCount, roleCatalog),
    Math.max(getStartRoleCatalogItem(roleCatalog, roleId).minCount, integerValue),
  );
}

function getRoleMaxCount(
  roleId: RoleId,
  playerCount: number,
  roleCatalog: readonly RoleCatalogItem[],
): number {
  return Math.min(
    getStartRoleCatalogItem(roleCatalog, roleId).maxCount ?? playerCount,
    playerCount,
  );
}

function getPresetRoleEntries(
  roleCounts: Readonly<Partial<Record<RoleId, number>>>,
  startRoleCatalog: readonly RoleCatalogItem[],
): readonly { readonly count: number; readonly role: RoleCatalogItem }[] {
  return startRoleCatalog.flatMap((role) => {
    const count = getRoleCount(roleCounts, role.id);

    return count > 0 ? [{ count, role }] : [];
  });
}

function getStartRoleCatalog(roleCatalog: readonly RoleCatalogItem[]): readonly RoleCatalogItem[] {
  return [...roleCatalog].sort(compareStartRoleCatalogItems);
}

function getActiveRoleSpecificOptions(
  roleCatalog: readonly RoleCatalogItem[],
  roleCounts: Readonly<Partial<Record<RoleId, number>>>,
): { readonly option: RoleSpecificOptionItem; readonly role: RoleCatalogItem }[] {
  return getStartRoleCatalog(roleCatalog).flatMap((role) => {
    if (getRoleCount(roleCounts, role.id) <= 0) {
      return [];
    }

    return role.specificOptions.map((option) => ({
      option,
      role,
    }));
  });
}

function renderRoleSpecificOptionControl(
  option: RoleSpecificOptionItem,
  optionLabel: string,
  settings: StartRuleSetSettings,
  onSettingsChange: <Key extends keyof StartRuleSetSettings>(
    key: Key,
    value: StartRuleSetSettings[Key],
  ) => void,
  t: Localization,
): ReactNode {
  switch (option.key) {
    case "guardConsecutiveTargetPolicy":
      return (
        <div
          className="liveSettingsSegments"
          role="group"
          aria-label={t.live.settings.roleSpecific.guardConsecutiveTargetPolicy}
        >
          <button
            aria-pressed={settings.guardConsecutiveTargetPolicy === "deny"}
            type="button"
            onClick={() => onSettingsChange("guardConsecutiveTargetPolicy", "deny")}
          >
            {t.live.settings.roleSpecific.guardConsecutiveTargetPolicyDeny}
          </button>
          <button
            aria-pressed={settings.guardConsecutiveTargetPolicy === "allow"}
            type="button"
            onClick={() => onSettingsChange("guardConsecutiveTargetPolicy", "allow")}
          >
            {t.live.settings.roleSpecific.guardConsecutiveTargetPolicyAllow}
          </button>
        </div>
      );
    case "initialInspectionPolicy":
      return (
        <div
          className="liveSettingsSegments"
          role="group"
          aria-label={t.live.settings.roleSpecific.initialInspectionPolicy}
        >
          <button
            aria-pressed={settings.initialInspectionPolicy === "enabled"}
            type="button"
            onClick={() => onSettingsChange("initialInspectionPolicy", "enabled")}
          >
            {t.live.settings.roleSpecific.initialInspectionPolicyEnabled}
          </button>
          <button
            aria-pressed={settings.initialInspectionPolicy === "disabled"}
            type="button"
            onClick={() => onSettingsChange("initialInspectionPolicy", "disabled")}
          >
            {t.live.settings.roleSpecific.initialInspectionPolicyDisabled}
          </button>
        </div>
      );
    default:
      return <p>{t.live.settings.roleSpecific.notConfigurable(optionLabel)}</p>;
  }
}

function getStartRoleCatalogItem(
  roleCatalog: readonly RoleCatalogItem[],
  roleId: RoleId,
): RoleCatalogItem {
  const role = roleCatalog.find((candidate) => candidate.id === roleId);

  if (role === undefined) {
    throw new Error(`Role catalog is missing ${roleId}.`);
  }

  return role;
}

function getRoleIdsFromCatalog(roleCatalog: readonly RoleCatalogItem[]): readonly RoleId[] {
  return getStartRoleCatalog(roleCatalog).map((role) => role.id);
}

function buildCatalogRoleCounts(
  roleCounts: Readonly<Partial<Record<RoleId, number>>>,
  roleCatalog: readonly RoleCatalogItem[],
): RoleCounts {
  return Object.fromEntries(
    getRoleIdsFromCatalog(roleCatalog).map((roleId) => [roleId, getRoleCount(roleCounts, roleId)]),
  ) as RoleCounts;
}

function getRoleCount(
  roleCounts: Readonly<Partial<Record<RoleId, number>>>,
  roleId: RoleId,
): number {
  return roleCounts[roleId] ?? 0;
}

function compareStartRoleCatalogItems(left: RoleCatalogItem, right: RoleCatalogItem): number {
  if (left.order !== right.order) {
    return left.order - right.order;
  }

  return left.id.localeCompare(right.id);
}

function getSettingsFlowItems(
  settings: StartRuleSetSettings,
  t: Localization,
): readonly { readonly label: string; readonly value: string }[] {
  const dayValue =
    settings.dayMode === "ordered_speech"
      ? t.live.settings.flow.orderedDay(
          settings.firstDaySpeechRounds,
          settings.normalDaySpeechRounds,
          formatSettingsDuration(settings.daySpeechSeconds, t),
        )
      : t.live.settings.flow.readyDay(
          formatSettingsDuration(settings.dayReadyCheckSecondsPerPlayer, t),
        );

  return [
    {
      label: t.live.settings.flow.firstNight,
      value: formatSettingsDuration(settings.firstNightSeconds, t),
    },
    { label: t.live.settings.flow.day, value: dayValue },
    { label: t.live.settings.flow.vote, value: formatSettingsDuration(settings.votingSeconds, t) },
    {
      label: t.live.settings.flow.lastWords,
      value: formatSettingsDuration(settings.executionLastWordsSeconds, t),
    },
    { label: t.live.settings.flow.night, value: formatSettingsDuration(settings.nightSeconds, t) },
  ];
}

function formatSettingsDuration(seconds: number, t: Localization): string {
  if (seconds < 60) {
    return t.live.time.durationSeconds(seconds);
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return remainingSeconds === 0
    ? t.live.time.durationMinutes(minutes)
    : t.live.time.durationMinutesSeconds(minutes, remainingSeconds);
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

function getLivePageTitle(summary: RoomSummary | null, t: Localization): string {
  if (summary === null) {
    return t.live.page.roomSetup;
  }

  if (summary.status === "lobby") {
    return t.live.page.room(summary.code);
  }

  if (summary.status === "disbanded") {
    return t.live.page.roomClosed;
  }

  if (summary.game?.status === "ended") {
    return t.live.page.result;
  }

  return formatPhaseTitle(summary.game?.phase ?? null, t);
}

function getLiveTableTitle(summary: RoomSummary, t: Localization): string {
  if (summary.status === "disbanded") {
    return t.live.table.closed;
  }

  if (summary.game?.status === "ended") {
    return t.live.page.result;
  }

  return formatPhaseTitle(summary.game?.phase ?? null, t);
}

function getActionPanelTitle(summary: RoomSummary, t: Localization): string {
  if (summary.game?.phase === "night") {
    return t.game.actions.night;
  }

  if (summary.game?.phase === "day") {
    return t.game.actions.day;
  }

  if (summary.game?.phase === "voting") {
    return t.game.actions.vote;
  }

  if (summary.game?.phase === "execution") {
    return t.game.actions.execution;
  }

  return t.game.actions.action;
}

function formatPhaseTitle(phase: string | null, t: Localization): string {
  if (phase === "night") {
    return t.game.phase.night;
  }

  if (phase === "day") {
    return t.game.phase.day;
  }

  if (phase === "voting") {
    return t.game.phase.voting;
  }

  if (phase === "execution") {
    return t.game.phase.execution;
  }

  return t.game.phase.game;
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

function getPlayerInitial(displayName: string): string {
  return displayName.trim().slice(0, 1).toLocaleUpperCase("en") || "?";
}

function getPlayPhaseGuidance(
  summary: RoomSummary,
  isBusy: boolean,
  t: Localization,
): LiveGuidance {
  if (isBusy) {
    return t.live.phasePanel.syncing;
  }

  if (summary.status === "disbanded") {
    return t.live.phasePanel.closed;
  }

  if (summary.game?.status === "ended") {
    return t.live.phasePanel.result(formatWinner(summary.game.winnerTeam, t));
  }

  if (summary.game?.phase === "night") {
    return t.live.phasePanel.night;
  }

  if (summary.game?.phase === "day") {
    return t.live.phasePanel.day;
  }

  if (summary.game?.phase === "voting") {
    return t.live.phasePanel.voting;
  }

  if (summary.game?.phase === "execution") {
    return t.live.phasePanel.execution;
  }

  return t.live.phasePanel.game;
}

function getLiveGuidance(
  summary: RoomSummary | null,
  actionCount: number,
  isBusy: boolean,
  t: Localization,
): LiveGuidance {
  if (isBusy) {
    return t.live.guidance.syncing;
  }

  if (summary === null) {
    return t.live.guidance.setup;
  }

  if (summary.status === "disbanded") {
    return t.live.guidance.closed;
  }

  if (summary.game?.status === "ended") {
    return t.live.guidance.result(formatWinner(summary.game.winnerTeam, t));
  }

  if (summary.status === "lobby") {
    const joinedPlayerCount = countJoinedPlayers(summary);

    if (!summary.isHost) {
      return t.live.guidance.lobby(joinedPlayerCount, summary.targetPlayerCount);
    }

    if (joinedPlayerCount < summary.targetPlayerCount) {
      return t.live.guidance.invite(summary.targetPlayerCount - joinedPlayerCount);
    }

    if (joinedPlayerCount > summary.targetPlayerCount) {
      return t.live.guidance.full;
    }

    return t.live.guidance.ready;
  }

  if (actionCount > 0) {
    const openActionCount =
      summary.self?.actions.filter((action) => action.status === "open").length ?? 0;

    if (openActionCount > 0) {
      return t.live.guidance.yourTurn;
    }
  }

  if (summary.game?.actionProgress?.visibility === "public") {
    return t.live.guidance.progress(
      summary.game.actionProgress.submitted,
      summary.game.actionProgress.required,
      getLocalizedActionProgressLabel(t, summary.game.actionProgress.kind),
    );
  }

  if (summary.game?.actionProgress?.visibility === "hidden") {
    return t.live.guidance.privateNight(
      getLocalizedActionProgressLabel(t, summary.game.actionProgress.kind),
    );
  }

  if (summary.isHost) {
    return t.live.guidance.host;
  }

  return t.live.guidance.waiting;
}

function getStartHint(summary: RoomSummary | null, isBusy: boolean, t: Localization): string {
  if (isBusy) {
    return t.live.hints.startAfterSync;
  }

  if (summary === null) {
    return t.live.hints.startNeedsRoom;
  }

  if (!summary.isHost) {
    return t.live.hints.hostOnlyStart;
  }

  if (summary.status !== "lobby") {
    return t.live.hints.startInLobby;
  }

  const joinedPlayerCount = countJoinedPlayers(summary);

  if (joinedPlayerCount < summary.targetPlayerCount) {
    return t.live.hints.waitingForPlayers(summary.targetPlayerCount - joinedPlayerCount);
  }

  if (joinedPlayerCount > summary.targetPlayerCount) {
    return t.live.hints.tooManyPlayers;
  }

  return t.live.hints.startWhenSeated;
}

function getControlHint(summary: RoomSummary | null, isBusy: boolean, t: Localization): string {
  if (summary === null) {
    return t.live.hints.controlsNeedRoom;
  }

  if (summary.status === "lobby") {
    return getStartHint(summary, isBusy, t);
  }

  if (summary.status === "disbanded") {
    return t.live.hints.roomClosed;
  }

  return t.live.hints.reviewResult;
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

function getActionButtonLabel(action: PublicAction, isBusy: boolean, t: Localization): string {
  if (action.status === "submitted") {
    return t.game.actions.button.submitted;
  }

  if (isBusy) {
    return t.game.actions.button.submitting;
  }

  return getLocalizedActionButtonLabel(t, action.kind);
}

function formatRoomStatus(summary: RoomSummary | null, t: Localization): string {
  if (summary === null) {
    return t.live.roomStatus.noRoom;
  }

  if (summary.game?.status === "ended") {
    return t.home.panel.ended;
  }

  const status = t.live.roomStatus.status[summary.status];
  const phase =
    summary.game?.phase === null || summary.game?.phase === undefined
      ? t.game.phase.setup
      : formatPhaseTitle(summary.game.phase, t);

  return t.live.roomStatus.value(status, phase);
}

function formatWinner(winnerTeam: string | null, t: Localization): string {
  if (winnerTeam === null) {
    return t.game.team.none;
  }

  if (winnerTeam === "werewolves") {
    return t.game.team.werewolves;
  }

  if (winnerTeam === "villagers") {
    return t.game.team.villagers;
  }

  return t.game.team.fox;
}

function formatActionProgress(
  progress: NonNullable<RoomSummary["game"]>["actionProgress"],
  t: Localization,
): string {
  if (progress === null) {
    return t.game.actionProgress.none;
  }

  if (progress.visibility === "hidden") {
    return t.game.actionProgress.private;
  }

  return `${progress.submitted}/${progress.required}`;
}

function formatPhaseCountdown(
  phaseEndsAt: string | null,
  currentTimeMs: number,
  t: Localization,
): string {
  if (phaseEndsAt === null) {
    return t.live.time.closed;
  }

  const phaseEndsAtMs = Date.parse(phaseEndsAt);

  if (!Number.isFinite(phaseEndsAtMs)) {
    return t.live.time.unknown;
  }

  const remainingSeconds = Math.max(Math.ceil((phaseEndsAtMs - currentTimeMs) / 1_000), 0);

  if (remainingSeconds <= 0) {
    return t.live.time.dueNow;
  }

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatPublicEvent(
  event: NonNullable<RoomSummary["game"]>["events"][number],
  players: readonly PublicPlayer[],
  t: Localization,
): {
  readonly details: readonly PublicEventDetail[];
  readonly kindLabel: string;
  readonly message: string;
} {
  const targetName = getPayloadPublicPlayerName(event.payload["targetPlayerId"], players);
  switch (event.kind) {
    case "game_ended": {
      const winner = formatWinner(toStringOrNull(event.payload["winnerTeam"]), t);

      return {
        details: [{ label: t.events.details.winner, value: winner }],
        kindLabel: t.events.kind.game_ended,
        message: t.events.message.game_ended(winner),
      };
    }

    case "phase_changed": {
      const phase = formatPhaseTitle(toStringOrNull(event.payload["phase"]), t);

      return {
        details: [],
        kindLabel: t.events.kind.phase_changed,
        message: t.events.message.phase_changed(phase),
      };
    }

    case "player_died":
      return {
        details: targetName === null ? [] : [{ label: t.events.details.player, value: targetName }],
        kindLabel: t.events.kind.player_died,
        message: t.events.message.player_died(targetName ?? t.game.seatStatus.player),
      };

    case "player_executed":
      return {
        details: targetName === null ? [] : [{ label: t.events.details.player, value: targetName }],
        kindLabel: t.events.kind.player_executed,
        message: t.events.message.player_executed(targetName ?? t.game.seatStatus.player),
      };

    case "vote_resolved":
      return formatVoteResolvedEvent(event.payload, players, t);

    case "attack_guarded":
      return {
        details: [],
        kindLabel: t.events.kind.attack_guarded,
        message: t.events.message.attack_guarded,
      };

    case "peaceful_night":
      return {
        details: [],
        kindLabel: t.events.kind.peaceful_night,
        message: t.events.message.peaceful_night,
      };

    case "vote_submitted":
      return {
        details: [],
        kindLabel: t.events.kind.vote_submitted,
        message: t.events.message.vote_submitted,
      };

    case "game_started":
      return {
        details: [],
        kindLabel: t.events.kind.game_started,
        message: t.events.message.game_started,
      };

    default:
      return {
        details: [],
        kindLabel: formatUnknownEventKind(event.kind),
        message: t.events.message.unknown,
      };
  }
}

function formatVoteResolvedEvent(
  payload: Record<string, unknown>,
  players: readonly PublicPlayer[],
  t: Localization,
): {
  readonly details: readonly PublicEventDetail[];
  readonly kindLabel: string;
  readonly message: string;
} {
  const details: PublicEventDetail[] = [];
  const candidateName = getPayloadPublicPlayerName(payload["executionCandidatePlayerId"], players);

  if (candidateName !== null) {
    details.push({ label: t.events.details.candidate, value: candidateName });
  }

  const voteCountsByTarget = payload["voteCountsByTarget"];

  if (isRecord(voteCountsByTarget)) {
    const voteSummary = Object.entries(voteCountsByTarget)
      .map(([playerId, count]) => ({
        count: typeof count === "number" ? count : Number(count),
        playerName: getPayloadPublicPlayerName(playerId, players) ?? playerId,
      }))
      .filter((entry) => Number.isFinite(entry.count))
      .toSorted((left, right) => right.count - left.count)
      .map((entry) => `${entry.playerName} ${entry.count}`)
      .join(", ");

    if (voteSummary !== "") {
      details.push({ label: t.events.details.votes, value: voteSummary });
    }
  }

  const acceptedVotes = payload["acceptedVotes"];

  if (Array.isArray(acceptedVotes)) {
    const acceptedVoteSummary = acceptedVotes
      .flatMap((vote): string[] => {
        if (!isRecord(vote)) {
          return [];
        }

        const voterName = getPayloadPublicPlayerName(vote["voterPlayerId"], players);
        const targetName = getPayloadPublicPlayerName(vote["targetPlayerId"], players);

        return voterName === null || targetName === null ? [] : [`${voterName} -> ${targetName}`];
      })
      .join(", ");

    if (acceptedVoteSummary !== "") {
      details.push({ label: t.events.details.acceptedVotes, value: acceptedVoteSummary });
    }
  }

  return {
    details,
    kindLabel: t.events.kind.vote_resolved,
    message:
      candidateName === null
        ? t.events.message.vote_resolved.noExecution
        : t.events.message.vote_resolved.candidate(candidateName),
  };
}

function getPayloadPublicPlayerName(
  value: unknown,
  players: readonly PublicPlayer[],
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return players.find((player) => player.id === value)?.displayName ?? null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function formatUnknownEventKind(kind: string): string {
  return kind
    .split("_")
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatDateTime(value: string | null, locale: Locale, t: Localization): string {
  if (value === null) {
    return t.common.none;
  }

  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}
