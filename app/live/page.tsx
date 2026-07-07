"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { getSupabaseRealtimeClient } from "@/lib/client/supabaseRealtime";
import {
  DEFAULT_RULE_SET,
  makeDefaultRuleSetForPlayers,
  ROLE_DEFINITIONS,
  ROLE_IDS,
  type NightConversationView,
  type PrivateGameEvent,
  type PublicAction,
  type PublicPlayer,
  type RealtimeSubscription,
  type RoomSummary,
  type RuleSetInput,
} from "@/lib/shared/game";

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

type StartRuleSetSettings = Omit<RuleSetInput, "roleCounts">;

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

const IDENTITY_STORAGE_KEY = "jinrohWeb.identityToken";
const DISPLAY_NAME_STORAGE_KEY = "jinrohWeb.displayName";
const ROOM_CODE_STORAGE_KEY = "jinrohWeb.roomCode";
const HEARTBEAT_INTERVAL_MS = 20_000;
const ROOM_SYNC_INTERVAL_MS = 4_000;

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

export default function LivePage() {
  const [identityToken, setIdentityToken] = useState(() => readStorage(IDENTITY_STORAGE_KEY));
  const [displayName, setDisplayName] = useState(
    () => readStorage(DISPLAY_NAME_STORAGE_KEY) ?? "Sora",
  );
  const [roomCodeInput, setRoomCodeInput] = useState(
    () => readStorage(ROOM_CODE_STORAGE_KEY) ?? "",
  );
  const [roomSummary, setRoomSummary] = useState<RoomSummary | null>(null);
  const [startRuleSetSettings, setStartRuleSetSettings] = useState<StartRuleSetSettings>(
    DEFAULT_START_RULE_SET_SETTINGS,
  );
  const [isNightConversationOpen, setIsNightConversationOpen] = useState(false);
  const [nightConversationDraft, setNightConversationDraft] = useState("");
  const [targetByActionKey, setTargetByActionKey] = useState<Record<string, string>>({});
  const [statusMessage, setStatusMessage] = useState(
    "Create a room or join with a six-digit code.",
  );
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
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
        setRoomCodeInput(savedRoomCode);
      }
    }, 0);

    return () => window.clearTimeout(timerId);
  }, []);

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
      writeStorage(DISPLAY_NAME_STORAGE_KEY, displayName);
      writeStorage(ROOM_CODE_STORAGE_KEY, nextSummary.code);
      setRoomCodeInput(nextSummary.code);
      setRoomSummary(nextSummary);

      if (options.resetActionTargets ?? true) {
        setTargetByActionKey({});
      }
    },
    [displayName],
  );

  const activeRoomCode = roomSummary?.code ?? null;
  const activePhaseEndsAt = roomSummary?.game?.phaseEndsAt ?? null;
  const activePhaseInstanceId = roomSummary?.game?.phaseInstanceId ?? null;
  const activeRealtimeSubscriptionKey = toRealtimeSubscriptionKey(roomSummary?.realtime ?? null);
  const isHostInPlayingRoom =
    roomSummary?.isHost === true &&
    roomSummary.status === "playing" &&
    roomSummary.game?.status === "playing";

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
  }, [activeRoomCode, identityToken, rememberRoom]);

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
  }, [activeRoomCode, identityToken, rememberRoom, roomSummary?.currentPlayerId]);

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
  }, [activeRealtimeSubscriptionKey, activeRoomCode, identityToken, rememberRoom]);

  useEffect(() => {
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
    writeStorage(ROOM_CODE_STORAGE_KEY, normalizedRoomCode);
  }

  function handleCreateRoom(): void {
    void withBusy(async () => {
      const token = await ensureIdentityToken();
      const summary = await apiFetch<RoomSummary>("/api/rooms", {
        body: { displayName },
        method: "POST",
        token,
      });

      rememberRoom(summary);
      setStatusMessage(`Room ${summary.code} created. Share the code with players.`);
    });
  }

  function handleJoinRoom(): void {
    void withBusy(async () => {
      const roomCode = requireRoomCode(roomCodeInput);
      const token = await ensureIdentityToken();
      const summary = await apiFetch<RoomSummary>(`/api/rooms/${roomCode}/join`, {
        body: { displayName },
        method: "POST",
        token,
      });

      rememberRoom(summary);
      setStatusMessage(`Joined room ${summary.code}.`);
    });
  }

  function handleRefreshRoom(): void {
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

  function handleStartRuleSetChange<Key extends keyof StartRuleSetSettings>(
    key: Key,
    value: StartRuleSetSettings[Key],
  ): void {
    setStartRuleSetSettings((currentSettings) => ({
      ...currentSettings,
      [key]: value,
    }));
  }

  function handleStartRuleSetNumberChange(key: RuleSetNumberField, value: number): void {
    if (!Number.isFinite(value)) {
      return;
    }

    setStartRuleSetSettings((currentSettings) => ({
      ...currentSettings,
      [key]: clampRuleSetNumber(key, value),
    }));
  }

  function handleStartGame(): void {
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
    void withBusy(async () => {
      const token = await ensureIdentityToken();
      const roomCode = requireRoomCode(roomSummary?.code ?? roomCodeInput);
      const summary = await apiFetch<RoomSummary>(`/api/rooms/${roomCode}/leave`, {
        method: "POST",
        token,
      });

      rememberRoom(summary, { resetActionTargets: true });
      setStatusMessage("Left the room.");
    });
  }

  function handleSubmitAction(action: PublicAction): void {
    void withBusy(async () => {
      const token = await ensureIdentityToken();
      const roomCode = requireRoomCode(roomSummary?.code ?? roomCodeInput);
      const targetPlayerId = action.targetKind === "single_player" ? getActionTarget(action) : null;
      const summary = await apiFetch<RoomSummary>(`/api/rooms/${roomCode}/action`, {
        body: { actionKey: action.key, phaseInstanceId: action.phaseInstanceId, targetPlayerId },
        method: "POST",
        token,
      });

      rememberRoom(summary);
      setStatusMessage(`${action.label} submitted. Waiting for the table to catch up.`);
    });
  }

  function handleSendNightConversation(conversation: NightConversationView): void {
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

  function getActionTarget(action: PublicAction): string {
    return targetByActionKey[action.key] ?? action.eligibleTargetIds[0] ?? "";
  }

  const selfActions = roomSummary?.self?.actions ?? [];
  const roomStatusLabel = formatRoomStatus(roomSummary);
  const liveGuidance = getLiveGuidance(roomSummary, selfActions.length, isBusy);
  const canStartGame = !isBusy && canStartRoom(roomSummary);
  const canAdvancePhase =
    !isBusy &&
    roomSummary?.isHost === true &&
    roomSummary.status === "playing" &&
    roomSummary.game?.status === "playing";
  const startHint = getStartHint(roomSummary, isBusy);
  const advanceHint = getAdvanceHint(roomSummary, isBusy);
  const leaveHint = getLeaveHint(roomSummary, isBusy);

  return (
    <main className="liveShell">
      <section className="liveHero">
        <Link className="liveBackLink" href="/">
          Back to overview
        </Link>
        <div>
          <p className="liveKicker">Jinroh Web table</p>
          <h1>Run the table without leaking secrets.</h1>
          <p>
            Create a room, share the code, and let each browser show only the role, action, and
            result that player is allowed to see.
          </p>
        </div>
      </section>

      <section className="liveEntryPanel" aria-label="Room entry">
        <label>
          Display name
          <input
            autoComplete="nickname"
            maxLength={32}
            value={displayName}
            onChange={(event) => handleDisplayNameChange(event.target.value)}
          />
        </label>
        <label>
          Room code
          <input
            inputMode="numeric"
            maxLength={6}
            value={roomCodeInput}
            onChange={(event) => handleRoomCodeChange(event.target.value)}
          />
        </label>
        <div className="liveEntryActions">
          <button type="button" onClick={handleCreateRoom} disabled={isBusy}>
            Create room
          </button>
          <button
            className="secondaryButton"
            type="button"
            onClick={handleJoinRoom}
            disabled={isBusy}
          >
            Join
          </button>
          <button
            className="secondaryButton"
            type="button"
            onClick={handleRefreshRoom}
            disabled={isBusy}
          >
            Refresh
          </button>
        </div>
      </section>

      <section className="liveStatusBar" aria-live="polite">
        <span>{liveGuidance.label}</span>
        <strong>{liveGuidance.message}</strong>
        <small>{statusMessage}</small>
      </section>

      <div className="liveGrid">
        <section className="livePanel liveRoomPanel" aria-label="Room state">
          <div className="livePanelHeading">
            <span>Room</span>
            <strong>{roomStatusLabel}</strong>
          </div>

          {roomSummary === null ? (
            <EmptyRoomState />
          ) : (
            <>
              <RoomMetrics summary={roomSummary} />
              <PlayerList players={roomSummary.players} />
            </>
          )}
        </section>

        <section className="livePanel liveControlPanel" aria-label="Game controls">
          <div className="livePanelHeading">
            <span>Controls</span>
            <strong>{roomSummary?.isHost === true ? "Host" : "Player"}</strong>
          </div>

          {roomSummary?.isHost === true && roomSummary.status === "lobby" ? (
            <StartRuleSetPanel
              playerCount={roomSummary.players.length}
              settings={startRuleSetSettings}
              onNumberChange={handleStartRuleSetNumberChange}
              onSettingsChange={handleStartRuleSetChange}
            />
          ) : null}

          <div className="liveControlStack">
            <button
              className="primaryLiveButton"
              aria-describedby="start-game-hint"
              type="button"
              onClick={handleStartGame}
              disabled={!canStartGame}
            >
              Start game
            </button>
            <button
              className="secondaryButton"
              aria-describedby="advance-phase-hint"
              type="button"
              onClick={handleResolvePhase}
              disabled={!canAdvancePhase}
            >
              Advance phase
            </button>
            <button
              className="dangerButton"
              aria-describedby="leave-room-hint"
              type="button"
              onClick={handleLeaveRoom}
              disabled={isBusy || roomSummary === null}
            >
              Leave room
            </button>
          </div>
          <div className="liveControlHints">
            <p id="start-game-hint">{startHint}</p>
            <p id="advance-phase-hint">{advanceHint}</p>
            <p id="leave-room-hint">{leaveHint}</p>
          </div>

          <SelfView
            isNightConversationOpen={isNightConversationOpen}
            isBusy={isBusy}
            nightConversationDraft={nightConversationDraft}
            summary={roomSummary}
            onNightConversationDraftChange={setNightConversationDraft}
            onSendNightConversation={handleSendNightConversation}
            onToggleNightConversation={() =>
              setIsNightConversationOpen((currentValue) => !currentValue)
            }
          />
          <ActionList
            actions={selfActions}
            isBusy={isBusy}
            players={roomSummary?.players ?? []}
            targetByActionKey={targetByActionKey}
            onTargetChange={(actionKey, playerId) =>
              setTargetByActionKey((current) => ({ ...current, [actionKey]: playerId }))
            }
            onSubmitAction={handleSubmitAction}
          />
        </section>

        <section className="livePanel liveEventPanel" aria-label="Public event log">
          <div className="livePanelHeading">
            <span>Public log</span>
            <strong>{roomSummary?.game?.events.length ?? 0} events</strong>
          </div>
          <EventLog summary={roomSummary} />
        </section>
      </div>
    </main>
  );
}

function EmptyRoomState() {
  return (
    <div className="liveEmptyState">
      <strong>No room loaded</strong>
      <p>Create a room, or paste a six-digit code and join from a separate browser session.</p>
    </div>
  );
}

function RoomMetrics({ summary }: { readonly summary: RoomSummary }) {
  const game = summary.game;

  return (
    <dl className="liveMetrics">
      <div>
        <dt>Code</dt>
        <dd>{summary.code}</dd>
      </div>
      <div>
        <dt>Players</dt>
        <dd>{summary.players.length}</dd>
      </div>
      <div>
        <dt>Phase</dt>
        <dd>{game?.phase ?? "setup"}</dd>
      </div>
      <div>
        <dt>Window</dt>
        <dd>{formatPhaseWindow(game?.phaseInstanceId ?? null)}</dd>
      </div>
      <div>
        <dt>Progress</dt>
        <dd>{formatActionProgress(game?.actionProgress ?? null)}</dd>
      </div>
      <div>
        <dt>Ends</dt>
        <dd>{formatDateTime(game?.phaseEndsAt ?? null)}</dd>
      </div>
      <div>
        <dt>Winner</dt>
        <dd>{game?.winnerTeam ?? "none"}</dd>
      </div>
    </dl>
  );
}

function PlayerList({ players }: { readonly players: readonly PublicPlayer[] }) {
  return (
    <div className="livePlayerList" aria-label="Players">
      {players.map((player) => (
        <div
          className={player.isCurrent ? "livePlayerRow current" : "livePlayerRow"}
          key={player.id}
        >
          <span className="liveAvatar" aria-hidden="true">
            {player.displayName.slice(0, 1)}
          </span>
          <span>
            <strong>{player.displayName}</strong>
            <small>{formatPlayerStatus(player)}</small>
          </span>
          <em>{player.isHost ? "Host" : "Player"}</em>
        </div>
      ))}
    </div>
  );
}

function StartRuleSetPanel({
  playerCount,
  settings,
  onNumberChange,
  onSettingsChange,
}: {
  readonly playerCount: number;
  readonly settings: StartRuleSetSettings;
  readonly onNumberChange: (key: RuleSetNumberField, value: number) => void;
  readonly onSettingsChange: <Key extends keyof StartRuleSetSettings>(
    key: Key,
    value: StartRuleSetSettings[Key],
  ) => void;
}) {
  const canPreviewRoleMix = playerCount >= 3 && playerCount <= 10;
  const previewRuleSet = canPreviewRoleMix ? makeDefaultRuleSetForPlayers(playerCount) : null;
  const activeRoleIds =
    previewRuleSet === null
      ? []
      : ROLE_IDS.filter((roleId) => previewRuleSet.roleCounts[roleId] > 0);

  return (
    <div className="liveRuleSetPanel" aria-label="Start settings">
      <div className="liveRuleSetHeader">
        <span>Start settings</span>
        <strong>{playerCount} players</strong>
      </div>

      <div className="liveRuleSetGrid">
        <label className="liveRuleSetField">
          <span>Day mode</span>
          <select
            value={settings.dayMode}
            onChange={(event) =>
              onSettingsChange("dayMode", event.target.value as StartRuleSetSettings["dayMode"])
            }
          >
            <option value="ready_check">Ready check</option>
            <option value="ordered_speech">Ordered speech</option>
          </select>
        </label>

        <label className="liveRuleSetField">
          <span>Guard policy</span>
          <select
            value={settings.guardConsecutiveTargetPolicy}
            onChange={(event) =>
              onSettingsChange(
                "guardConsecutiveTargetPolicy",
                event.target.value as StartRuleSetSettings["guardConsecutiveTargetPolicy"],
              )
            }
          >
            <option value="deny">Deny same target</option>
            <option value="allow">Allow repeat</option>
          </select>
        </label>

        <label className="liveRuleSetField">
          <span>Initial inspection</span>
          <select
            value={settings.initialInspectionPolicy}
            onChange={(event) =>
              onSettingsChange(
                "initialInspectionPolicy",
                event.target.value as StartRuleSetSettings["initialInspectionPolicy"],
              )
            }
          >
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>

        <label className="liveRuleSetField">
          <span>Vote detail</span>
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
      </div>

      <div className="liveTimingGrid" aria-label="Phase timing">
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
          field="dayReadyCheckSecondsPerPlayer"
          label="Ready / player"
          value={settings.dayReadyCheckSecondsPerPlayer}
          onChange={onNumberChange}
        />
        <RuleSetNumberControl
          field="daySpeechSeconds"
          label="Speech"
          value={settings.daySpeechSeconds}
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
        <RuleSetNumberControl
          field="firstDaySpeechRounds"
          label="First rounds"
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

      <div className="liveRolePreview" aria-label="Automatic role mix">
        {previewRuleSet === null ? (
          <span className="liveRolePill muted">
            <strong>Role mix appears at 3 players</strong>
          </span>
        ) : (
          activeRoleIds.map((roleId) => (
            <span className="liveRolePill" key={roleId}>
              <strong>{ROLE_DEFINITIONS[roleId].name}</strong>
              <em>{previewRuleSet.roleCounts[roleId]}</em>
            </span>
          ))
        )}
      </div>
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

function SelfView({
  isNightConversationOpen,
  isBusy,
  nightConversationDraft,
  summary,
  onNightConversationDraftChange,
  onSendNightConversation,
  onToggleNightConversation,
}: {
  readonly isNightConversationOpen: boolean;
  readonly isBusy: boolean;
  readonly nightConversationDraft: string;
  readonly summary: RoomSummary | null;
  readonly onNightConversationDraftChange: (value: string) => void;
  readonly onSendNightConversation: (conversation: NightConversationView) => void;
  readonly onToggleNightConversation: () => void;
}) {
  if (summary?.self === null || summary?.self === undefined) {
    return (
      <div className="liveSelfView">
        <span>Private view</span>
        <strong>Join a room to load your role and private actions.</strong>
      </div>
    );
  }

  const currentPlayer = summary.players.find((player) => player.id === summary.self?.playerId);
  const nightConversation = summary.rolePrivate?.nightConversation ?? null;
  const participantNames =
    nightConversation === null
      ? []
      : nightConversation.participantPlayerIds
          .map((playerId) => summary.players.find((player) => player.id === playerId)?.displayName)
          .filter((displayName): displayName is string => displayName !== undefined);
  const hasNightConversation = nightConversation !== null;

  return (
    <div className="liveSelfView">
      <span>{currentPlayer?.displayName ?? "You"}</span>
      <strong>{summary.self.roleName ?? "Role hidden until start"}</strong>
      {hasNightConversation ? (
        <>
          <p>{participantNames.join(", ") || "No night chat participants"}</p>
          <button className="secondaryButton" type="button" onClick={onToggleNightConversation}>
            {isNightConversationOpen ? "Hide night chat" : "Show night chat"}
          </button>
        </>
      ) : null}
      {nightConversation === null || !isNightConversationOpen ? null : (
        <NightConversationPanel
          conversation={nightConversation}
          draft={nightConversationDraft}
          isBusy={isBusy}
          onDraftChange={onNightConversationDraftChange}
          onSend={onSendNightConversation}
        />
      )}
      {summary.self.result === null ? null : <p>{formatResult(summary.self.result)}</p>}
      <PrivateEventList events={summary.self.events} />
      <SubmittedActionList actions={summary.self.submittedActions} />
    </div>
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

function PrivateEventList({ events }: { readonly events: readonly PrivateGameEvent[] }) {
  if (events.length === 0) {
    return null;
  }

  return (
    <div className="livePrivateEvents">
      {events.map((event) => (
        <p key={`${event.kind}:${event.createdAt}`}>
          <strong>{formatEventKind(event.kind)}:</strong> {event.message}
        </p>
      ))}
    </div>
  );
}

function SubmittedActionList({
  actions,
}: {
  readonly actions: readonly { readonly label: string; readonly submittedAt: string }[];
}) {
  if (actions.length === 0) {
    return null;
  }

  return (
    <div className="liveSubmittedActions">
      {actions.map((action) => (
        <p key={`${action.label}:${action.submittedAt}`}>
          <strong>{action.label}:</strong> submitted at {formatDateTime(action.submittedAt)}
        </p>
      ))}
    </div>
  );
}

function ActionList({
  actions,
  isBusy,
  players,
  targetByActionKey,
  onTargetChange,
  onSubmitAction,
}: {
  readonly actions: readonly PublicAction[];
  readonly isBusy: boolean;
  readonly players: readonly PublicPlayer[];
  readonly targetByActionKey: Record<string, string>;
  readonly onTargetChange: (actionKey: string, playerId: string) => void;
  readonly onSubmitAction: (action: PublicAction) => void;
}) {
  if (actions.length === 0) {
    return (
      <div className="liveEmptyState compact">
        <strong>No private actions</strong>
        <p>Refresh after a phase change or wait for your action window.</p>
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

function requireRoomCode(roomCode: string): string {
  if (!/^\d{6}$/.test(roomCode)) {
    throw new Error("Enter a six-digit room code.");
  }

  return roomCode;
}

function buildStartRuleSetInput(settings: StartRuleSetSettings): RuleSetInput {
  return {
    ...settings,
    roleCounts: {},
  };
}

function clampRuleSetNumber(field: RuleSetNumberField, value: number): number {
  const limits = RULE_SET_NUMBER_LIMITS[field];
  const integerValue = Math.trunc(value);

  return Math.min(limits.max, Math.max(limits.min, integerValue));
}

function getLiveGuidance(
  summary: RoomSummary | null,
  actionCount: number,
  isBusy: boolean,
): { label: string; message: string } {
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
    if (!summary.isHost) {
      return { label: "Lobby", message: "Waiting for the host to start the game." };
    }

    if (countJoinedPlayers(summary) < 3) {
      return { label: "Invite", message: "Invite at least three players before starting." };
    }

    if (countJoinedPlayers(summary) > 10) {
      return { label: "Full", message: "Keep this table to ten active players or fewer." };
    }

    return { label: "Ready", message: "Start the game when everyone is at the table." };
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

  if (countJoinedPlayers(summary) < 3) {
    return "Invite at least three active players before starting.";
  }

  if (countJoinedPlayers(summary) > 10) {
    return "Start supports three to ten active players.";
  }

  return "Start the game when every player is seated.";
}

function canStartRoom(summary: RoomSummary | null): boolean {
  if (summary === null || !summary.isHost || summary.status !== "lobby") {
    return false;
  }

  const joinedPlayerCount = countJoinedPlayers(summary);

  return joinedPlayerCount >= 3 && joinedPlayerCount <= 10;
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

function getLeaveHint(summary: RoomSummary | null, isBusy: boolean): string {
  if (summary === null) {
    return "Join or create a room before leaving.";
  }

  if (isBusy) {
    return "Wait for the current sync to finish.";
  }

  return "Leave this room.";
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

function formatPhaseWindow(phaseInstanceId: string | null): string {
  return phaseInstanceId === null ? "closed" : "open";
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

function formatPlayerStatus(player: PublicPlayer): string {
  const aliveLabel = player.alive === null || player.alive ? "Alive" : "Out";
  const currentLabel = player.isCurrent ? "you" : player.status;

  return `${aliveLabel} / ${currentLabel}`;
}

function formatResult(result: "lose" | "win"): string {
  return result === "win" ? "You won this game." : "You lost this game.";
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
