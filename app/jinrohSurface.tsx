"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { CSSProperties, ReactNode } from "react";

type LocalView =
  | "home"
  | "lobby"
  | "board"
  | "night"
  | "day"
  | "voting"
  | "execution"
  | "result"
  | "demo";

type IconName =
  | "board"
  | "check"
  | "copy"
  | "day"
  | "eye"
  | "flag"
  | "home"
  | "moon"
  | "people"
  | "result"
  | "shield"
  | "skull"
  | "vote"
  | "wolf";

type RoleId = "fox" | "guard" | "madman" | "seer" | "villager" | "werewolf";

type GamePhase = "day" | "execution" | "night" | "voting";

type RoleDefinition = {
  readonly name: string;
};

type NavItem = {
  readonly view: LocalView;
  readonly label: string;
  readonly detail: string;
  readonly icon: IconName;
};

type Player = {
  readonly id: string;
  readonly displayName: string;
  readonly roleId: RoleId;
  readonly seatNumber: number;
  readonly status: "ready" | "speaking" | "voted" | "pending" | "executed" | "observing";
  readonly isHost: boolean;
  readonly isCurrent: boolean;
  readonly alive: boolean;
  readonly position: {
    readonly x: number;
    readonly y: number;
  };
};

type Scenario = {
  readonly title: string;
  readonly summary: string;
  readonly phase: GamePhase | null;
  readonly dayNumber: number;
  readonly nightNumber: number;
  readonly primaryAction: string;
  readonly secondaryAction: string;
  readonly boardTone: "home" | "lobby" | "night" | "day" | "voting" | "execution" | "result";
  readonly notice: string;
};

type ActivityItem = {
  readonly id: string;
  readonly time: string;
  readonly icon: IconName;
  readonly text: string;
  readonly visibility: "public" | "private" | "host";
};

const roleDefinitions: Record<RoleId, RoleDefinition> = {
  fox: { name: "Fox" },
  guard: { name: "Guard" },
  madman: { name: "Madman" },
  seer: { name: "Seer" },
  villager: { name: "Villager" },
  werewolf: { name: "Werewolf" },
};

const defaultRoleCounts: Record<RoleId, number> = {
  fox: 1,
  guard: 1,
  madman: 1,
  seer: 1,
  villager: 3,
  werewolf: 2,
};

const navItems: readonly NavItem[] = [
  { detail: "Create or rejoin", icon: "home", label: "Home", view: "home" },
  { detail: "Room setup", icon: "people", label: "Lobby", view: "lobby" },
  { detail: "Live table", icon: "board", label: "Game board", view: "board" },
  { detail: "Role actions", icon: "moon", label: "Night", view: "night" },
  { detail: "Discussion", icon: "day", label: "Day", view: "day" },
  { detail: "Ballots", icon: "vote", label: "Voting", view: "voting" },
  { detail: "Reveal", icon: "flag", label: "Execution", view: "execution" },
  { detail: "Outcome", icon: "result", label: "Result", view: "result" },
  { detail: "Scripted flow", icon: "skull", label: "Demo", view: "demo" },
];

const phaseTrack: readonly { readonly label: string; readonly view: LocalView }[] = [
  { label: "Lobby", view: "lobby" },
  { label: "Night", view: "night" },
  { label: "Day", view: "day" },
  { label: "Voting", view: "voting" },
  { label: "Execution", view: "execution" },
  { label: "Result", view: "result" },
];

function primaryIconForPhase(phase: GamePhase | null): IconName {
  if (phase === "voting") {
    return "vote";
  }

  if (phase === "night") {
    return "moon";
  }

  return "check";
}

function timelineItemClassName(isActive: boolean, isComplete: boolean): string {
  if (isActive) {
    return "active";
  }

  if (isComplete) {
    return "complete";
  }

  return "";
}

function tableCenterIconName(activeView: LocalView, phase: GamePhase | null): IconName {
  if (phase === "night") {
    return "moon";
  }

  if (phase === "day") {
    return "day";
  }

  if (phase === "voting") {
    return "vote";
  }

  if (phase === "execution") {
    return "flag";
  }

  if (activeView === "result") {
    return "result";
  }

  return "board";
}

const scenarios: Record<LocalView, Scenario> = {
  board: {
    boardTone: "day",
    dayNumber: 2,
    nightNumber: 2,
    notice: "The table shows live public state. Players keep talking in person or on voice.",
    phase: "day",
    primaryAction: "Ready for vote",
    secondaryAction: "Open host panel",
    summary:
      "A full-table view keeps seats, status, and phase context visible without replacing discussion.",
    title: "Game board",
  },
  day: {
    boardTone: "day",
    dayNumber: 2,
    nightNumber: 2,
    notice: "Day discussion is active. The app tracks readiness and the next transition only.",
    phase: "day",
    primaryAction: "Ready for voting",
    secondaryAction: "End speech turn",
    summary: "Discussion remains human-led while the app tracks ready checks and phase timing.",
    title: "Day",
  },
  demo: {
    boardTone: "night",
    dayNumber: 2,
    nightNumber: 3,
    notice: "Demo table cycles through the product surface with local state only.",
    phase: "night",
    primaryAction: "Advance demo",
    secondaryAction: "Reset demo",
    summary: "A guided mode shows hosts and players how the table behaves from lobby to result.",
    title: "Demo table",
  },
  execution: {
    boardTone: "execution",
    dayNumber: 2,
    nightNumber: 2,
    notice: "Execution is a reveal moment. The host confirms the result before the next night.",
    phase: "execution",
    primaryAction: "Reveal result",
    secondaryAction: "Skip execution",
    summary: "The execution surface separates the candidate, vote count, and next state.",
    title: "Execution",
  },
  home: {
    boardTone: "home",
    dayNumber: 0,
    nightNumber: 0,
    notice: "Anonymous browser identity keeps players returning as the same room participant.",
    phase: null,
    primaryAction: "Create room",
    secondaryAction: "Join with code",
    summary: "Create a room, join with a six-digit code, and keep the shared game state tidy.",
    title: "Run the table",
  },
  lobby: {
    boardTone: "lobby",
    dayNumber: 0,
    nightNumber: 0,
    notice: "Lobby rooms expire if the game never starts. Host controls stay server-authorized.",
    phase: null,
    primaryAction: "Start game",
    secondaryAction: "Copy room code",
    summary: "Hosts can confirm players, tune the rule set, and start when everyone is present.",
    title: "Lobby",
  },
  night: {
    boardTone: "night",
    dayNumber: 1,
    nightNumber: 2,
    notice:
      "Night actions are private. Realtime messages only invalidate state and trigger reloads.",
    phase: "night",
    primaryAction: "End night",
    secondaryAction: "Skip to day",
    summary: "Role actions are collected without exposing secret information to the room.",
    title: "Night",
  },
  result: {
    boardTone: "result",
    dayNumber: 3,
    nightNumber: 3,
    notice: "Final outcome is derived from ended game state. No hidden account IDs are exposed.",
    phase: null,
    primaryAction: "New room",
    secondaryAction: "Review log",
    summary:
      "Villagers win. The result screen keeps public outcome and private player result separate.",
    title: "Result",
  },
  voting: {
    boardTone: "voting",
    dayNumber: 2,
    nightNumber: 2,
    notice: "Votes use first-submit-wins semantics for the current action window.",
    phase: "voting",
    primaryAction: "Vote",
    secondaryAction: "Lock ballots",
    summary:
      "Every living player gets one visible voting task while the host sees completion state.",
    title: "Voting",
  },
};

const samplePlayers: readonly Player[] = [
  {
    alive: true,
    displayName: "Sora",
    id: "sora",
    isCurrent: true,
    isHost: true,
    position: { x: 50, y: 7 },
    roleId: "seer",
    seatNumber: 1,
    status: "ready",
  },
  {
    alive: true,
    displayName: "Mina",
    id: "mina",
    isCurrent: false,
    isHost: false,
    position: { x: 82, y: 18 },
    roleId: "villager",
    seatNumber: 2,
    status: "ready",
  },
  {
    alive: true,
    displayName: "Kenji",
    id: "kenji",
    isCurrent: false,
    isHost: false,
    position: { x: 91, y: 50 },
    roleId: "werewolf",
    seatNumber: 3,
    status: "pending",
  },
  {
    alive: true,
    displayName: "Aiko",
    id: "aiko",
    isCurrent: false,
    isHost: false,
    position: { x: 78, y: 78 },
    roleId: "guard",
    seatNumber: 4,
    status: "voted",
  },
  {
    alive: true,
    displayName: "Riku",
    id: "riku",
    isCurrent: false,
    isHost: false,
    position: { x: 50, y: 92 },
    roleId: "madman",
    seatNumber: 5,
    status: "speaking",
  },
  {
    alive: true,
    displayName: "Taro",
    id: "taro",
    isCurrent: false,
    isHost: false,
    position: { x: 22, y: 78 },
    roleId: "villager",
    seatNumber: 6,
    status: "ready",
  },
  {
    alive: true,
    displayName: "Yuki",
    id: "yuki",
    isCurrent: false,
    isHost: false,
    position: { x: 9, y: 50 },
    roleId: "fox",
    seatNumber: 7,
    status: "observing",
  },
  {
    alive: false,
    displayName: "Hiro",
    id: "hiro",
    isCurrent: false,
    isHost: false,
    position: { x: 18, y: 18 },
    roleId: "villager",
    seatNumber: 8,
    status: "executed",
  },
];

const fallbackPlayer: Player = {
  alive: true,
  displayName: "Sora",
  id: "sora",
  isCurrent: true,
  isHost: true,
  position: { x: 50, y: 7 },
  roleId: "seer",
  seatNumber: 1,
  status: "ready",
};

const initialActivityItems: readonly ActivityItem[] = [
  {
    icon: "people",
    id: "activity-room",
    text: "Room 428913 opened with eight joined players.",
    time: "20:18",
    visibility: "public",
  },
  {
    icon: "moon",
    id: "activity-night",
    text: "Night started. Role actions are waiting for eligible players.",
    time: "20:21",
    visibility: "private",
  },
  {
    icon: "eye",
    id: "activity-seer",
    text: "Seer action submitted. Public room state remains unchanged.",
    time: "20:22",
    visibility: "private",
  },
  {
    icon: "vote",
    id: "activity-vote",
    text: "Voting phase prepared with one action per living player.",
    time: "20:28",
    visibility: "host",
  },
];

const roleSummary: readonly {
  readonly roleId: RoleId;
  readonly count: number;
  readonly icon: IconName;
}[] = [
  { count: defaultRoleCounts.werewolf, icon: "wolf", roleId: "werewolf" },
  { count: defaultRoleCounts.seer, icon: "eye", roleId: "seer" },
  { count: defaultRoleCounts.guard, icon: "shield", roleId: "guard" },
  { count: defaultRoleCounts.madman, icon: "skull", roleId: "madman" },
  { count: defaultRoleCounts.villager, icon: "people", roleId: "villager" },
  { count: defaultRoleCounts.fox, icon: "flag", roleId: "fox" },
];

const actionRows: readonly {
  readonly icon: IconName;
  readonly label: string;
  readonly status: "Done" | "Open" | "Pending" | "Locked";
}[] = [
  { icon: "wolf", label: "Werewolves", status: "Pending" },
  { icon: "eye", label: "Seer", status: "Done" },
  { icon: "shield", label: "Guard", status: "Open" },
  { icon: "vote", label: "Living players", status: "Locked" },
];

const demoSteps: readonly {
  readonly label: string;
  readonly view: LocalView;
  readonly text: string;
}[] = [
  {
    label: "Home",
    text: "Anonymous identity and display-name preference are prepared.",
    view: "home",
  },
  {
    label: "Lobby",
    text: "Room code, player list, host state, and rule set are visible.",
    view: "lobby",
  },
  {
    label: "Night",
    text: "Secret action progress is shown only as allowed public state.",
    view: "night",
  },
  {
    label: "Day",
    text: "Discussion stays outside the app while readiness is tracked.",
    view: "day",
  },
  { label: "Voting", text: "Each living player receives one vote action.", view: "voting" },
  {
    label: "Result",
    text: "The ended game surfaces public outcome and private result.",
    view: "result",
  },
];

export function JinrohSurface() {
  const [activeView, setActiveView] = useState<LocalView>("home");
  const [selectedPlayerId, setSelectedPlayerId] = useState("sora");
  const [roomCode, setRoomCode] = useState("428913");
  const [activityItems, setActivityItems] = useState(initialActivityItems);
  const [copyStatus, setCopyStatus] = useState("Copy");

  const scenario = scenarios[activeView];
  const selectedPlayer =
    samplePlayers.find((player) => player.id === selectedPlayerId) ?? fallbackPlayer;
  const joinedPlayers = samplePlayers.filter((player) => player.alive).length;
  const viewIndex = navItems.findIndex((item) => item.view === activeView);

  const visiblePlayers = useMemo(() => {
    if (activeView === "result") {
      return samplePlayers.map((player) =>
        player.id === "kenji" ? { ...player, alive: false, status: "executed" as const } : player,
      );
    }

    return samplePlayers;
  }, [activeView]);

  function handlePrimaryAction() {
    const nextActivityItem: ActivityItem = {
      icon: primaryIconForPhase(scenario.phase),
      id: `activity-${Date.now()}`,
      text: `${scenario.primaryAction} confirmed in the local demo surface.`,
      time: "now",
      visibility: activeView === "night" ? "private" : "public",
    };

    setActivityItems((currentItems) => [nextActivityItem, ...currentItems].slice(0, 6));

    if (activeView === "home") {
      setActiveView("lobby");
    }
  }

  function handleSecondaryAction() {
    if (activeView === "home" || activeView === "lobby") {
      setActiveView("lobby");
      return;
    }

    const currentTrackIndex = phaseTrack.findIndex((item) => item.view === activeView);
    const nextView = phaseTrack[currentTrackIndex + 1]?.view ?? "lobby";

    setActiveView(nextView);
  }

  function handleDemoStep(view: LocalView) {
    setActiveView(view);
  }

  async function handleCopyRoomCode() {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopyStatus("Copied");
      window.setTimeout(() => setCopyStatus("Copy"), 1800);
    } catch {
      setCopyStatus("Copy failed");
    }
  }

  return (
    <main className={`appShell tone-${scenario.boardTone}`}>
      <section className="heroBackdrop" aria-hidden="true" />
      <div className="surfaceFrame">
        <header className="topBar">
          <a className="brandMark" href="#app-surface" aria-label="Jinroh Web home">
            <span className="brandEmblem">
              <Icon name="wolf" />
            </span>
            <span>
              <strong>Jinroh Web</strong>
              <small>Shared state for live werewolf</small>
            </span>
          </a>

          <div className="roomTools" aria-label="Room tools">
            <span className="roomCode">Room {roomCode}</span>
            <button
              className="iconButton"
              type="button"
              aria-label="Copy room code"
              onClick={handleCopyRoomCode}
            >
              <Icon name="copy" />
            </button>
            <span className="copyStatus" aria-live="polite">
              {copyStatus}
            </span>
            <Link className="secondaryButton compactButton" href="/live">
              Live table
            </Link>
            <button
              className="primaryButton compactButton"
              type="button"
              onClick={() => setActiveView("lobby")}
            >
              Create room
            </button>
          </div>
        </header>

        <div id="app-surface" className="productShell">
          <aside className="stateRail" aria-label="Product states">
            <nav className="stateNav">
              {navItems.map((item) => (
                <button
                  className={item.view === activeView ? "stateButton active" : "stateButton"}
                  data-view={item.view}
                  key={item.view}
                  type="button"
                  onClick={() => setActiveView(item.view)}
                >
                  <Icon name={item.icon} />
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                  </span>
                </button>
              ))}
            </nav>

            <div className="railFooter">
              <span>
                State {viewIndex + 1} of {navItems.length}
              </span>
              <strong>{scenario.title}</strong>
            </div>
          </aside>

          <section className="mainStage" aria-label={`${scenario.title} surface`}>
            <div className="stageHeader">
              <div>
                <h1>{scenario.title}</h1>
                <p>{scenario.summary}</p>
              </div>
              <div className="phaseMeta" aria-label="Current phase">
                <span>{scenario.phase === null ? "Setup" : scenario.phase}</span>
                <strong>
                  Day {scenario.dayNumber} / Night {scenario.nightNumber}
                </strong>
              </div>
            </div>

            <PhaseTimeline activeView={activeView} />

            {activeView === "home" ? (
              <HomeSurface
                roomCode={roomCode}
                setRoomCode={setRoomCode}
                onCreateRoom={handlePrimaryAction}
                onJoinRoom={() => setActiveView("lobby")}
              />
            ) : (
              <GameBoard
                activeView={activeView}
                players={visiblePlayers}
                scenario={scenario}
                selectedPlayerId={selectedPlayer.id}
                onSelectPlayer={setSelectedPlayerId}
              />
            )}

            <ActivityStrip activityItems={activityItems} />
          </section>

          <aside className="commandPanel" aria-label="Host and player controls">
            <section className="panelSection">
              <div className="sectionHeading">
                <span>Host controls</span>
                <strong>{activeView === "result" ? "Ended" : "Live"}</strong>
              </div>
              <button className="primaryButton" type="button" onClick={handlePrimaryAction}>
                <Icon name={primaryIconForPhase(scenario.phase)} />
                {scenario.primaryAction}
              </button>
              <button className="secondaryButton" type="button" onClick={handleSecondaryAction}>
                <Icon name="flag" />
                {scenario.secondaryAction}
              </button>
            </section>

            <section className="panelSection">
              <div className="sectionHeading">
                <span>Selected player</span>
                <strong>{selectedPlayer.alive ? "Alive" : "Out"}</strong>
              </div>
              <div className="selectedPlayer">
                <span className="avatar largeAvatar" aria-hidden="true">
                  {selectedPlayer.displayName.slice(0, 1)}
                </span>
                <div>
                  <strong>{selectedPlayer.displayName}</strong>
                  <span>
                    Seat {selectedPlayer.seatNumber} / {roleDefinitions[selectedPlayer.roleId].name}
                  </span>
                </div>
              </div>
            </section>

            <section className="panelSection">
              <div className="sectionHeading">
                <span>Action status</span>
                <strong>{joinedPlayers} alive</strong>
              </div>
              <div className="actionList">
                {actionRows.map((row) => (
                  <div className="actionRow" key={row.label}>
                    <Icon name={row.icon} />
                    <span>{row.label}</span>
                    <strong data-status={row.status}>{row.status}</strong>
                  </div>
                ))}
              </div>
            </section>

            <section className="panelSection">
              <div className="sectionHeading">
                <span>Demo states</span>
                <strong>Local</strong>
              </div>
              <div className="demoList">
                {demoSteps.map((step) => (
                  <button
                    className={step.view === activeView ? "demoStep active" : "demoStep"}
                    key={step.view}
                    type="button"
                    onClick={() => handleDemoStep(step.view)}
                  >
                    <strong>{step.label}</strong>
                    <span>{step.text}</span>
                  </button>
                ))}
              </div>
            </section>
          </aside>
        </div>

        <footer className="roleLegend" aria-label="Rule set role counts">
          {roleSummary.map((role) => (
            <div className="roleLegendItem" key={role.roleId}>
              <Icon name={role.icon} />
              <span>{roleDefinitions[role.roleId].name}</span>
              <strong>{role.count}</strong>
            </div>
          ))}
        </footer>
      </div>

      <nav className="mobileTabs" aria-label="Mobile state tabs">
        {navItems.slice(0, 8).map((item) => (
          <button
            className={item.view === activeView ? "mobileTab active" : "mobileTab"}
            data-view={item.view}
            key={item.view}
            type="button"
            onClick={() => setActiveView(item.view)}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </main>
  );
}

function HomeSurface({
  roomCode,
  setRoomCode,
  onCreateRoom,
  onJoinRoom,
}: {
  readonly roomCode: string;
  readonly setRoomCode: (roomCode: string) => void;
  readonly onCreateRoom: () => void;
  readonly onJoinRoom: () => void;
}) {
  return (
    <div className="homeSurface">
      <div className="homeCopy">
        <h2>Start from a real table</h2>
        <p>
          The app keeps room membership, host state, phase progress, actions, and results organized
          while the conversation stays with the players.
        </p>
      </div>

      <div className="homeActions" aria-label="Room entry actions">
        <section className="homeChoice">
          <span className="choiceIcon">
            <Icon name="home" />
          </span>
          <h3>Create room</h3>
          <p>Open a lobby, become host, and invite players with a six-digit code.</p>
          <button className="primaryButton" type="button" onClick={onCreateRoom}>
            Create room
          </button>
          <Link className="secondaryButton" href="/live">
            Open live table
          </Link>
        </section>

        <section className="homeChoice">
          <span className="choiceIcon">
            <Icon name="copy" />
          </span>
          <h3>Join with code</h3>
          <label htmlFor="room-code">Room code</label>
          <div className="joinControl">
            <input
              id="room-code"
              inputMode="numeric"
              maxLength={6}
              value={roomCode}
              onChange={(event) => setRoomCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            />
            <button className="secondaryButton" type="button" onClick={onJoinRoom}>
              Join
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function PhaseTimeline({ activeView }: { readonly activeView: LocalView }) {
  const effectiveView = activeView === "board" ? "day" : activeView;
  const activeIndex = phaseTrack.findIndex((item) => item.view === effectiveView);

  return (
    <ol className="phaseTimeline" aria-label="Phase timeline">
      {phaseTrack.map((item, index) => {
        const isComplete = activeIndex > index;
        const isActive = item.view === effectiveView;

        return (
          <li className={timelineItemClassName(isActive, isComplete)} key={item.view}>
            <span>{isComplete ? <Icon name="check" /> : index + 1}</span>
            <strong>{item.label}</strong>
          </li>
        );
      })}
    </ol>
  );
}

function GameBoard({
  activeView,
  players,
  scenario,
  selectedPlayerId,
  onSelectPlayer,
}: {
  readonly activeView: LocalView;
  readonly players: readonly Player[];
  readonly scenario: Scenario;
  readonly selectedPlayerId: string;
  readonly onSelectPlayer: (playerId: string) => void;
}) {
  return (
    <div className="boardAndRoster">
      <section className="tableBoard" aria-label="Werewolf table board">
        <div className="tableSurface">
          <div className="tableCenter">
            <Icon name={tableCenterIconName(activeView, scenario.phase)} />
            <strong>{activeView === "result" ? "Villagers win" : scenario.title}</strong>
            <span>{scenario.notice}</span>
          </div>

          {players.map((player) => {
            const seatStyle = {
              "--seat-x": `${player.position.x}%`,
              "--seat-y": `${player.position.y}%`,
            } as CSSProperties;

            return (
              <button
                className={[
                  "seat",
                  selectedPlayerId === player.id ? "selected" : "",
                  player.alive ? "" : "eliminated",
                  player.status,
                ].join(" ")}
                data-player-id={player.id}
                key={player.id}
                style={seatStyle}
                type="button"
                onClick={() => onSelectPlayer(player.id)}
              >
                <span className="seatNumber">{player.seatNumber}</span>
                <span className="avatar" aria-hidden="true">
                  {player.displayName.slice(0, 1)}
                </span>
                <span className="seatLabel">
                  <strong>{player.displayName}</strong>
                  <small>{getPlayerStatusLabel(player)}</small>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="mobileRoster" aria-label="Player roster">
        {players.map((player) => (
          <button
            className={selectedPlayerId === player.id ? "rosterRow active" : "rosterRow"}
            data-player-id={player.id}
            key={player.id}
            type="button"
            onClick={() => onSelectPlayer(player.id)}
          >
            <span className="avatar" aria-hidden="true">
              {player.displayName.slice(0, 1)}
            </span>
            <span>
              <strong>{player.displayName}</strong>
              <small>{roleDefinitions[player.roleId].name}</small>
            </span>
            <em>{player.alive ? "Alive" : "Out"}</em>
          </button>
        ))}
      </section>
    </div>
  );
}

function ActivityStrip({ activityItems }: { readonly activityItems: readonly ActivityItem[] }) {
  return (
    <section className="activityStrip" aria-label="Activity">
      <div className="sectionHeading">
        <span>Activity</span>
        <strong>Realtime invalidation log</strong>
      </div>
      <div className="activityRows">
        {activityItems.map((activityItem) => (
          <div className="activityRow" key={activityItem.id}>
            <time>{activityItem.time}</time>
            <Icon name={activityItem.icon} />
            <span>{activityItem.text}</span>
            <strong>{activityItem.visibility}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function getPlayerStatusLabel(player: Player): string {
  if (!player.alive) {
    return "Out";
  }

  if (player.isHost) {
    return "Host";
  }

  if (player.isCurrent) {
    return "You";
  }

  switch (player.status) {
    case "executed":
      return "Out";
    case "observing":
      return "Watching";
    case "pending":
      return "Pending";
    case "ready":
      return "Ready";
    case "speaking":
      return "Speaking";
    case "voted":
      return "Voted";
  }
}

function Icon({ name }: { readonly name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    board: (
      <>
        <circle cx="12" cy="12" r="7.25" />
        <path d="M12 5v14M5 12h14" />
      </>
    ),
    check: <path d="m5 12 4.2 4.2L19 6.8" />,
    copy: (
      <>
        <rect x="8" y="8" width="10" height="12" rx="2" />
        <path d="M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
      </>
    ),
    day: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
      </>
    ),
    eye: (
      <>
        <path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" />
        <circle cx="12" cy="12" r="2.5" />
      </>
    ),
    flag: (
      <>
        <path d="M6 21V4" />
        <path d="M6 5h11l-2 4 2 4H6" />
      </>
    ),
    home: (
      <>
        <path d="m3 11 9-8 9 8" />
        <path d="M5 10v10h14V10" />
        <path d="M10 20v-6h4v6" />
      </>
    ),
    moon: <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5 8.5 8.5 0 1 0 20.5 14.5Z" />,
    people: (
      <>
        <path d="M16 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
        <circle cx="9.5" cy="7" r="3" />
        <path d="M22 20v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 4.13a3 3 0 0 1 0 5.74" />
      </>
    ),
    result: (
      <>
        <path d="M8 21h8" />
        <path d="M12 17v4" />
        <path d="M7 4h10v4a5 5 0 0 1-10 0V4Z" />
        <path d="M5 5H3v2a4 4 0 0 0 4 4M19 5h2v2a4 4 0 0 1-4 4" />
      </>
    ),
    shield: <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" />,
    skull: (
      <>
        <path d="M12 2a8 8 0 0 0-8 8c0 3 1.6 5.1 4 6.3V22h8v-5.7c2.4-1.2 4-3.3 4-6.3a8 8 0 0 0-8-8Z" />
        <path d="M9 11h.01M15 11h.01M10 16h4" />
      </>
    ),
    vote: (
      <>
        <path d="M4 14h16v7H4z" />
        <path d="M7 14V9l5-6 5 6v5" />
        <path d="M9 10h6" />
      </>
    ),
    wolf: (
      <>
        <path d="M4 19 7 5l4 4 4-4 5 14-5-3-3 4-3-4-5 3Z" />
        <path d="M9 12h.01M15 12h.01" />
      </>
    ),
  };

  return (
    <svg aria-hidden="true" className="icon" focusable="false" viewBox="0 0 24 24">
      {paths[name]}
    </svg>
  );
}
