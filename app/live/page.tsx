"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useI18n } from "@/app/i18nProvider";
import { LanguageSwitcher } from "@/app/languageSwitcher";
import { LiveGameEffects } from "@/app/live/effects/LiveGameEffects";
import { useLiveEffectQueue } from "@/app/live/effects/useLiveEffectQueue";
import {
  apiFetch,
  getLiveRoomUrl,
  getRoomCodeSearchParam,
  isApiRequestErrorCode,
  isRealtimeInvalidationPayload,
  isUnauthorizedRequestError,
  parseRealtimeSubscriptionKey,
  readStorage,
  removeStorage,
  requireRoomCode,
  toRealtimeSubscriptionKey,
  toRequestFailureMessage,
  writeClipboardText,
  writeStorage,
} from "@/app/live/liveClient";
import {
  canStartRoom,
  countJoinedPlayers,
  formatRoomStatus,
  getControlHint,
  getLiveGridClassName,
  getLiveGuidance,
  getLiveMood,
  getLivePageTitle,
} from "@/app/live/livePresentation";
import {
  buildStartRuleSetInput,
  DEFAULT_START_RULE_SET_SETTINGS,
  type StartRuleSetSettings,
} from "@/app/live/liveStartSettings";
import { StartSettingsDialog } from "@/app/live/liveStartSettingsDialog";
import {
  LeaveRoomDialog,
  LivePlaySurface,
  LiveSetupSurface,
  LiveToastRegion,
  LobbyRequirements,
  PlayerSeatGrid,
  RoomInviteTools,
  SwitchRoomDialog,
  type LiveToast,
  type LiveToastTone,
  type SetupPendingAction,
} from "@/app/live/liveSurfaces";
import { getSupabaseRealtimeClient } from "@/lib/client/supabaseRealtime";
import {
  DEFAULT_TARGET_PLAYER_COUNT,
  MAX_ROOM_PLAYERS,
  MIN_ROOM_PLAYERS,
  type CurrentRoomResponse,
  type NightConversationView,
  type PublicAction,
  type RealtimeAuthorization,
  type RoomSummary,
  type SwitchRoomRequest,
} from "@/lib/shared/game";

type IdentityResponse = {
  token: string;
};

type RememberRoomOptions = {
  readonly resetActionTargets?: boolean;
};

type RoomRequestContext = {
  readonly expectedRoomCode: string | null;
  readonly identityToken: string;
  readonly requestId: number;
  readonly sessionId: number;
};

type AppliedRoomSnapshot = {
  readonly requestId: number;
  readonly roomCode: string;
  readonly sessionId: number;
  readonly snapshotRevision: number;
};

type ClearCurrentRoomOptions = {
  readonly ignoredRoomCode?: string | null;
  readonly preserveRoomCodeInput?: boolean;
};

type PendingRoomSwitch = {
  readonly request: SwitchRoomRequest;
};

type RoomSwitchIntent =
  | {
      readonly displayName: string;
      readonly kind: "create";
      readonly targetPlayerCount: number;
    }
  | {
      readonly displayName: string;
      readonly kind: "join";
      readonly targetRoomCode: string;
    };

type RealtimeBroadcastEnvelope = {
  readonly payload?: unknown;
};

const IDENTITY_STORAGE_KEY = "jinrohWeb.identityToken";
const DISPLAY_NAME_STORAGE_KEY = "jinrohWeb.displayName";
const LEGACY_ROOM_CODE_STORAGE_KEY = "jinrohWeb.roomCode";
const ROOM_MEMBERSHIP_CHANNEL_NAME = "jinrohWeb.roomMembership";
const HEARTBEAT_INTERVAL_MS = 20_000;
const ROOM_SYNC_INTERVAL_MS = 4_000;
const TOAST_DEFAULT_DURATION_MS = 4_800;
const TOAST_IMPORTANT_DURATION_MS = 7_000;
const LIVE_MOOD_BACKGROUND_SOURCES = [
  "/images/jinroh-lobby-same-angle.jpg",
  "/images/jinroh-day-same-angle.jpg",
  "/images/jinroh-voting-same-angle.jpg",
  "/images/jinroh-night.jpg",
  "/images/jinroh-result-same-angle.jpg",
] as const;

export default function LivePage() {
  const { locale, t } = useI18n();
  const invalidIdentityStatusMessage = t.live.room.identityExpired;
  const roomClosedStatusMessage = t.live.room.closed;
  const [identityToken, setIdentityToken] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("Sora");
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [targetPlayerCount, setTargetPlayerCount] = useState(DEFAULT_TARGET_PLAYER_COUNT);
  const [roomSummary, setRoomSummary] = useState<RoomSummary | null>(null);
  const [isIdentityHydrated, setIsIdentityHydrated] = useState(false);
  const [isCurrentRoomReady, setIsCurrentRoomReady] = useState(false);
  const [invitationRoomCode, setInvitationRoomCode] = useState<string | null>(null);
  const [pendingRoomSwitch, setPendingRoomSwitch] = useState<PendingRoomSwitch | null>(null);
  const [realtimeAuthorization, setRealtimeAuthorization] = useState<RealtimeAuthorization | null>(
    null,
  );
  const [startRuleSetSettings, setStartRuleSetSettings] = useState<StartRuleSetSettings>(
    DEFAULT_START_RULE_SET_SETTINGS,
  );
  const [isStartSettingsOpen, setIsStartSettingsOpen] = useState(false);
  const [isNightConversationOpen, setIsNightConversationOpen] = useState(false);
  const [isPublicLogOpen, setIsPublicLogOpen] = useState(false);
  const [isLeaveConfirmationOpen, setIsLeaveConfirmationOpen] = useState(false);
  const [toast, setToast] = useState<LiveToast | null>(null);
  const [nightConversationDraft, setNightConversationDraft] = useState("");
  const [copiedInviteRoomCode, setCopiedInviteRoomCode] = useState<string | null>(null);
  const copiedInviteResetTimerRef = useRef<number | null>(null);
  const toastDismissTimerRef = useRef<number | null>(null);
  const ignoredRoomCodeRef = useRef<string | null>(null);
  const identityTokenRef = useRef<string | null>(null);
  const roomSummaryRef = useRef<RoomSummary | null>(null);
  const roomMembershipChannelRef = useRef<BroadcastChannel | null>(null);
  const nextCurrentRoomRequestIdRef = useRef(0);
  const appliedCurrentRoomRequestIdRef = useRef(0);
  const roomSessionIdRef = useRef(0);
  const nextRoomRequestIdRef = useRef(0);
  const appliedRoomSnapshotRef = useRef<AppliedRoomSnapshot | null>(null);
  const isBusyRef = useRef(false);
  const liveShellRef = useRef<HTMLElement>(null);
  const [targetByActionKey, setTargetByActionKey] = useState<Record<string, string>>({});
  const [isBusy, setIsBusy] = useState(false);
  const [setupPendingAction, setSetupPendingAction] = useState<SetupPendingAction>(null);
  const [liveOrigin, setLiveOrigin] = useState<string | null>(null);
  const {
    acceptSummary: acceptEffectSummary,
    activeCue,
    clearEffects,
    completeActiveCue,
    replayRole,
  } = useLiveEffectQueue();

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

  const updateIdentityToken = useCallback((nextIdentityToken: string | null) => {
    identityTokenRef.current = nextIdentityToken;
    setIdentityToken(nextIdentityToken);
  }, []);

  const createRoomRequestContext = useCallback(
    (expectedRoomCode: string | null, token: string): RoomRequestContext => ({
      expectedRoomCode,
      identityToken: token,
      requestId: (nextRoomRequestIdRef.current += 1),
      sessionId: roomSessionIdRef.current,
    }),
    [],
  );

  const isRoomRequestContextCurrent = useCallback(
    (context: RoomRequestContext): boolean =>
      context.sessionId === roomSessionIdRef.current &&
      context.identityToken === identityTokenRef.current,
    [],
  );

  const beginRoomSession = useCallback(() => {
    clearEffects();
    roomSessionIdRef.current += 1;
    nextCurrentRoomRequestIdRef.current += 1;
    appliedCurrentRoomRequestIdRef.current = nextCurrentRoomRequestIdRef.current;
    appliedRoomSnapshotRef.current = null;
    ignoredRoomCodeRef.current = null;
  }, [clearEffects]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      const requestedRoomCode = getRoomCodeSearchParam(window.location.search);
      const savedIdentityToken = readStorage(IDENTITY_STORAGE_KEY);
      const savedDisplayName = readStorage(DISPLAY_NAME_STORAGE_KEY);

      setLiveOrigin(window.location.origin);
      removeStorage(LEGACY_ROOM_CODE_STORAGE_KEY);

      if (savedIdentityToken !== null) {
        updateIdentityToken(savedIdentityToken);
      } else {
        setIsCurrentRoomReady(true);
      }

      if (savedDisplayName !== null) {
        setDisplayName(savedDisplayName);
      }

      if (requestedRoomCode !== null) {
        setInvitationRoomCode(requestedRoomCode);
        setRoomCodeInput(requestedRoomCode);
      }

      setIsIdentityHydrated(true);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [updateIdentityToken]);

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

  async function createIdentityToken(): Promise<string> {
    const identity = await apiFetch<IdentityResponse>("/api/identity", { method: "POST" });

    writeStorage(IDENTITY_STORAGE_KEY, identity.token);
    updateIdentityToken(identity.token);

    return identity.token;
  }

  async function ensureIdentityToken(): Promise<string> {
    if (identityToken !== null) {
      return identityToken;
    }

    return createIdentityToken();
  }

  const clearCurrentRoom = useCallback(
    (options: ClearCurrentRoomOptions = {}) => {
      clearEffects();
      roomSessionIdRef.current += 1;
      nextCurrentRoomRequestIdRef.current += 1;
      appliedCurrentRoomRequestIdRef.current = nextCurrentRoomRequestIdRef.current;
      appliedRoomSnapshotRef.current = null;
      ignoredRoomCodeRef.current = options.ignoredRoomCode ?? null;
      roomSummaryRef.current = null;
      removeStorage(LEGACY_ROOM_CODE_STORAGE_KEY);
      setRoomSummary(null);
      setIsCurrentRoomReady(true);
      setPendingRoomSwitch(null);

      if (!(options.preserveRoomCodeInput ?? false)) {
        setRoomCodeInput("");
      }

      setTargetByActionKey({});
      setIsNightConversationOpen(false);
      setIsPublicLogOpen(false);
      setNightConversationDraft("");
      setIsStartSettingsOpen(false);
      setIsLeaveConfirmationOpen(false);
      window.requestAnimationFrame(() => window.scrollTo({ left: 0, top: 0 }));
    },
    [clearEffects],
  );

  const resetInvalidIdentity = useCallback(
    (nextStatusMessage = invalidIdentityStatusMessage) => {
      removeStorage(IDENTITY_STORAGE_KEY);
      updateIdentityToken(null);
      setIsCurrentRoomReady(true);
      showToast(nextStatusMessage, "warning", TOAST_IMPORTANT_DURATION_MS);
      clearCurrentRoom({ preserveRoomCodeInput: true });
    },
    [clearCurrentRoom, invalidIdentityStatusMessage, showToast, updateIdentityToken],
  );

  async function withBusy(
    work: () => Promise<void>,
    pendingAction: SetupPendingAction = null,
  ): Promise<void> {
    if (isBusyRef.current) {
      return;
    }

    isBusyRef.current = true;
    setIsBusy(true);
    setSetupPendingAction(pendingAction);

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
      isBusyRef.current = false;
      setIsBusy(false);
      setSetupPendingAction(null);
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
    (
      nextSummary: RoomSummary,
      requestContext: RoomRequestContext,
      options: RememberRoomOptions = {},
    ) => {
      if (!isRoomRequestContextCurrent(requestContext)) {
        return false;
      }

      if (
        requestContext.expectedRoomCode !== null &&
        requestContext.expectedRoomCode !== nextSummary.code
      ) {
        return false;
      }

      const appliedSnapshot = appliedRoomSnapshotRef.current;

      if (appliedSnapshot !== null) {
        if (
          appliedSnapshot.sessionId !== requestContext.sessionId ||
          appliedSnapshot.roomCode !== nextSummary.code ||
          nextSummary.snapshotRevision < appliedSnapshot.snapshotRevision ||
          (nextSummary.snapshotRevision === appliedSnapshot.snapshotRevision &&
            requestContext.requestId <= appliedSnapshot.requestId)
        ) {
          return false;
        }
      }

      if (ignoredRoomCodeRef.current === nextSummary.code) {
        return false;
      }

      if (nextSummary.status === "disbanded") {
        clearCurrentRoom({
          ignoredRoomCode: nextSummary.code,
          preserveRoomCodeInput: true,
        });
        showToast(roomClosedStatusMessage, "warning", TOAST_IMPORTANT_DURATION_MS);
        return false;
      }

      writeStorage(DISPLAY_NAME_STORAGE_KEY, displayName);
      appliedRoomSnapshotRef.current = {
        requestId: requestContext.requestId,
        roomCode: nextSummary.code,
        sessionId: requestContext.sessionId,
        snapshotRevision: nextSummary.snapshotRevision,
      };
      acceptEffectSummary(nextSummary);
      roomSummaryRef.current = nextSummary;
      setRoomSummary(nextSummary);
      setIsCurrentRoomReady(true);

      if (options.resetActionTargets ?? true) {
        setTargetByActionKey({});
      }

      return true;
    },
    [
      acceptEffectSummary,
      clearCurrentRoom,
      displayName,
      isRoomRequestContextCurrent,
      roomClosedStatusMessage,
      showToast,
    ],
  );

  const syncCurrentRoom = useCallback(
    async (token: string): Promise<RoomSummary | null> => {
      const currentRoomRequestId = (nextCurrentRoomRequestIdRef.current += 1);
      const response = await apiFetch<CurrentRoomResponse>("/api/rooms/current", {
        method: "GET",
        token,
      });

      if (
        token !== identityTokenRef.current ||
        currentRoomRequestId < appliedCurrentRoomRequestIdRef.current
      ) {
        return roomSummaryRef.current;
      }

      appliedCurrentRoomRequestIdRef.current = currentRoomRequestId;

      if (response.room === null) {
        if (roomSummaryRef.current === null) {
          setIsCurrentRoomReady(true);
          setPendingRoomSwitch(null);
        } else {
          clearCurrentRoom({ preserveRoomCodeInput: true });
        }

        return null;
      }

      if (roomSummaryRef.current?.code !== response.room.code) {
        beginRoomSession();
      }

      ignoredRoomCodeRef.current = null;
      const requestContext = createRoomRequestContext(response.room.code, token);
      const didRememberRoom = rememberRoom(response.room, requestContext, {
        resetActionTargets: roomSummaryRef.current?.code !== response.room.code,
      });

      return didRememberRoom ? response.room : roomSummaryRef.current;
    },
    [beginRoomSession, clearCurrentRoom, createRoomRequestContext, rememberRoom],
  );

  useEffect(() => {
    if (!isIdentityHydrated || identityToken === null) {
      return;
    }

    let isCancelled = false;
    const timerId = window.setTimeout(() => {
      void syncCurrentRoom(identityToken).catch((error: unknown) => {
        if (isCancelled) {
          return;
        }

        if (isUnauthorizedRequestError(error)) {
          resetInvalidIdentity();
          return;
        }

        showToast(t.live.room.currentCouldNotLoad, "error", TOAST_IMPORTANT_DURATION_MS);
      });
    }, 0);

    return () => {
      isCancelled = true;
      window.clearTimeout(timerId);
    };
  }, [
    identityToken,
    isIdentityHydrated,
    resetInvalidIdentity,
    showToast,
    syncCurrentRoom,
    t.live.room.currentCouldNotLoad,
  ]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") {
      return;
    }

    const channel = new BroadcastChannel(ROOM_MEMBERSHIP_CHANNEL_NAME);
    roomMembershipChannelRef.current = channel;
    channel.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (
        typeof event.data !== "object" ||
        event.data === null ||
        !("type" in event.data) ||
        event.data.type !== "membership-invalidated"
      ) {
        return;
      }

      const token = identityTokenRef.current;

      if (token !== null) {
        void syncCurrentRoom(token).catch(() => {
          // The regular current-room polling loop remains the fallback.
        });
      }
    });

    return () => {
      channel.close();

      if (roomMembershipChannelRef.current === channel) {
        roomMembershipChannelRef.current = null;
      }
    };
  }, [syncCurrentRoom]);

  const broadcastRoomMembershipInvalidation = useCallback(() => {
    roomMembershipChannelRef.current?.postMessage({ type: "membership-invalidated" });
  }, []);

  const activeRoomCode = roomSummary?.code ?? null;
  const activePhaseEndsAt = roomSummary?.game?.phaseEndsAt ?? null;
  const activePhaseInstanceId = roomSummary?.game?.phaseInstanceId ?? null;
  const activeRealtimeSubscriptionKey = toRealtimeSubscriptionKey(
    realtimeAuthorization?.subscriptions ?? [],
  );

  useEffect(() => {
    if (
      identityToken === null ||
      activeRoomCode === null ||
      roomSummary?.currentPlayerId === null
    ) {
      const clearAuthorizationTimerId = window.setTimeout(() => {
        setRealtimeAuthorization(null);
      }, 0);

      return () => window.clearTimeout(clearAuthorizationTimerId);
    }

    let isCancelled = false;
    let refreshTimerId: number | null = null;
    const activeToken = identityToken;

    async function refreshRealtimeAuthorization(): Promise<void> {
      try {
        const authorization = await apiFetch<RealtimeAuthorization>(
          `/api/rooms/${activeRoomCode}/realtime-token`,
          { method: "POST", token: activeToken },
        );

        if (isCancelled) {
          return;
        }

        setRealtimeAuthorization(authorization);
        const refreshDelay = Math.max(
          15_000,
          Date.parse(authorization.expiresAt) - Date.now() - 30_000,
        );
        refreshTimerId = window.setTimeout(() => {
          void refreshRealtimeAuthorization();
        }, refreshDelay);
      } catch (error) {
        if (isCancelled) {
          return;
        }

        setRealtimeAuthorization(null);

        if (isUnauthorizedRequestError(error)) {
          resetInvalidIdentity();
          return;
        }

        refreshTimerId = window.setTimeout(() => {
          void refreshRealtimeAuthorization();
        }, 30_000);
      }
    }

    void refreshRealtimeAuthorization();

    return () => {
      isCancelled = true;
      if (refreshTimerId !== null) {
        window.clearTimeout(refreshTimerId);
      }
    };
  }, [
    activeRoomCode,
    identityToken,
    resetInvalidIdentity,
    roomSummary?.currentPlayerId,
    roomSummary?.self?.roleId,
  ]);

  useEffect(() => {
    if (!isIdentityHydrated || identityToken === null) {
      return;
    }

    let isCancelled = false;
    let isSyncing = false;
    const activeToken = identityToken;

    async function syncRoom(): Promise<void> {
      if (isSyncing) {
        return;
      }

      isSyncing = true;
      try {
        await syncCurrentRoom(activeToken);
      } catch (error) {
        if (!isCancelled) {
          if (isUnauthorizedRequestError(error)) {
            resetInvalidIdentity();
            return;
          }

          if (isCurrentRoomReady) {
            showToast(t.live.room.syncFailed, "warning", TOAST_IMPORTANT_DURATION_MS);
          }
        }
      } finally {
        isSyncing = false;
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
    identityToken,
    isCurrentRoomReady,
    isIdentityHydrated,
    resetInvalidIdentity,
    showToast,
    syncCurrentRoom,
    t.live.room.syncFailed,
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
    let isSendingHeartbeat = false;
    const activeToken = identityToken;

    async function heartbeatRoom(): Promise<void> {
      if (isSendingHeartbeat) {
        return;
      }

      isSendingHeartbeat = true;
      const requestContext = createRoomRequestContext(activeRoomCode, activeToken);

      try {
        const summary = await apiFetch<RoomSummary>(`/api/rooms/${activeRoomCode}/heartbeat`, {
          method: "POST",
          token: activeToken,
        });

        if (!isCancelled) {
          rememberRoom(summary, requestContext, { resetActionTargets: false });
        }
      } catch (error) {
        if (
          !isCancelled &&
          isRoomRequestContextCurrent(requestContext) &&
          isUnauthorizedRequestError(error)
        ) {
          resetInvalidIdentity();
        }
      } finally {
        isSendingHeartbeat = false;
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
    createRoomRequestContext,
    identityToken,
    isRoomRequestContextCurrent,
    rememberRoom,
    resetInvalidIdentity,
    roomSummary?.currentPlayerId,
  ]);

  useEffect(() => {
    if (
      identityToken === null ||
      activeRoomCode === null ||
      realtimeAuthorization === null ||
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
    let hasPendingSync = false;
    const activeToken = identityToken;
    const activeRealtimeClient = realtimeClient;
    const realtimeRoomCode = activeRoomCode;
    const realtimeAccessToken = realtimeAuthorization.accessToken;
    const channels: ReturnType<typeof activeRealtimeClient.channel>[] = [];

    async function syncRoomFromRealtime(): Promise<void> {
      if (isSyncing) {
        hasPendingSync = true;
        return;
      }

      isSyncing = true;

      try {
        await syncCurrentRoom(activeToken);
      } catch (error) {
        if (!isCancelled) {
          if (isUnauthorizedRequestError(error)) {
            resetInvalidIdentity();
            return;
          }

          const nextStatusMessage = t.live.status.realtimeFailed;

          showToast(nextStatusMessage, "warning", TOAST_IMPORTANT_DURATION_MS);
        }
      } finally {
        isSyncing = false;

        if (!isCancelled && hasPendingSync) {
          hasPendingSync = false;
          void syncRoomFromRealtime();
        }
      }
    }

    async function subscribeToRealtime(): Promise<void> {
      await activeRealtimeClient.realtime.setAuth(realtimeAccessToken);

      if (isCancelled) {
        return;
      }

      for (const subscription of subscriptions) {
        const channel = activeRealtimeClient
          .channel(subscription.topic, {
            config: { broadcast: { self: false }, private: true },
          })
          .on("broadcast", { event: "room_changed" }, (message: RealtimeBroadcastEnvelope) => {
            if (!isRealtimeInvalidationPayload(message.payload, realtimeRoomCode)) {
              return;
            }

            void syncRoomFromRealtime();
          })
          .subscribe();

        channels.push(channel);
      }
    }

    void subscribeToRealtime().catch(() => {
      // Polling remains the authoritative fallback when Realtime is unavailable.
    });

    return () => {
      isCancelled = true;
      for (const channel of channels) {
        void activeRealtimeClient.removeChannel(channel);
      }
    };
  }, [
    activeRealtimeSubscriptionKey,
    activeRoomCode,
    identityToken,
    realtimeAuthorization,
    resetInvalidIdentity,
    showToast,
    syncCurrentRoom,
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
          await syncCurrentRoom(activeToken);
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
    resetInvalidIdentity,
    syncCurrentRoom,
  ]);

  const offerRoomSwitch = useCallback(
    (intent: RoomSwitchIntent, currentRoom: RoomSummary): void => {
      if (intent.kind === "join" && intent.targetRoomCode === currentRoom.code) {
        return;
      }

      if (currentRoom.status === "playing") {
        showToast(
          t.live.room.switchForbidden(currentRoom.code),
          "warning",
          TOAST_IMPORTANT_DURATION_MS,
        );
        return;
      }

      if (currentRoom.status !== "lobby" && currentRoom.status !== "ended") {
        return;
      }

      setPendingRoomSwitch({
        request:
          intent.kind === "create"
            ? {
                displayName: intent.displayName,
                expectedCurrentRoomCode: currentRoom.code,
                kind: "create",
                targetPlayerCount: intent.targetPlayerCount,
              }
            : {
                displayName: intent.displayName,
                expectedCurrentRoomCode: currentRoom.code,
                kind: "join",
                targetRoomCode: intent.targetRoomCode,
              },
      });
    },
    [showToast, t.live.room],
  );

  useEffect(() => {
    if (!isCurrentRoomReady || invitationRoomCode === null || roomSummary === null) {
      return;
    }

    const timerId = window.setTimeout(() => {
      setInvitationRoomCode(null);
      offerRoomSwitch(
        {
          displayName,
          kind: "join",
          targetRoomCode: invitationRoomCode,
        },
        roomSummary,
      );
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [displayName, invitationRoomCode, isCurrentRoomReady, offerRoomSwitch, roomSummary]);

  useEffect(() => {
    if (pendingRoomSwitch === null || roomSummary === null) {
      return;
    }

    const timerId = window.setTimeout(() => {
      if (pendingRoomSwitch.request.expectedCurrentRoomCode !== roomSummary.code) {
        setPendingRoomSwitch(null);
        showToast(t.live.room.currentChanged, "warning", TOAST_IMPORTANT_DURATION_MS);
        return;
      }

      if (roomSummary.status === "playing") {
        setPendingRoomSwitch(null);
        showToast(
          t.live.room.switchForbidden(roomSummary.code),
          "warning",
          TOAST_IMPORTANT_DURATION_MS,
        );
      }
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [pendingRoomSwitch, roomSummary, showToast, t.live.room]);

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

  async function recoverCurrentRoomConflict(
    error: unknown,
    token: string,
    intent: RoomSwitchIntent,
  ): Promise<boolean> {
    if (!isApiRequestErrorCode(error, "current_room_exists")) {
      return false;
    }

    const currentRoom = await syncCurrentRoom(token);

    if (currentRoom === null) {
      return false;
    }

    offerRoomSwitch(intent, currentRoom);

    return true;
  }

  function handleCreateRoom(): void {
    void withBusy(async () => {
      const intent: RoomSwitchIntent = { displayName, kind: "create", targetPlayerCount };
      const response = await withFreshIdentityToken(async (token) => {
        try {
          const summary = await apiFetch<RoomSummary>("/api/rooms", {
            body: { displayName, targetPlayerCount },
            method: "POST",
            token,
          });

          return { summary, token };
        } catch (error) {
          if (await recoverCurrentRoomConflict(error, token, intent)) {
            return null;
          }

          throw error;
        }
      });

      if (response === null) {
        return;
      }

      beginRoomSession();
      const requestContext = createRoomRequestContext(response.summary.code, response.token);
      rememberRoom(response.summary, requestContext);
      setInvitationRoomCode(null);
      broadcastRoomMembershipInvalidation();
    }, "create");
  }

  function handleJoinRoom(): void {
    void withBusy(async () => {
      const roomCode = requireRoomCode(roomCodeInput, t);
      const intent: RoomSwitchIntent = {
        displayName,
        kind: "join",
        targetRoomCode: roomCode,
      };
      const response = await withFreshIdentityToken(async (token) => {
        try {
          const summary = await apiFetch<RoomSummary>(`/api/rooms/${roomCode}/join`, {
            body: { displayName },
            method: "POST",
            token,
          });

          return { summary, token };
        } catch (error) {
          if (await recoverCurrentRoomConflict(error, token, intent)) {
            return null;
          }

          throw error;
        }
      });

      if (response === null) {
        return;
      }

      beginRoomSession();
      const requestContext = createRoomRequestContext(response.summary.code, response.token);
      rememberRoom(response.summary, requestContext);
      setInvitationRoomCode(null);
      broadcastRoomMembershipInvalidation();
    }, "join");
  }

  function handleRefreshRoom(): void {
    void withBusy(async () => {
      const token = await ensureIdentityToken();
      await syncCurrentRoom(token);
    });
  }

  function handleStartGame(): void {
    void withBusy(async () => {
      const token = await ensureIdentityToken();
      const roomCode = requireRoomCode(roomSummary?.code ?? roomCodeInput, t);
      const requestContext = createRoomRequestContext(roomCode, token);
      const summary = await apiFetch<RoomSummary>(`/api/rooms/${roomCode}/start`, {
        body: { ruleSet: buildStartRuleSetInput(startRuleSetSettings) },
        method: "POST",
        token,
      });

      rememberRoom(summary, requestContext);
    });
  }

  function handleConfirmLeaveRoom(): void {
    void withBusy(async () => {
      const token = await ensureIdentityToken();
      const roomCode = requireRoomCode(roomSummary?.code ?? roomCodeInput, t);
      const requestContext = createRoomRequestContext(roomCode, token);
      await apiFetch<RoomSummary>(`/api/rooms/${roomCode}/leave`, {
        method: "POST",
        token,
      });

      if (isRoomRequestContextCurrent(requestContext)) {
        clearCurrentRoom({ ignoredRoomCode: roomCode });
        broadcastRoomMembershipInvalidation();
      }
    });
  }

  function handleConfirmRoomSwitch(): void {
    const pendingSwitch = pendingRoomSwitch;

    if (pendingSwitch === null) {
      return;
    }

    void withBusy(async () => {
      const token = await ensureIdentityToken();

      try {
        const summary = await apiFetch<RoomSummary>("/api/rooms/switch", {
          body: pendingSwitch.request,
          method: "POST",
          token,
        });

        beginRoomSession();
        const requestContext = createRoomRequestContext(summary.code, token);
        rememberRoom(summary, requestContext);
        setPendingRoomSwitch(null);
        setInvitationRoomCode(null);
        broadcastRoomMembershipInvalidation();
      } catch (error) {
        if (
          isApiRequestErrorCode(error, "current_room_changed") ||
          isApiRequestErrorCode(error, "room_switch_forbidden")
        ) {
          setPendingRoomSwitch(null);
          await syncCurrentRoom(token);
        }

        throw error;
      }
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

      const requestContext = createRoomRequestContext(roomCode, token);
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

      rememberRoom(summary, requestContext);
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

      const requestContext = createRoomRequestContext(roomCode, token);
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
      rememberRoom(summary, requestContext, { resetActionTargets: false });
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

    showToast(t.live.invite.copyFailed, "error", TOAST_IMPORTANT_DURATION_MS);
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
        showToast(t.live.invite.shareSucceeded, "success");
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
      }
    }

    const didCopy = await writeClipboardText(inviteText);

    if (didCopy) {
      showToast(t.live.invite.shareFallbackCopied, "success");
      return;
    }

    showToast(t.live.invite.shareFailed, "error", TOAST_IMPORTANT_DURATION_MS);
  }

  function getActionTarget(action: PublicAction): string {
    return targetByActionKey[action.key] ?? action.eligibleTargetIds[0] ?? "";
  }

  const isCurrentRoomParticipant = roomSummary !== null && roomSummary.currentPlayerId !== null;
  const selfActions = isCurrentRoomParticipant ? (roomSummary.self?.actions ?? []) : [];
  const roomStatusLabel = formatRoomStatus(roomSummary, t);
  const liveGuidance = getLiveGuidance(roomSummary, selfActions.length, isBusy, t);
  const canStartGame = isCurrentRoomParticipant && !isBusy && canStartRoom(roomSummary);
  const canConfigureStartSettings =
    isCurrentRoomParticipant && roomSummary.isHost && roomSummary.status === "lobby";
  const canLeaveRoom =
    isCurrentRoomParticipant && (roomSummary.status === "lobby" || roomSummary.status === "ended");
  const isGameSurface =
    roomSummary !== null &&
    roomSummary.game !== null &&
    (roomSummary.status === "playing" || roomSummary.status === "ended");
  const controlHint = getControlHint(roomSummary, isBusy, t);
  const liveMood = getLiveMood(roomSummary);
  const isRoomEntryAvailable = roomSummary === null && isCurrentRoomReady;
  const liveGridClassName = getLiveGridClassName(roomSummary);
  const liveShellClassName = [
    "liveShell",
    `liveMood-${liveMood}`,
    isGameSurface ? "liveShellGame" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const roomInviteUrl =
    liveOrigin === null || roomSummary === null
      ? null
      : getLiveRoomUrl(roomSummary.code, liveOrigin);

  return (
    <main className={liveShellClassName} data-live-mood={liveMood} ref={liveShellRef}>
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
              pendingAction={setupPendingAction}
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
              <div className="liveEmptyState compact" role="status">
                <strong>{t.live.room.checkingCurrent}</strong>
              </div>
            </section>
          ) : null}

          {roomSummary?.status === "lobby" && isCurrentRoomParticipant ? (
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

          {roomSummary?.status === "lobby" && isCurrentRoomParticipant ? (
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
                  onClick={() => setIsLeaveConfirmationOpen(true)}
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
              onRequestLeaveRoom={() => setIsLeaveConfirmationOpen(true)}
              onRevealRole={replayRole}
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

      {roomSummary !== null && canLeaveRoom && isLeaveConfirmationOpen ? (
        <LeaveRoomDialog
          isBusy={isBusy}
          t={t}
          onClose={() => setIsLeaveConfirmationOpen(false)}
          onConfirm={handleConfirmLeaveRoom}
        />
      ) : null}

      {pendingRoomSwitch === null || roomSummary === null ? null : (
        <SwitchRoomDialog
          isBusy={isBusy}
          request={pendingRoomSwitch.request}
          t={t}
          onClose={() => setPendingRoomSwitch(null)}
          onConfirm={handleConfirmRoomSwitch}
        />
      )}

      <LiveGameEffects
        activeCue={activeCue}
        shellRef={liveShellRef}
        summary={roomSummary}
        t={t}
        onComplete={completeActiveCue}
      />
      <LiveToastRegion toast={toast} t={t} onDismiss={dismissToast} />
    </main>
  );
}
