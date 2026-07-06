"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { PublicAction, PublicPlayer, RoomSummary } from "@/lib/shared/game";

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

const IDENTITY_STORAGE_KEY = "jinrohWeb.identityToken";
const DISPLAY_NAME_STORAGE_KEY = "jinrohWeb.displayName";
const ROOM_CODE_STORAGE_KEY = "jinrohWeb.roomCode";

export default function LivePage() {
  const [identityToken, setIdentityToken] = useState(() => readStorage(IDENTITY_STORAGE_KEY));
  const [displayName, setDisplayName] = useState(
    () => readStorage(DISPLAY_NAME_STORAGE_KEY) ?? "Sora",
  );
  const [roomCodeInput, setRoomCodeInput] = useState(
    () => readStorage(ROOM_CODE_STORAGE_KEY) ?? "",
  );
  const [roomSummary, setRoomSummary] = useState<RoomSummary | null>(null);
  const [targetByActionKey, setTargetByActionKey] = useState<Record<string, string>>({});
  const [statusMessage, setStatusMessage] = useState("Ready for a live Supabase-backed room.");
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
      setStatusMessage(error instanceof Error ? error.message : "The request failed.");
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
    setStatusMessage("Anonymous identity created in this browser profile.");

    return identity.token;
  }

  function rememberRoom(nextSummary: RoomSummary): void {
    writeStorage(DISPLAY_NAME_STORAGE_KEY, displayName);
    writeStorage(ROOM_CODE_STORAGE_KEY, nextSummary.code);
    setRoomCodeInput(nextSummary.code);
    setRoomSummary(nextSummary);
    setTargetByActionKey({});
  }

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
      const token = await ensureIdentityToken();
      const roomCode = requireRoomCode(roomCodeInput);
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
      setStatusMessage(`Room ${summary.code} refreshed from the API.`);
    });
  }

  function handleStartGame(): void {
    void withBusy(async () => {
      const token = await ensureIdentityToken();
      const roomCode = requireRoomCode(roomSummary?.code ?? roomCodeInput);
      const summary = await apiFetch<RoomSummary>(`/api/rooms/${roomCode}/start`, {
        body: {},
        method: "POST",
        token,
      });

      rememberRoom(summary);
      setStatusMessage("Game started. Players can now submit their private actions.");
    });
  }

  function handleResolvePhase(): void {
    void withBusy(async () => {
      const token = await ensureIdentityToken();
      const roomCode = requireRoomCode(roomSummary?.code ?? roomCodeInput);
      const summary = await apiFetch<RoomSummary>(`/api/rooms/${roomCode}/resolve`, {
        method: "POST",
        token,
      });

      rememberRoom(summary);
      setStatusMessage("Phase resolution requested.");
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

      rememberRoom(summary);
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
      setStatusMessage(`${action.label} submitted.`);
    });
  }

  function getActionTarget(action: PublicAction): string {
    return targetByActionKey[action.key] ?? action.eligibleTargetIds[0] ?? "";
  }

  const selfActions = roomSummary?.self?.actions ?? [];
  const roomStatusLabel = formatRoomStatus(roomSummary);

  return (
    <main className="liveShell">
      <section className="liveHero">
        <Link className="liveBackLink" href="/">
          Back to product surface
        </Link>
        <div>
          <p className="liveKicker">Live game console</p>
          <h1>Play a real room through the API.</h1>
          <p>
            Use this screen to verify anonymous identity, six-digit room entry, host start, private
            actions, phase resolution, and rejoin behavior against Supabase.
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
        <span>{isBusy ? "Working..." : "Idle"}</span>
        <strong>{statusMessage}</strong>
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

          <div className="liveControlStack">
            <button
              type="button"
              onClick={handleStartGame}
              disabled={isBusy || roomSummary === null}
            >
              Start game
            </button>
            <button
              className="secondaryButton"
              type="button"
              onClick={handleResolvePhase}
              disabled={isBusy || roomSummary === null}
            >
              Resolve phase
            </button>
            <button
              className="dangerButton"
              type="button"
              onClick={handleLeaveRoom}
              disabled={isBusy || roomSummary === null}
            >
              Leave room
            </button>
          </div>

          <SelfView summary={roomSummary} />
          <ActionList
            actions={selfActions}
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
      <p>Create a room, or paste a six-digit code and join from a separate browser profile.</p>
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

function SelfView({ summary }: { readonly summary: RoomSummary | null }) {
  if (summary?.self === null || summary?.self === undefined) {
    return (
      <div className="liveSelfView">
        <span>Private view</span>
        <strong>Join a room to load your role and private actions.</strong>
      </div>
    );
  }

  return (
    <div className="liveSelfView">
      <span>Private view</span>
      <strong>{summary.self.roleName ?? "Role hidden until start"}</strong>
      <p>Player ID: {summary.self.playerId}</p>
      {summary.rolePrivate === null ? null : (
        <p>Werewolf partners: {summary.rolePrivate.werewolfPartnerIds.join(", ") || "none"}</p>
      )}
      {summary.self.result === null ? null : <p>Result: {summary.self.result}</p>}
    </div>
  );
}

function ActionList({
  actions,
  players,
  targetByActionKey,
  onTargetChange,
  onSubmitAction,
}: {
  readonly actions: readonly PublicAction[];
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
          <div className="liveActionRow" key={action.key}>
            <div>
              <strong>{action.label}</strong>
              <span>{formatDateTime(action.closesAt)}</span>
            </div>

            {action.targetKind === "single_player" ? (
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
            ) : null}

            <button type="button" onClick={() => onSubmitAction(action)}>
              Submit
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
          <time>{formatDateTime(event.createdAt)}</time>
          <strong>{event.kind.replaceAll("_", " ")}</strong>
          <p>{event.message}</p>
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

function formatRoomStatus(summary: RoomSummary | null): string {
  if (summary === null) {
    return "No room";
  }

  if (summary.game?.status === "ended") {
    return "Ended";
  }

  return `${summary.status} / ${summary.game?.phase ?? "setup"}`;
}

function formatPhaseWindow(phaseInstanceId: string | null): string {
  return phaseInstanceId === null ? "closed" : "open";
}

function formatPlayerStatus(player: PublicPlayer): string {
  const aliveLabel = player.alive === null || player.alive ? "alive" : "out";
  const currentLabel = player.isCurrent ? "you" : player.status;

  return `${aliveLabel}, ${currentLabel}`;
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
