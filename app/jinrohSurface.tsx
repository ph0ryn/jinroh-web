"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { useI18n } from "./i18nProvider";
import { LanguageSwitcher } from "./languageSwitcher";

import type { Localization } from "@/lib/i18n/localization";
import type { RoleCatalogItem, RoleId } from "@/lib/shared/game";
import type { CSSProperties, ReactNode } from "react";

type LocalView = "home" | "waiting" | "board" | "night" | "day" | "voting" | "execution" | "result";

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

type GamePhase = "day" | "execution" | "night" | "voting";

type NavItem = {
  readonly view: LocalView;
  readonly label: string;
  readonly mobileLabel: string;
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
  readonly boardTone: "home" | "waiting" | "night" | "day" | "voting" | "execution" | "result";
  readonly notice: string;
};

type ActivityItem = {
  readonly id: string;
  readonly dateTime: string;
  readonly time: string;
  readonly icon: IconName;
  readonly text: (t: Localization, roleNameById: ReadonlyMap<RoleId, string>) => string;
  readonly visibility: "public" | "private" | "host";
};

type CopyStatus = "copy" | "copied" | "copyFailed";

const phaseTrack: readonly LocalView[] = [
  "waiting",
  "night",
  "day",
  "voting",
  "execution",
  "result",
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
  waiting: {
    boardTone: "waiting",
    dayNumber: 0,
    nightNumber: 0,
    notice: "Rooms expire if the game never starts. Host controls stay server-authorized.",
    phase: null,
    primaryAction: "Start game",
    secondaryAction: "Copy room code",
    summary: "Hosts can confirm players, tune the rule set, and start when everyone is present.",
    title: "Waiting",
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
    dateTime: "2026-07-07T20:18:00+09:00",
    icon: "people",
    id: "activity-room",
    text: (t) => t.home.activity.roomOpened,
    time: "20:18",
    visibility: "public",
  },
  {
    dateTime: "2026-07-07T20:21:00+09:00",
    icon: "moon",
    id: "activity-night",
    text: (t) => t.home.activity.nightStarted,
    time: "20:21",
    visibility: "private",
  },
  {
    dateTime: "2026-07-07T20:22:00+09:00",
    icon: "eye",
    id: "activity-seer",
    text: (t, roleNameById) =>
      t.home.activity.roleActionSubmitted(getHomeRoleName("seer", roleNameById, t)),
    time: "20:22",
    visibility: "private",
  },
  {
    dateTime: "2026-07-07T20:28:00+09:00",
    icon: "vote",
    id: "activity-vote",
    text: (t) => t.home.activity.votingPrepared,
    time: "20:28",
    visibility: "host",
  },
];

// Explicit marketing composition; display metadata comes from the server role catalog.
const HOME_DEMO_ROLE_SUMMARY: readonly {
  readonly roleId: RoleId;
  readonly count: number;
  readonly icon: IconName;
}[] = [
  { count: 2, icon: "wolf", roleId: "werewolf" },
  { count: 1, icon: "eye", roleId: "seer" },
  { count: 1, icon: "shield", roleId: "guard" },
  { count: 1, icon: "skull", roleId: "madman" },
  { count: 3, icon: "people", roleId: "villager" },
  { count: 1, icon: "flag", roleId: "fox" },
];

const actionRows: readonly {
  readonly icon: IconName;
  readonly roleId: RoleId | null;
  readonly status: keyof Localization["home"]["actionRows"]["status"];
}[] = [
  { icon: "wolf", roleId: "werewolf", status: "pending" },
  { icon: "eye", roleId: "seer", status: "done" },
  { icon: "shield", roleId: "guard", status: "open" },
  { icon: "vote", roleId: null, status: "locked" },
];

function getLocalizedNavItems(t: Localization): readonly NavItem[] {
  return [
    {
      detail: t.home.nav.home.detail,
      icon: "home",
      label: t.home.nav.home.label,
      mobileLabel: t.home.nav.home.mobileLabel,
      view: "home",
    },
    {
      detail: t.home.nav.waiting.detail,
      icon: "people",
      label: t.home.nav.waiting.label,
      mobileLabel: t.home.nav.waiting.mobileLabel,
      view: "waiting",
    },
    {
      detail: t.home.nav.board.detail,
      icon: "board",
      label: t.home.nav.board.label,
      mobileLabel: t.home.nav.board.mobileLabel,
      view: "board",
    },
    {
      detail: t.home.nav.night.detail,
      icon: "moon",
      label: t.home.nav.night.label,
      mobileLabel: t.home.nav.night.mobileLabel,
      view: "night",
    },
    {
      detail: t.home.nav.day.detail,
      icon: "day",
      label: t.home.nav.day.label,
      mobileLabel: t.home.nav.day.mobileLabel,
      view: "day",
    },
    {
      detail: t.home.nav.voting.detail,
      icon: "vote",
      label: t.home.nav.voting.label,
      mobileLabel: t.home.nav.voting.mobileLabel,
      view: "voting",
    },
    {
      detail: t.home.nav.execution.detail,
      icon: "flag",
      label: t.home.nav.execution.label,
      mobileLabel: t.home.nav.execution.mobileLabel,
      view: "execution",
    },
    {
      detail: t.home.nav.result.detail,
      icon: "result",
      label: t.home.nav.result.label,
      mobileLabel: t.home.nav.result.mobileLabel,
      view: "result",
    },
  ];
}

function getLocalizedScenarios(t: Localization): Record<LocalView, Scenario> {
  return {
    board: { ...scenarios.board, ...t.home.scenarios.board },
    day: { ...scenarios.day, ...t.home.scenarios.day },
    execution: { ...scenarios.execution, ...t.home.scenarios.execution },
    home: { ...scenarios.home, ...t.home.scenarios.home },
    waiting: { ...scenarios.waiting, ...t.home.scenarios.waiting },
    night: { ...scenarios.night, ...t.home.scenarios.night },
    result: { ...scenarios.result, ...t.home.scenarios.result },
    voting: { ...scenarios.voting, ...t.home.scenarios.voting },
  };
}

export function JinrohSurface({
  roleCatalog,
}: {
  readonly roleCatalog: readonly RoleCatalogItem[];
}) {
  const { locale, t } = useI18n();
  const [activeView, setActiveView] = useState<LocalView>("home");
  const [selectedPlayerId, setSelectedPlayerId] = useState("sora");
  const [roomCode, setRoomCode] = useState("428913");
  const [activityItems, setActivityItems] = useState(initialActivityItems);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("copy");

  const localizedNavItems = useMemo(() => getLocalizedNavItems(t), [t]);
  const localizedScenarios = useMemo(() => getLocalizedScenarios(t), [t]);
  const roleNameById = useMemo(
    () => new Map(roleCatalog.map((role) => [role.id, role.presentation[locale].name])),
    [locale, roleCatalog],
  );
  const scenario = localizedScenarios[activeView];
  const selectedPlayer =
    samplePlayers.find((player) => player.id === selectedPlayerId) ?? fallbackPlayer;
  const joinedPlayers = samplePlayers.filter((player) => player.alive).length;
  const viewIndex = localizedNavItems.findIndex((item) => item.view === activeView);

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
      dateTime: new Date().toISOString(),
      icon: primaryIconForPhase(scenario.phase),
      id: `activity-${Date.now()}`,
      text: (localized) => localized.home.activity.primaryActionConfirmed(scenario.primaryAction),
      time: "now",
      visibility: activeView === "night" ? "private" : "public",
    };

    setActivityItems((currentItems) => [nextActivityItem, ...currentItems].slice(0, 6));

    if (activeView === "home") {
      setActiveView("waiting");
    }
  }

  function handleSecondaryAction() {
    if (activeView === "home" || activeView === "waiting") {
      setActiveView("waiting");
      return;
    }

    const currentTrackIndex = phaseTrack.findIndex((view) => view === activeView);
    const nextView = phaseTrack[currentTrackIndex + 1] ?? "waiting";

    setActiveView(nextView);
  }

  async function handleCopyRoomCode() {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopyStatus("copied");
      window.setTimeout(() => setCopyStatus("copy"), 1800);
    } catch {
      setCopyStatus("copyFailed");
    }
  }

  return (
    <main className={`appShell tone-${scenario.boardTone}`}>
      <section className="heroBackdrop" aria-hidden="true" />
      <div className="surfaceFrame">
        <header className="topBar">
          <a className="brandMark" href="#app-surface" aria-label={t.home.brand.homeLabel}>
            <span className="brandEmblem">
              <Icon name="wolf" />
            </span>
            <span>
              <strong>Jinroh Web</strong>
              <small>{t.home.brand.subtitle}</small>
            </span>
          </a>

          <div className="roomTools" aria-label={t.home.aria.roomTools}>
            <LanguageSwitcher />
            <span className="roomCode">{t.home.room.code(roomCode)}</span>
            <button
              className="iconButton"
              type="button"
              aria-label={t.home.copy.copyRoomCode}
              onClick={handleCopyRoomCode}
            >
              <Icon name="copy" />
            </button>
            <span className="copyStatus" aria-live="polite">
              {t.home.copy[copyStatus]}
            </span>
            <Link className="secondaryButton compactButton" href="/live">
              {t.home.buttons.liveTable}
            </Link>
            <button
              className="primaryButton compactButton"
              type="button"
              onClick={() => setActiveView("waiting")}
            >
              {t.home.buttons.createRoom}
            </button>
          </div>
        </header>

        <div id="app-surface" className="productShell">
          <aside className="stateRail" aria-label={t.home.aria.productStates}>
            <nav className="stateNav">
              {localizedNavItems.map((item) => (
                <button
                  aria-current={item.view === activeView ? "page" : undefined}
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
              <span>{t.home.phaseMeta.state(viewIndex + 1, localizedNavItems.length)}</span>
              <strong>{scenario.title}</strong>
            </div>
          </aside>

          <section className="mainStage" aria-label={t.home.aria.appSurface(scenario.title)}>
            <div className="stageHeader">
              <div>
                <h1>{scenario.title}</h1>
                <p>{scenario.summary}</p>
              </div>
              <div className="phaseMeta" aria-label={t.home.aria.currentPhase}>
                <span>
                  {scenario.phase === null ? t.game.phase.setup : t.game.phase[scenario.phase]}
                </span>
                <strong>
                  {t.home.phaseMeta.dayNight(scenario.dayNumber, scenario.nightNumber)}
                </strong>
              </div>
            </div>

            <PhaseTimeline activeView={activeView} t={t} />

            {activeView === "home" ? (
              <HomeSurface
                roomCode={roomCode}
                setRoomCode={setRoomCode}
                t={t}
                onCreateRoom={handlePrimaryAction}
                onJoinRoom={() => setActiveView("waiting")}
              />
            ) : (
              <GameBoard
                activeView={activeView}
                players={visiblePlayers}
                roleNameById={roleNameById}
                scenario={scenario}
                selectedPlayerId={selectedPlayer.id}
                t={t}
                onSelectPlayer={setSelectedPlayerId}
              />
            )}

            <ActivityStrip activityItems={activityItems} roleNameById={roleNameById} t={t} />
          </section>

          <aside className="commandPanel" aria-label={t.home.aria.commandPanel}>
            <section className="panelSection">
              <div className="sectionHeading">
                <span>{t.home.panel.hostControls}</span>
                <strong>{activeView === "result" ? t.home.panel.ended : t.home.panel.live}</strong>
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
                <span>{t.home.panel.selectedPlayer}</span>
                <strong>{selectedPlayer.alive ? t.game.seatStatus.alive : t.home.panel.out}</strong>
              </div>
              <div className="selectedPlayer">
                <span className="avatar largeAvatar" aria-hidden="true">
                  {selectedPlayer.displayName.slice(0, 1)}
                </span>
                <div>
                  <strong>{selectedPlayer.displayName}</strong>
                  <span>
                    {t.home.panel.selectedSeatRole(
                      selectedPlayer.seatNumber,
                      getHomeRoleName(selectedPlayer.roleId, roleNameById, t),
                    )}
                  </span>
                </div>
              </div>
            </section>

            <section className="panelSection">
              <div className="sectionHeading">
                <span>{t.home.panel.actionStatus}</span>
                <strong>{t.home.panel.alive(joinedPlayers)}</strong>
              </div>
              <div className="actionList">
                {actionRows.map((row) => (
                  <div className="actionRow" key={row.roleId ?? "living-players"}>
                    <Icon name={row.icon} />
                    <span>
                      {row.roleId === null
                        ? t.home.actionRows.livingPlayers
                        : getHomeRoleName(row.roleId, roleNameById, t)}
                    </span>
                    <strong data-status={row.status}>{t.home.actionRows.status[row.status]}</strong>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>

        <footer className="roleLegend" aria-label={t.home.aria.roleCounts}>
          {HOME_DEMO_ROLE_SUMMARY.map((role) => (
            <div className="roleLegendItem" key={role.roleId}>
              <Icon name={role.icon} />
              <span>{getHomeRoleName(role.roleId, roleNameById, t)}</span>
              <strong>{role.count}</strong>
            </div>
          ))}
        </footer>
      </div>

      <nav className="mobileTabs" aria-label={t.home.aria.mobileTabs}>
        {localizedNavItems.map((item) => (
          <button
            aria-current={item.view === activeView ? "page" : undefined}
            aria-label={item.label}
            className={item.view === activeView ? "mobileTab active" : "mobileTab"}
            data-view={item.view}
            key={item.view}
            type="button"
            onClick={() => setActiveView(item.view)}
          >
            <Icon name={item.icon} />
            <span>{item.mobileLabel}</span>
          </button>
        ))}
      </nav>
    </main>
  );
}

function HomeSurface({
  roomCode,
  setRoomCode,
  t,
  onCreateRoom,
  onJoinRoom,
}: {
  readonly roomCode: string;
  readonly setRoomCode: (roomCode: string) => void;
  readonly t: Localization;
  readonly onCreateRoom: () => void;
  readonly onJoinRoom: () => void;
}) {
  return (
    <div className="homeSurface">
      <div className="homeCopy">
        <h2>{t.home.hero.title}</h2>
        <p>{t.home.hero.body}</p>
      </div>

      <div className="homeActions" aria-label={t.home.aria.roomActions}>
        <section className="homeChoice">
          <span className="choiceIcon">
            <Icon name="home" />
          </span>
          <h3>{t.home.room.createTitle}</h3>
          <p>{t.home.room.createBody}</p>
          <button className="primaryButton" type="button" onClick={onCreateRoom}>
            {t.home.buttons.createRoom}
          </button>
          <Link className="secondaryButton" href="/live">
            {t.home.buttons.openLiveTable}
          </Link>
        </section>

        <section className="homeChoice">
          <span className="choiceIcon">
            <Icon name="copy" />
          </span>
          <h3>{t.home.room.joinTitle}</h3>
          <label htmlFor="room-code">{t.home.room.codeLabel}</label>
          <div className="joinControl">
            <input
              id="room-code"
              inputMode="numeric"
              maxLength={6}
              value={roomCode}
              onChange={(event) => setRoomCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            />
            <button className="secondaryButton" type="button" onClick={onJoinRoom}>
              {t.home.buttons.join}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function PhaseTimeline({
  activeView,
  t,
}: {
  readonly activeView: LocalView;
  readonly t: Localization;
}) {
  const effectiveView = activeView === "board" ? "day" : activeView;
  const activeIndex = phaseTrack.findIndex((view) => view === effectiveView);

  return (
    <ol className="phaseTimeline" aria-label={t.home.aria.currentPhase}>
      {phaseTrack.map((view, index) => {
        const isComplete = activeIndex > index;
        const isActive = view === effectiveView;

        return (
          <li className={timelineItemClassName(isActive, isComplete)} key={view}>
            <span>{isComplete ? <Icon name="check" /> : index + 1}</span>
            <strong>{getPhaseTrackLabel(view, t)}</strong>
          </li>
        );
      })}
    </ol>
  );
}

function getPhaseTrackLabel(view: LocalView, t: Localization): string {
  switch (view) {
    case "day":
      return t.game.phase.day;
    case "execution":
      return t.game.phase.execution;
    case "waiting":
      return t.game.phase.waiting;
    case "night":
      return t.game.phase.night;
    case "result":
      return t.game.phase.result;
    case "voting":
      return t.game.phase.voting;
    case "board":
    case "home":
      return t.game.phase.game;
  }
}

function GameBoard({
  activeView,
  players,
  roleNameById,
  scenario,
  selectedPlayerId,
  t,
  onSelectPlayer,
}: {
  readonly activeView: LocalView;
  readonly players: readonly Player[];
  readonly roleNameById: ReadonlyMap<RoleId, string>;
  readonly scenario: Scenario;
  readonly selectedPlayerId: string;
  readonly t: Localization;
  readonly onSelectPlayer: (playerId: string) => void;
}) {
  return (
    <div className="boardAndRoster">
      <section className="tableBoard" aria-label={t.home.aria.tableBoard}>
        <div className="tableSurface">
          <div className="tableCenter">
            <Icon name={tableCenterIconName(activeView, scenario.phase)} />
            <strong>{activeView === "result" ? t.home.board.villagersWin : scenario.title}</strong>
            <span>{scenario.notice}</span>
          </div>

          {players.map((player) => {
            const seatStyle = {
              "--seat-x": `${player.position.x}%`,
              "--seat-y": `${player.position.y}%`,
            } as CSSProperties;

            return (
              <button
                aria-pressed={selectedPlayerId === player.id}
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
                  <small>{getPlayerStatusLabel(player, t)}</small>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="mobileRoster" aria-label={t.home.panel.selectedPlayer}>
        {players.map((player) => (
          <button
            aria-pressed={selectedPlayerId === player.id}
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
              <small>{getHomeRoleName(player.roleId, roleNameById, t)}</small>
            </span>
            <em>{player.alive ? t.game.seatStatus.alive : t.game.seatStatus.out}</em>
          </button>
        ))}
      </section>
    </div>
  );
}

function ActivityStrip({
  activityItems,
  roleNameById,
  t,
}: {
  readonly activityItems: readonly ActivityItem[];
  readonly roleNameById: ReadonlyMap<RoleId, string>;
  readonly t: Localization;
}) {
  return (
    <section className="activityStrip" aria-label={t.home.activity.heading}>
      <div className="sectionHeading">
        <span>{t.home.activity.heading}</span>
        <strong>{t.home.activity.logLabel}</strong>
      </div>
      <div className="activityRows">
        {activityItems.map((activityItem) => (
          <div className="activityRow" key={activityItem.id}>
            <time dateTime={activityItem.dateTime}>{activityItem.time}</time>
            <Icon name={activityItem.icon} />
            <span>{activityItem.text(t, roleNameById)}</span>
            <strong>{t.home.activity.visibility[activityItem.visibility]}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function getHomeRoleName(
  roleId: RoleId,
  roleNameById: ReadonlyMap<RoleId, string>,
  t: Localization,
): string {
  return roleNameById.get(roleId) ?? t.game.catalog.unknown.role.name;
}

function getPlayerStatusLabel(player: Player, t: Localization): string {
  if (!player.alive) {
    return t.game.seatStatus.out;
  }

  if (player.isHost) {
    return t.game.seatStatus.host;
  }

  if (player.isCurrent) {
    return t.game.seatStatus.you;
  }

  switch (player.status) {
    case "executed":
      return t.game.seatStatus.out;
    case "observing":
      return t.game.seatStatus.watching;
    case "pending":
      return t.game.seatStatus.pending;
    case "ready":
      return t.game.seatStatus.ready;
    case "speaking":
      return t.game.seatStatus.speaking;
    case "voted":
      return t.game.seatStatus.voted;
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
