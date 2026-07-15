"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { useI18n } from "@/app/i18nProvider";
import { JinrohBrandLink } from "@/app/jinrohBrandLink";
import { LanguageSwitcher } from "@/app/languageSwitcher";
import { LiveGameEffects } from "@/app/live/effects/LiveGameEffects";
import { LiveBackground } from "@/app/live/effects/ui/LiveBackground";
import { getLiveBackgroundSnapshot } from "@/app/live/effects/ui/liveBackgroundModel";
import { LiveSetupTransitionController } from "@/app/live/effects/ui/LiveSetupTransitionController";
import {
  createLiveToastRoomSessionScope,
  LIVE_TOAST_PAGE_SCOPE,
  type LiveToastScope,
  type LiveToastTone,
} from "@/app/live/effects/ui/liveToastModel";
import { LiveToastRegion } from "@/app/live/effects/ui/LiveToastRegion";
import { useLiveActionFeedback } from "@/app/live/effects/ui/useLiveActionFeedback";
import { useLiveToastController } from "@/app/live/effects/ui/useLiveToastController";
import {
  useLiveEffectQueue,
  type LiveDisplayCommitOrigin,
} from "@/app/live/effects/useLiveEffectQueue";
import {
  apiFetch,
  assertBrowserStorageAccess,
  getLiveRoomUrl,
  getRoomCodeSearchParam,
  isApiRequestErrorCode,
  isBrowserStorageUnavailableError,
  isRealtimeInvalidationPayload,
  isUnauthorizedRequestError,
  parseRealtimeSubscriptionKey,
  readStorage,
  removeStorage,
  requireRoomCode,
  toRealtimeSubscriptionKey,
  toRequestFailureMessage,
  verifyBrowserStorageAccess,
  writeClipboardText,
  writeStorage,
} from "@/app/live/liveClient";
import { createDefaultDisplayName } from "@/app/live/liveDefaultDisplayName";
import { getLiveGameSessionKey, hasLiveGameBoundary } from "@/app/live/liveGameSession";
import { formatRoomStatus, getLiveMood, getLivePageTitle } from "@/app/live/livePresentation";
import { LiveRoundTable } from "@/app/live/liveRoundTable";
import {
  buildStartRuleSetInput,
  DEFAULT_START_RULE_SET_SETTINGS,
  type StartRuleSetSettings,
} from "@/app/live/liveStartSettings";
import { StartSettingsDialog } from "@/app/live/liveStartSettingsDialog";
import {
  getStartSettingsRoomSession,
  getStartSettingsRoomSessionId,
  parseStartSettings,
  serializeStartSettings,
  START_SETTINGS_STORAGE_KEY,
} from "@/app/live/liveStartSettingsStorage";
import {
  LeaveRoomDialog,
  LiveEndedSurface,
  LivePlayingSurface,
  LiveEntrySurface,
  LiveWaitingSurface,
  SwitchRoomDialog,
  type SetupPendingAction,
} from "@/app/live/liveSurfaces";
import { LiveRoomLayout, liveViewportStyles } from "@/app/live/liveViewportLayout";
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

import type {
  LiveSetupSurfaceKind,
  LiveSetupTransitionSnapshot,
} from "@/app/live/effects/ui/liveSetupTransitionModel";
import type { ReactNode } from "react";

type IdentityResponse = {
  token: string;
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
  readonly isOpen: boolean;
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

type RoomBoundSurfaceStatus = "ended" | "playing" | "waiting";

type BrowserStorageStatus = "available" | "checking" | "unavailable";

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
export default function LivePage() {
  const { locale, t } = useI18n();
  const invalidIdentityStatusMessage = t.live.room.identityExpired;
  const [identityToken, setIdentityToken] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [browserStorageStatus, setBrowserStorageStatus] =
    useState<BrowserStorageStatus>("checking");
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [targetPlayerCount, setTargetPlayerCount] = useState(DEFAULT_TARGET_PLAYER_COUNT);
  const [roomSummary, setRoomSummary] = useState<RoomSummary | null>(null);
  const [displayedRoomSummary, setDisplayedRoomSummary] = useState<RoomSummary | null>(null);
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
  const [nightConversationDraft, setNightConversationDraft] = useState("");
  const [copiedInviteRoomCode, setCopiedInviteRoomCode] = useState<string | null>(null);
  const copiedInviteResetTimerRef = useRef<number | null>(null);
  const ignoredRoomCodeRef = useRef<string | null>(null);
  const identityTokenRef = useRef<string | null>(null);
  const roomSummaryRef = useRef<RoomSummary | null>(null);
  const roomMembershipChannelRef = useRef<BroadcastChannel | null>(null);
  const nextCurrentRoomRequestIdRef = useRef(0);
  const appliedCurrentRoomRequestIdRef = useRef(0);
  const roomSessionIdRef = useRef(0);
  const startSettingsRoomSessionIdRef = useRef<string | null>(null);
  const nextRoomRequestIdRef = useRef(0);
  const appliedRoomSnapshotRef = useRef<AppliedRoomSnapshot | null>(null);
  const isBusyRef = useRef(false);
  const liveShellRef = useRef<HTMLElement>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [pendingActionKey, setPendingActionKey] = useState<string | null>(null);
  const [setupPendingAction, setSetupPendingAction] = useState<SetupPendingAction>(null);
  const [liveOrigin, setLiveOrigin] = useState<string | null>(null);
  const handleDisplayCommit = useCallback(
    (summary: RoomSummary, origin: LiveDisplayCommitOrigin) => {
      if (origin === "animation") {
        // The GSAP exit tween must reveal the new React surface from its first frame.
        flushSync(() => setDisplayedRoomSummary(summary));
        return;
      }

      setDisplayedRoomSummary(summary);
    },
    [],
  );
  const {
    acceptSummary: acceptEffectSummary,
    activeCue,
    clearEffects,
    commitActiveCueDisplay,
    completeActiveCue,
    replayRole,
  } = useLiveEffectQueue({ onDisplayCommit: handleDisplayCommit });
  const { completeCue: completeActionFeedbackCue, cue: actionFeedbackCue } =
    useLiveActionFeedback(displayedRoomSummary);
  const {
    clearScope: clearToastScope,
    completeEntry: completeToastEntry,
    completeExit: completeToastExit,
    dismiss: dismissToast,
    discardScope: discardToastScope,
    request: requestToast,
    state: toastState,
  } = useLiveToastController();

  const captureRoomToastScope = useCallback(
    (): LiveToastScope =>
      createLiveToastRoomSessionScope(
        roomSessionIdRef.current,
        roomSummaryRef.current?.game?.gameId ?? null,
      ),
    [],
  );

  const showToast = useCallback(
    (
      message: string,
      tone: LiveToastTone = "info",
      durationMs = TOAST_DEFAULT_DURATION_MS,
      scope: LiveToastScope = LIVE_TOAST_PAGE_SCOPE,
    ) => {
      if (scope.kind === "roomSession") {
        if (
          scope.sessionId !== roomSessionIdRef.current ||
          scope.gameId !== (roomSummaryRef.current?.game?.gameId ?? null)
        ) {
          return;
        }
      }

      requestToast({
        message,
        scope,
        timeoutMs: durationMs > 0 ? durationMs : null,
        tone,
      });
    },
    [requestToast],
  );

  const updateIdentityToken = useCallback((nextIdentityToken: string | null) => {
    identityTokenRef.current = nextIdentityToken;
    setIdentityToken(nextIdentityToken);
  }, []);

  const clearGameBoundUiState = useCallback(() => {
    setPendingActionKey(null);
    setIsNightConversationOpen(false);
    setIsPublicLogOpen(false);
    setNightConversationDraft("");
    setIsStartSettingsOpen(false);
    setIsLeaveConfirmationOpen(false);
  }, []);

  const markBrowserStorageUnavailable = useCallback(() => {
    clearEffects();
    clearToastScope(captureRoomToastScope());
    clearGameBoundUiState();
    updateIdentityToken(null);
    roomSummaryRef.current = null;
    appliedRoomSnapshotRef.current = null;
    startSettingsRoomSessionIdRef.current = null;
    setBrowserStorageStatus("unavailable");
    setIsIdentityHydrated(true);
    setIsCurrentRoomReady(false);
    setRoomSummary(null);
    setDisplayedRoomSummary(null);
    setPendingRoomSwitch(null);
    setRealtimeAuthorization(null);
    setStartRuleSetSettings(DEFAULT_START_RULE_SET_SETTINGS);
  }, [
    captureRoomToastScope,
    clearEffects,
    clearGameBoundUiState,
    clearToastScope,
    updateIdentityToken,
  ]);

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
    clearToastScope(captureRoomToastScope());
    roomSessionIdRef.current += 1;
    nextCurrentRoomRequestIdRef.current += 1;
    appliedCurrentRoomRequestIdRef.current = nextCurrentRoomRequestIdRef.current;
    appliedRoomSnapshotRef.current = null;
    ignoredRoomCodeRef.current = null;
    startSettingsRoomSessionIdRef.current = null;
    setStartRuleSetSettings(DEFAULT_START_RULE_SET_SETTINGS);
    clearGameBoundUiState();
  }, [captureRoomToastScope, clearEffects, clearGameBoundUiState, clearToastScope]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      if (!verifyBrowserStorageAccess()) {
        markBrowserStorageUnavailable();
        return;
      }

      const requestedRoomCode = getRoomCodeSearchParam(window.location.search);
      const savedIdentityToken = readStorage(IDENTITY_STORAGE_KEY);
      const savedDisplayName = readStorage(DISPLAY_NAME_STORAGE_KEY);
      const nextDisplayName = savedDisplayName?.trim()
        ? savedDisplayName
        : createDefaultDisplayName();

      setLiveOrigin(window.location.origin);
      removeStorage(LEGACY_ROOM_CODE_STORAGE_KEY);

      if (savedDisplayName !== nextDisplayName) {
        writeStorage(DISPLAY_NAME_STORAGE_KEY, nextDisplayName);
      }

      if (savedIdentityToken !== null) {
        updateIdentityToken(savedIdentityToken);
      } else {
        setIsCurrentRoomReady(true);
      }

      setDisplayName(nextDisplayName);

      if (requestedRoomCode !== null) {
        setInvitationRoomCode(requestedRoomCode);
        setRoomCodeInput(requestedRoomCode);
      }

      setBrowserStorageStatus("available");
      setIsIdentityHydrated(true);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [markBrowserStorageUnavailable, updateIdentityToken]);

  useEffect(
    () => () => {
      if (copiedInviteResetTimerRef.current !== null) {
        window.clearTimeout(copiedInviteResetTimerRef.current);
      }
    },
    [],
  );

  async function createIdentityToken(): Promise<string> {
    assertBrowserStorageAccess();
    const identity = await apiFetch<IdentityResponse>("/api/identity", { method: "POST" });

    writeStorage(IDENTITY_STORAGE_KEY, identity.token);
    updateIdentityToken(identity.token);

    return identity.token;
  }

  async function ensureIdentityToken(): Promise<string> {
    assertBrowserStorageAccess();

    if (identityToken !== null) {
      return identityToken;
    }

    return createIdentityToken();
  }

  const clearCurrentRoom = useCallback(
    (options: ClearCurrentRoomOptions = {}) => {
      try {
        removeStorage(LEGACY_ROOM_CODE_STORAGE_KEY);
        removeStorage(START_SETTINGS_STORAGE_KEY);
      } catch (error) {
        if (isBrowserStorageUnavailableError(error)) {
          markBrowserStorageUnavailable();
          return;
        }

        throw error;
      }

      clearEffects();
      clearToastScope(captureRoomToastScope());
      roomSessionIdRef.current += 1;
      nextCurrentRoomRequestIdRef.current += 1;
      appliedCurrentRoomRequestIdRef.current = nextCurrentRoomRequestIdRef.current;
      appliedRoomSnapshotRef.current = null;
      ignoredRoomCodeRef.current = options.ignoredRoomCode ?? null;
      roomSummaryRef.current = null;
      startSettingsRoomSessionIdRef.current = null;
      setRoomSummary(null);
      setDisplayedRoomSummary(null);
      setIsCurrentRoomReady(true);
      setPendingRoomSwitch(null);

      if (!(options.preserveRoomCodeInput ?? false)) {
        setRoomCodeInput("");
      }

      setPendingActionKey(null);
      setIsNightConversationOpen(false);
      setIsPublicLogOpen(false);
      setNightConversationDraft("");
      setStartRuleSetSettings(DEFAULT_START_RULE_SET_SETTINGS);
      setIsStartSettingsOpen(false);
      setIsLeaveConfirmationOpen(false);
      window.requestAnimationFrame(() => window.scrollTo({ left: 0, top: 0 }));
    },
    [captureRoomToastScope, clearEffects, clearToastScope, markBrowserStorageUnavailable],
  );

  const resetInvalidIdentity = useCallback(
    (nextStatusMessage = invalidIdentityStatusMessage) => {
      try {
        removeStorage(IDENTITY_STORAGE_KEY);
      } catch (error) {
        if (isBrowserStorageUnavailableError(error)) {
          markBrowserStorageUnavailable();
          return;
        }

        throw error;
      }

      updateIdentityToken(null);
      setIsCurrentRoomReady(true);
      showToast(nextStatusMessage, "warning", TOAST_IMPORTANT_DURATION_MS);
      clearCurrentRoom({ preserveRoomCodeInput: true });
    },
    [
      clearCurrentRoom,
      invalidIdentityStatusMessage,
      markBrowserStorageUnavailable,
      showToast,
      updateIdentityToken,
    ],
  );

  async function withBusy(
    work: () => Promise<void>,
    pendingAction: SetupPendingAction = null,
  ): Promise<void> {
    if (isBusyRef.current) {
      return;
    }

    const toastScope = captureRoomToastScope();
    isBusyRef.current = true;
    setIsBusy(true);
    setSetupPendingAction(pendingAction);

    try {
      await work();
    } catch (error) {
      if (isBrowserStorageUnavailableError(error)) {
        markBrowserStorageUnavailable();
        return;
      }

      if (isUnauthorizedRequestError(error)) {
        resetInvalidIdentity();
        return;
      }

      const failureMessage = toRequestFailureMessage(error, t);

      showToast(failureMessage, "error", TOAST_IMPORTANT_DURATION_MS, toastScope);
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

  const syncStartSettingsForRoom = useCallback((summary: RoomSummary): void => {
    const session = getStartSettingsRoomSession(summary);

    if (session === null) {
      const storedSettings = readStorage(START_SETTINGS_STORAGE_KEY);

      if (storedSettings !== null) {
        removeStorage(START_SETTINGS_STORAGE_KEY);
      }

      if (startSettingsRoomSessionIdRef.current !== null) {
        startSettingsRoomSessionIdRef.current = null;
        setStartRuleSetSettings(DEFAULT_START_RULE_SET_SETTINGS);
      }

      return;
    }

    const sessionId = getStartSettingsRoomSessionId(session);

    if (startSettingsRoomSessionIdRef.current === sessionId) {
      return;
    }

    const storedSettings = readStorage(START_SETTINGS_STORAGE_KEY);
    const restoredSettings =
      storedSettings === null
        ? null
        : parseStartSettings(storedSettings, session, summary.roleCatalog);

    if (storedSettings !== null && restoredSettings === null) {
      removeStorage(START_SETTINGS_STORAGE_KEY);
    }

    startSettingsRoomSessionIdRef.current = sessionId;
    setStartRuleSetSettings(restoredSettings ?? DEFAULT_START_RULE_SET_SETTINGS);
  }, []);

  const rememberRoom = useCallback(
    (nextSummary: RoomSummary, requestContext: RoomRequestContext) => {
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

      try {
        writeStorage(DISPLAY_NAME_STORAGE_KEY, displayName);
        syncStartSettingsForRoom(nextSummary);
      } catch (error) {
        if (isBrowserStorageUnavailableError(error)) {
          markBrowserStorageUnavailable();
          return false;
        }

        throw error;
      }

      const previousSummary = roomSummaryRef.current;
      const crossedGameBoundary = hasLiveGameBoundary(previousSummary, nextSummary);

      if (crossedGameBoundary) {
        discardToastScope(captureRoomToastScope());
        clearGameBoundUiState();
      }

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

      return true;
    },
    [
      acceptEffectSummary,
      captureRoomToastScope,
      clearGameBoundUiState,
      discardToastScope,
      displayName,
      isRoomRequestContextCurrent,
      markBrowserStorageUnavailable,
      syncStartSettingsForRoom,
    ],
  );

  const syncCurrentRoom = useCallback(
    async (token: string): Promise<RoomSummary | null> => {
      if (!verifyBrowserStorageAccess()) {
        markBrowserStorageUnavailable();
        return null;
      }

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
      const didRememberRoom = rememberRoom(response.room, requestContext);

      return didRememberRoom ? response.room : roomSummaryRef.current;
    },
    [
      beginRoomSession,
      clearCurrentRoom,
      createRoomRequestContext,
      markBrowserStorageUnavailable,
      rememberRoom,
    ],
  );

  useEffect(() => {
    if (!isIdentityHydrated || identityToken === null) {
      return;
    }

    let isCancelled = false;
    const toastScope = captureRoomToastScope();
    const timerId = window.setTimeout(() => {
      void syncCurrentRoom(identityToken).catch((error: unknown) => {
        if (isCancelled) {
          return;
        }

        if (isUnauthorizedRequestError(error)) {
          resetInvalidIdentity();
          return;
        }

        showToast(
          t.live.room.currentCouldNotLoad,
          "error",
          TOAST_IMPORTANT_DURATION_MS,
          toastScope,
        );
      });
    }, 0);

    return () => {
      isCancelled = true;
      window.clearTimeout(timerId);
    };
  }, [
    captureRoomToastScope,
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
  const activeGameSessionKey = getLiveGameSessionKey(roomSummary);
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
    const abortController = new AbortController();

    async function refreshRealtimeAuthorization(): Promise<void> {
      if (!verifyBrowserStorageAccess()) {
        markBrowserStorageUnavailable();
        return;
      }

      try {
        const authorization = await apiFetch<RealtimeAuthorization>(
          `/api/rooms/${activeRoomCode}/realtime-token`,
          { method: "POST", signal: abortController.signal, token: activeToken },
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
      abortController.abort();
      if (refreshTimerId !== null) {
        window.clearTimeout(refreshTimerId);
      }
    };
  }, [
    activeGameSessionKey,
    activeRoomCode,
    identityToken,
    markBrowserStorageUnavailable,
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
      const toastScope = captureRoomToastScope();
      try {
        await syncCurrentRoom(activeToken);
      } catch (error) {
        if (!isCancelled) {
          if (isUnauthorizedRequestError(error)) {
            resetInvalidIdentity();
            return;
          }

          if (isCurrentRoomReady) {
            showToast(t.live.room.syncFailed, "warning", TOAST_IMPORTANT_DURATION_MS, toastScope);
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
    captureRoomToastScope,
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

      if (!verifyBrowserStorageAccess()) {
        markBrowserStorageUnavailable();
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
          rememberRoom(summary, requestContext);
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
    markBrowserStorageUnavailable,
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
    const toastScope = captureRoomToastScope();
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

          showToast(nextStatusMessage, "warning", TOAST_IMPORTANT_DURATION_MS, toastScope);
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
    captureRoomToastScope,
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
          captureRoomToastScope(),
        );
        return;
      }

      setPendingRoomSwitch({
        isOpen: true,
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
    [captureRoomToastScope, showToast, t.live.room],
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
    if (pendingRoomSwitch === null || !pendingRoomSwitch.isOpen || roomSummary === null) {
      return;
    }

    const toastScope = captureRoomToastScope();
    const timerId = window.setTimeout(() => {
      if (pendingRoomSwitch.request.expectedCurrentRoomCode !== roomSummary.code) {
        setPendingRoomSwitch(null);
        showToast(t.live.room.currentChanged, "warning", TOAST_IMPORTANT_DURATION_MS, toastScope);
        return;
      }

      if (roomSummary.status === "playing") {
        setPendingRoomSwitch(null);
        showToast(
          t.live.room.switchForbidden(roomSummary.code),
          "warning",
          TOAST_IMPORTANT_DURATION_MS,
          toastScope,
        );
      }
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [captureRoomToastScope, pendingRoomSwitch, roomSummary, showToast, t.live.room]);

  function handleDisplayNameChange(nextDisplayName: string): void {
    try {
      writeStorage(DISPLAY_NAME_STORAGE_KEY, nextDisplayName);
      setDisplayName(nextDisplayName);
    } catch (error) {
      if (isBrowserStorageUnavailableError(error)) {
        markBrowserStorageUnavailable();
        return;
      }

      throw error;
    }
  }

  function handleApplyStartSettings(nextSettings: StartRuleSetSettings): void {
    const session = roomSummary === null ? null : getStartSettingsRoomSession(roomSummary);

    if (session === null) {
      return;
    }

    try {
      writeStorage(START_SETTINGS_STORAGE_KEY, serializeStartSettings(session, nextSettings));
      startSettingsRoomSessionIdRef.current = getStartSettingsRoomSessionId(session);
      setStartRuleSetSettings(nextSettings);
    } catch (error) {
      if (isBrowserStorageUnavailableError(error)) {
        markBrowserStorageUnavailable();
        return;
      }

      throw error;
    }
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

  function handleStartGame(): void {
    void withBusy(async () => {
      const token = await ensureIdentityToken();
      const roomCode = requireRoomCode(roomSummary?.code ?? roomCodeInput, t);
      const expectedRosterRevision = roomSummary?.rosterRevision;

      if (expectedRosterRevision === undefined) {
        throw new Error(t.live.hints.startNeedsRoom);
      }

      const requestContext = createRoomRequestContext(roomCode, token);
      const summary = await apiFetch<RoomSummary>(`/api/rooms/${roomCode}/start`, {
        body: {
          expectedRosterRevision,
          ruleSet: buildStartRuleSetInput(startRuleSetSettings),
        },
        method: "POST",
        token,
      });

      rememberRoom(summary, requestContext);
    });
  }

  function handleSetLobbyReady(isReady: boolean): void {
    void withBusy(async () => {
      const token = await ensureIdentityToken();
      const roomCode = requireRoomCode(roomSummary?.code ?? roomCodeInput, t);
      const expectedRosterRevision = roomSummary?.rosterRevision;

      if (expectedRosterRevision === undefined) {
        throw new Error(t.live.hints.startNeedsRoom);
      }

      const requestContext = createRoomRequestContext(roomCode, token);
      const summary = await apiFetch<RoomSummary>(`/api/rooms/${roomCode}/readiness`, {
        body: { expectedRosterRevision, isReady },
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

    if (pendingSwitch === null || !pendingSwitch.isOpen) {
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
        setPendingRoomSwitch((currentSwitch) =>
          currentSwitch === null ? null : { ...currentSwitch, isOpen: false },
        );
        setInvitationRoomCode(null);
        broadcastRoomMembershipInvalidation();
      } catch (error) {
        if (
          isApiRequestErrorCode(error, "current_room_changed") ||
          isApiRequestErrorCode(error, "room_switch_forbidden")
        ) {
          const failureMessage = toRequestFailureMessage(error, t);

          setPendingRoomSwitch((currentSwitch) =>
            currentSwitch === null ? null : { ...currentSwitch, isOpen: false },
          );
          await syncCurrentRoom(token);
          showToast(failureMessage, "error", TOAST_IMPORTANT_DURATION_MS, captureRoomToastScope());
          return;
        }

        throw error;
      }
    });
  }

  function handleSubmitAction(action: PublicAction, targetPlayerId: string | null): void {
    void withBusy(async () => {
      setPendingActionKey(action.key);

      try {
        const token = await ensureIdentityToken();
        const roomCode = requireRoomCode(roomSummary?.code ?? roomCodeInput, t);
        const expectedRevision = roomSummary?.game?.revision;
        const gameId = roomSummary?.game?.gameId;

        if (expectedRevision === undefined || gameId === undefined) {
          throw new Error(t.live.status.actionWindowClosed);
        }

        const requestContext = createRoomRequestContext(roomCode, token);
        const summary = await apiFetch<RoomSummary>(`/api/rooms/${roomCode}/action`, {
          body: {
            actionKey: action.key,
            gameId,
            phaseInstanceId: action.phaseInstanceId,
            revision: expectedRevision,
            targetPlayerId,
          },
          method: "POST",
          token,
        });

        rememberRoom(summary, requestContext);
      } finally {
        setPendingActionKey((currentActionKey) =>
          currentActionKey === action.key ? null : currentActionKey,
        );
      }
    });
  }

  function handleSendNightConversation(conversation: NightConversationView): void {
    void withBusy(async () => {
      const token = await ensureIdentityToken();
      const roomCode = requireRoomCode(roomSummary?.code ?? roomCodeInput, t);
      const phaseInstanceId = roomSummary?.game?.phaseInstanceId;
      const gameId = roomSummary?.game?.gameId;

      if (phaseInstanceId === null || phaseInstanceId === undefined || gameId === undefined) {
        throw new Error(t.live.status.nightChatClosed);
      }

      const requestContext = createRoomRequestContext(roomCode, token);
      const summary = await apiFetch<RoomSummary>(`/api/rooms/${roomCode}/night-conversation`, {
        body: {
          body: nightConversationDraft,
          conversationGroupId: conversation.groupId,
          gameId,
          nightNumber: conversation.nightNumber,
          phaseInstanceId,
        },
        method: "POST",
        token,
      });

      setNightConversationDraft("");
      rememberRoom(summary, requestContext);
    });
  }

  async function handleCopyRoomCode(roomCode: string): Promise<void> {
    const toastScope = captureRoomToastScope();
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

    showToast(t.live.invite.copyFailed, "error", TOAST_IMPORTANT_DURATION_MS, toastScope);
  }

  async function handleShareRoom(roomCode: string): Promise<void> {
    const toastScope = captureRoomToastScope();
    const roomUrl = getLiveRoomUrl(roomCode, window.location.origin);
    const inviteText = t.live.invite.inviteText(roomCode, roomUrl);

    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          text: t.live.invite.shareText(roomCode),
          title: "Jinroh Web",
          url: roomUrl,
        });
        showToast(t.live.invite.shareSucceeded, "success", TOAST_DEFAULT_DURATION_MS, toastScope);
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
      }
    }

    const didCopy = await writeClipboardText(inviteText);

    if (didCopy) {
      showToast(
        t.live.invite.shareFallbackCopied,
        "success",
        TOAST_DEFAULT_DURATION_MS,
        toastScope,
      );
      return;
    }

    showToast(t.live.invite.shareFailed, "error", TOAST_IMPORTANT_DURATION_MS, toastScope);
  }

  const presentationSummary = displayedRoomSummary;
  const isCurrentRoomParticipant =
    presentationSummary !== null && presentationSummary.currentPlayerId !== null;
  const selfActions = isCurrentRoomParticipant ? (presentationSummary.self?.actions ?? []) : [];
  const isCurrentGameCinematicObscured =
    activeCue !== null && activeCue.gameId === roomSummary?.game?.gameId;
  const canConfigureStartSettings =
    isCurrentRoomParticipant &&
    presentationSummary.isHost &&
    (presentationSummary.status === "waiting" || presentationSummary.status === "ended");
  const canLeaveRoom =
    isCurrentRoomParticipant &&
    (presentationSummary.status === "waiting" || presentationSummary.status === "ended");
  let roomBoundSurfaceStatus: RoomBoundSurfaceStatus | null = null;

  if (isCurrentRoomParticipant && presentationSummary.status === "waiting") {
    roomBoundSurfaceStatus = "waiting";
  } else if (
    isCurrentRoomParticipant &&
    presentationSummary.game !== null &&
    (presentationSummary.status === "playing" || presentationSummary.status === "ended")
  ) {
    roomBoundSurfaceStatus = presentationSummary.status;
  }

  const liveMood = getLiveMood(presentationSummary);
  const liveBackgroundSnapshot = useMemo(
    () =>
      getLiveBackgroundSnapshot(
        liveMood,
        presentationSummary?.code ?? null,
        presentationSummary?.currentPlayerId ?? null,
        presentationSummary?.game?.gameId ?? null,
      ),
    [
      liveMood,
      presentationSummary?.code,
      presentationSummary?.currentPlayerId,
      presentationSummary?.game?.gameId,
    ],
  );
  const isBrowserStorageUnavailable = browserStorageStatus === "unavailable";
  const isRoomEntryAvailable =
    browserStorageStatus === "available" && presentationSummary === null && isCurrentRoomReady;
  let liveSetupSurfaceKind: LiveSetupSurfaceKind = "game";

  if (!isCurrentRoomReady) {
    liveSetupSurfaceKind = "loading";
  } else if (roomBoundSurfaceStatus === "waiting") {
    liveSetupSurfaceKind = "waiting";
  } else if (presentationSummary === null) {
    liveSetupSurfaceKind = "entry";
  }

  const liveSetupRoomCode = presentationSummary?.code ?? null;
  const liveSetupViewerPlayerId = presentationSummary?.currentPlayerId ?? null;
  const liveSetupTransitionSnapshot = useMemo(
    (): LiveSetupTransitionSnapshot => ({
      kind: liveSetupSurfaceKind,
      roomCode: liveSetupRoomCode,
      viewerPlayerId: liveSetupViewerPlayerId,
    }),
    [liveSetupRoomCode, liveSetupSurfaceKind, liveSetupViewerPlayerId],
  );
  const liveShellClassName = [
    "liveShell",
    liveViewportStyles["shell"],
    `liveMood-${liveMood}`,
    roomBoundSurfaceStatus === null
      ? liveViewportStyles["entryShell"]
      : liveViewportStyles["roomShell"],
  ]
    .filter(Boolean)
    .join(" ");
  const roomInviteUrl =
    liveOrigin === null || presentationSummary === null
      ? null
      : getLiveRoomUrl(presentationSummary.code, liveOrigin);
  let roomBoundSurface: ReactNode = null;

  if (presentationSummary !== null && roomBoundSurfaceStatus === "waiting") {
    roomBoundSurface = (
      <LiveWaitingSurface
        copiedRoomCode={copiedInviteRoomCode}
        isBusy={isBusy}
        isSettingsOpen={isStartSettingsOpen}
        roomStatusLabel={formatRoomStatus(presentationSummary, t)}
        roomUrl={roomInviteUrl}
        summary={presentationSummary}
        t={t}
        onCopyRoomCode={handleCopyRoomCode}
        onOpenSettings={() => setIsStartSettingsOpen(true)}
        onRequestLeaveRoom={() => setIsLeaveConfirmationOpen(true)}
        onSetLobbyReady={handleSetLobbyReady}
        onShareRoom={handleShareRoom}
        onStartGame={handleStartGame}
      />
    );
  } else if (presentationSummary !== null && roomBoundSurfaceStatus === "playing") {
    roomBoundSurface = (
      <LivePlayingSurface
        actionFeedbackCue={actionFeedbackCue}
        isBusy={isBusy}
        isNightConversationOpen={isNightConversationOpen}
        isPublicLogOpen={isPublicLogOpen}
        isCinematicObscured={isCurrentGameCinematicObscured}
        nightConversationDraft={nightConversationDraft}
        pendingActionKey={pendingActionKey}
        selfActions={selfActions}
        summary={presentationSummary}
        locale={locale}
        t={t}
        onActionFeedbackComplete={completeActionFeedbackCue}
        onCloseNightConversation={() => setIsNightConversationOpen(false)}
        onClosePublicLog={() => setIsPublicLogOpen(false)}
        onNightConversationDraftChange={setNightConversationDraft}
        onOpenNightConversation={() => setIsNightConversationOpen(true)}
        onOpenPublicLog={() => setIsPublicLogOpen(true)}
        onRevealRole={replayRole}
        onSendNightConversation={handleSendNightConversation}
        onSubmitAction={handleSubmitAction}
      />
    );
  } else if (presentationSummary !== null && roomBoundSurfaceStatus === "ended") {
    roomBoundSurface = (
      <LiveEndedSurface
        copiedRoomCode={copiedInviteRoomCode}
        isBusy={isBusy}
        isSettingsOpen={isStartSettingsOpen}
        isPublicLogOpen={isPublicLogOpen}
        isCinematicObscured={isCurrentGameCinematicObscured}
        locale={locale}
        roomUrl={roomInviteUrl}
        summary={presentationSummary}
        t={t}
        onClosePublicLog={() => setIsPublicLogOpen(false)}
        onCopyRoomCode={handleCopyRoomCode}
        onOpenSettings={() => setIsStartSettingsOpen(true)}
        onOpenPublicLog={() => setIsPublicLogOpen(true)}
        onRequestLeaveRoom={() => setIsLeaveConfirmationOpen(true)}
        onSetLobbyReady={handleSetLobbyReady}
        onShareRoom={handleShareRoom}
        onStartGame={handleStartGame}
      />
    );
  }

  function renderRoomEntrySurface(): ReactNode {
    if (isBrowserStorageUnavailable) {
      return (
        <section
          className={`liveEntrySurface ${liveViewportStyles["entrySurface"]}`}
          data-live-storage-unavailable
        >
          <article className="liveSetupPanel" role="alert">
            <div className="liveSetupPanelHeader">
              <div>
                <p className="liveSetupPanelKicker">{t.live.storageUnavailable.kicker}</p>
                <h3>{t.live.storageUnavailable.title}</h3>
              </div>
            </div>
            <div className="liveSetupPanelBody">
              <p className="liveSetupHint">{t.live.storageUnavailable.body}</p>
            </div>
          </article>
        </section>
      );
    }

    if (isRoomEntryAvailable) {
      return (
        <LiveEntrySurface
          displayName={displayName}
          initialEntryMode="join"
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
      );
    }

    return (
      <section className="livePanel liveRoomPanel" aria-label={t.live.aria.roomState}>
        <div className="livePanelHeading">
          <span>{t.live.page.roomEntry}</span>
        </div>
        <div className="liveEmptyState compact" role="status">
          <strong>{t.live.room.checkingCurrent}</strong>
        </div>
      </section>
    );
  }

  const roomEntrySurface = renderRoomEntrySurface();

  return (
    <main className={liveShellClassName} data-live-mood={liveMood} ref={liveShellRef}>
      <LiveBackground snapshot={liveBackgroundSnapshot} />
      <LiveSetupTransitionController
        rootRef={liveShellRef}
        snapshot={liveSetupTransitionSnapshot}
      />
      {presentationSummary !== null && roomBoundSurfaceStatus !== null ? (
        <LiveRoomLayout
          controls={roomBoundSurface}
          table={<LiveRoundTable locale={locale} summary={presentationSummary} t={t} />}
          tableLabel={t.live.aria.roundTable}
          title={getLivePageTitle(presentationSummary, t)}
          transitionItem={roomBoundSurfaceStatus === "waiting" ? "waiting" : undefined}
        />
      ) : (
        <>
          <section
            className={`liveHero ${liveViewportStyles["entryHeader"]}`}
            data-live-entry-header
          >
            <div className="liveHeroTitle liveEntryBrand">
              <h1 className="liveEntryBrandHeading">
                <JinrohBrandLink />
              </h1>
            </div>
            <div className="liveHeroTitle liveEntryStatus">
              <h2>{getLivePageTitle(presentationSummary, t)}</h2>
            </div>
            {isRoomEntryAvailable || isBrowserStorageUnavailable ? (
              <LanguageSwitcher className="liveEmbeddedLanguageSwitcher liveEntryLanguageSwitcher" />
            ) : null}
          </section>
          {roomEntrySurface}
        </>
      )}

      {canConfigureStartSettings ? (
        <StartSettingsDialog
          defaultRoleCounts={presentationSummary.defaultRoleCounts}
          isOpen={isStartSettingsOpen}
          locale={locale}
          playerCount={presentationSummary.targetPlayerCount}
          roleCatalog={presentationSummary.roleCatalog}
          settings={startRuleSetSettings}
          t={t}
          onClose={() => setIsStartSettingsOpen(false)}
          onApplySettings={handleApplyStartSettings}
        />
      ) : null}

      {presentationSummary !== null && canLeaveRoom ? (
        <LeaveRoomDialog
          isBusy={isBusy}
          isOpen={isLeaveConfirmationOpen}
          t={t}
          onClose={() => setIsLeaveConfirmationOpen(false)}
          onConfirm={handleConfirmLeaveRoom}
        />
      ) : null}

      {pendingRoomSwitch === null || roomSummary === null ? null : (
        <SwitchRoomDialog
          isBusy={isBusy}
          isOpen={pendingRoomSwitch.isOpen}
          request={pendingRoomSwitch.request}
          t={t}
          onClose={() =>
            setPendingRoomSwitch((currentSwitch) =>
              currentSwitch === null ? null : { ...currentSwitch, isOpen: false },
            )
          }
          onConfirm={handleConfirmRoomSwitch}
          onExitComplete={() =>
            setPendingRoomSwitch((currentSwitch) =>
              currentSwitch?.isOpen === false ? null : currentSwitch,
            )
          }
        />
      )}

      <LiveGameEffects
        activeCue={activeCue}
        locale={locale}
        onDisplayCommit={commitActiveCueDisplay}
        shellRef={liveShellRef}
        summary={roomSummary}
        t={t}
        onComplete={completeActiveCue}
      />
      <LiveToastRegion
        state={toastState}
        t={t}
        onDismiss={dismissToast}
        onEntryComplete={completeToastEntry}
        onExitComplete={completeToastExit}
      />
    </main>
  );
}
