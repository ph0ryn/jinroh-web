export const enLocalization = {
  api: {
    errors: {
      bad_request: "The request could not be accepted.",
      conflict: "The room state changed. Refresh and try again.",
      not_found: "The room could not be found.",
      rate_limited: (retryAfterSeconds: number | null) =>
        retryAfterSeconds === null
          ? "Too many attempts. Wait before trying again."
          : `Too many attempts. Try again in ${retryAfterSeconds} seconds.`,
      server_error: "Something went wrong. Try again in a moment.",
      unauthorized: "Your saved seat expired. Create a room or join again.",
      unknown: "The request failed.",
    },
    networkFailure: "Cannot reach the table. Check your connection, then try again.",
    requestFailedWithStatus: (status: number) => `Could not complete that request (${status}).`,
  },
  common: {
    language: {
      ariaLabel: "Language",
      english: "English",
      japanese: "Japanese",
    },
    none: "None",
  },
  events: {
    details: {
      acceptedVotes: "Accepted votes",
      candidate: "Candidate",
      player: "Player",
      votes: "Votes",
      winner: "Winner",
    },
    kind: {
      attack_guarded: "Guarded attack",
      game_ended: "Game ended",
      game_started: "Game started",
      phase_changed: "Game advanced",
      player_died: "Player died",
      player_executed: "Execution",
      vote_resolved: "Voting complete",
      vote_submitted: "Vote submitted",
    },
    message: {
      attack_guarded: "Someone was attacked, but no one died.",
      game_ended: (winner: string) => `${winner} won the game.`,
      game_started: "The game started. Confirm your role before the first day.",
      phase_changed: (phase: string) => `${phase} started.`,
      player_died: (targetName: string) => `${targetName} died.`,
      player_executed: (targetName: string) => `${targetName} was executed.`,
      unknown: "The public log was updated.",
      vote_resolved: {
        candidate: (targetName: string) => `${targetName} received the most votes.`,
        noExecution: "Voting ended with no execution.",
      },
      vote_submitted: "Votes were submitted.",
    },
  },
  game: {
    catalog: {
      actionProgress: {
        current_speech_turn: "Current speaker",
        day_ready: "Ready to vote",
        execution_last_words: "Last words",
        first_night_ready: "Ready for daybreak",
        night_actions_hidden: "Night actions remain secret until dawn",
        role_actions: "Role actions",
        votes_submitted: "Votes cast",
      },
      rolePresets: {
        "6p-classic": {
          description: "A compact game with one werewolf and a seer.",
          name: "Classic six",
          shortLabel: "6C",
        },
        "7p-guard": {
          description: "A seven-player game with a guard to protect the village.",
          name: "Guard seven",
          shortLabel: "7G",
        },
        "7p-open": {
          description: "A tense seven-player game without a guard.",
          name: "Open seven",
          shortLabel: "7O",
        },
        "9p-spiritist": {
          description:
            "A nine-player game where the spiritist reveals the executed player's nature.",
          name: "Spiritist nine",
          shortLabel: "9S",
        },
      },
      unknown: {
        actionProgress: "Progress unavailable",
        role: {
          description: "No description is available for this role.",
          name: "Unknown role",
          shortLabel: "?",
        },
        rolePreset: {
          description: "No description is available for this role mix.",
          name: "Unknown role mix",
          shortLabel: "?",
        },
      },
    },
    actionProgress: {
      none: "none",
      private: "private",
    },
    phase: {
      day: "Day",
      execution: "Execution",
      game: "Game",
      waiting: "Waiting",
      night: "Night",
      result: "Result",
      setup: "Setup",
      voting: "Voting",
    },
    playerResult: {
      draw: "Draw",
      lose: "Lose",
      special: "Special",
      win: "Win",
    },
    seatStatus: {
      alive: "Alive",
      disconnected: "Disconnected",
      host: "Host",
      left: "Left",
      notReady: "Not ready",
      out: "Out",
      pending: "Pending",
      player: "Player",
      ready: "Ready",
      speaking: "Speaking",
      voted: "Voted",
      watching: "Watching",
      you: "You",
    },
    team: {
      none: "No team",
    },
  },
  live: {
    actionGuide: {
      closedWithoutReceipt: "This action is no longer available.",
      irreversibleWarning: "This cannot be changed after confirmation.",
      reselect: "Choose again",
      submitting: "Submitting...",
    },
    aria: {
      commonPhaseTiming: "Game timing",
      currentPhase: "Current scene",
      entryMode: "Choose how to enter a room",
      invite: "Invite",
      lobbyControls: "Game preparation controls",
      roundTable: "Round table",
      nightConversation: "Night conversation",
      notifications: "Notifications",
      popupPanels: "Popup panels",
      publicLog: "Public log",
      roleCounts: "Automatic role counts",
      rolePresets: "Role presets",
      roomActions: "Room actions",
      roomInviteTools: "Room invite tools",
      roomSetup: "Room setup",
      roomState: "Room state",
      settingsSections: "Settings sections",
    },
    buttons: {
      applySettings: "Apply settings",
      cancel: "Cancel",
      cancelReadiness: "Not ready",
      clear: "Clear",
      closeSettings: "Close settings",
      closeDialog: (title: string) => `Close ${title}`,
      confirmLeaveRoom: "Leave room",
      confirmSwitchRoom: "Leave and switch",
      copyCode: "Copy code",
      copied: "Copied!",
      createRoom: "Create room",
      creatingRoom: "Creating room...",
      dismissNotification: "Dismiss notification",
      joinRoom: "Join room",
      joiningRoom: "Joining room...",
      leaveRoom: "Leave room",
      leavingRoom: "Leaving room...",
      markReady: "I'm ready",
      nightChat: "Night chat",
      publicLog: "Public log",
      refresh: "Refresh",
      reset: "Reset",
      send: "Send",
      settings: "Settings",
      shareInvite: "Share invite",
      showQrCode: "Show QR code",
      startGame: "Start game",
      switchingRoom: "Switching rooms...",
    },
    eventLog: {
      emptyBody: "Events will appear here as the game unfolds.",
      emptyTitle: "No public events yet",
      meta: (count: number) => `${count} events`,
      title: "Public log",
    },
    effects: {
      death: {
        kicker: "DEATH REPORT",
        message: (playerNames: readonly string[]) => {
          if (playerNames.length === 0) {
            return "A player has died";
          }

          if (playerNames.length === 1) {
            return `${playerNames[0]} has died`;
          }

          const leadingNames = playerNames.slice(0, -1).join(", ");
          const finalName = playerNames.at(-1);

          return `${leadingNames} and ${finalName} have died`;
        },
      },
      phase: {
        code: {
          day: (dayNumber: number) => `DAY ${String(dayNumber).padStart(2, "0")}`,
          execution: (dayNumber: number) => `DAY ${String(dayNumber).padStart(2, "0")}`,
          night: (nightNumber: number) => `NIGHT ${String(nightNumber).padStart(2, "0")}`,
          voting: (dayNumber: number) => `DAY ${String(dayNumber).padStart(2, "0")}`,
        },
        label: (phaseName: string) => `${phaseName} phase`,
        title: {
          day: "Dawn has come",
          execution: "The execution begins",
          night: "Night has fallen",
          voting: "Voting is open",
        },
      },
      role: {
        assignment: "ROLE ASSIGNMENT",
        identity: (roleName: string) => `Your current role is ${roleName}.`,
        kicker: "Your role",
        reveal: "Reveal role card",
      },
      vote: {
        announcement: {
          candidate: (playerName: string, voteCount: number) =>
            `${playerName} received the most votes with ${voteCount}.`,
          noVotes: "Voting ended without any valid votes.",
          tie: (voteCount: number) =>
            `Voting ended in a tie at ${voteCount} vote${voteCount === 1 ? "" : "s"}.`,
        },
        ballotDetails: {
          noVotes: "NO VOTES",
          sealed: "SEALED BALLOTS",
        },
        header: (dayNumber: number) => `OFFICIAL COUNT · DAY ${String(dayNumber).padStart(2, "0")}`,
        outcome: {
          candidateBody: (voteCount: number) =>
            `${voteCount} vote${voteCount === 1 ? "" : "s"} · highest total`,
          candidateKicker: "EXECUTION CANDIDATE",
          noCandidate: "No execution candidate",
          noVotesBody: "No valid ballots were recorded",
          noVotesKicker: "NO VALID VOTES",
          tieBody: (voteCount: number) =>
            `Highest total tied at ${voteCount} vote${voteCount === 1 ? "" : "s"}`,
          tieKicker: "TIED VOTE",
        },
        seal: {
          candidate: "VERDICT",
          noVotes: "VOID",
          tie: "TIED",
        },
        title: "Vote results",
      },
      victory: {
        announcement: (title: string, result: string | null) =>
          result === null ? title : `${title}. Your result: ${result}`,
        kicker: "FINAL OUTCOME",
        resultLabel: "Your result",
        subtitle: "The result is final. Review the outcome and public log.",
        title: (winner: string) => `Victory: ${winner}`,
      },
    },
    privateEventLog: {
      meta: (count: number) => `${count} private result${count === 1 ? "" : "s"}`,
      title: "Private results",
    },
    hints: {
      controlsNeedRoom: "Create or join a room to use table controls.",
      hostOnlyStart: "Only the host can start the game.",
      reviewResult: "Review the result from this table.",
      readyToStart: "Everyone is ready. You can start the game.",
      startAfterSync: "You can start when the update finishes.",
      startOutsideLobby: "Start is only available before a game or from its result.",
      startNeedsRoom: "Create or join a room before starting.",
      tooManyPlayers: "More players have joined than the selected room size allows.",
      waitingForConnections: (count: number) =>
        `${count} player${count === 1 ? "" : "s"} must reconnect before starting.`,
      waitingForHostStart: "Everyone is ready. Waiting for the host to start.",
      waitingForPlayers: (count: number) =>
        `${count} more player${count === 1 ? "" : "s"} needed before starting.`,
      waitingForReadiness: (count: number) =>
        `${count} player${count === 1 ? " is" : "s are"} not ready yet.`,
    },
    invite: {
      allSeatsFilled: "All seats are filled.",
      codeLabel: "Invite code",
      inviteText: (roomCode: string, roomUrl: string) =>
        `Jinroh Web room ${roomCode}\nOpen ${roomUrl} and join with this code.`,
      copyFailed: "Could not copy the room code. Copy it manually and try again.",
      morePlayersNeeded: (count: number) => `${count} more player${count === 1 ? "" : "s"} needed.`,
      openSeats: (count: number) => `${count} seats open`,
      progressLabel: (joined: number, target: number) => `${joined} of ${target} seats filled`,
      full: "Full",
      requirement: "Start requirement",
      shareText: (roomCode: string) => `Join Jinroh Web room ${roomCode}.`,
      shareFailed: "Could not share or copy the room invite.",
      shareFallbackCopied: "Sharing is unavailable, so the invite was copied instead.",
      shareSucceeded: "Room invite shared.",
      tableFull: "Table full",
      tips: {
        settings: "Settings stay behind the host Settings button.",
        share: "Share the room code with the other players.",
      },
    },
    waiting: {
      host: "Host",
      hostControls: "Host controls",
      open: "Open",
      openSeat: "Open seat",
      player: "Player",
      playerControls: "Player controls",
      prepareNextGame: "Prepare for another game",
      prepareToPlay: "Get ready to play",
      seat: (seatNumber: number) => `Seat ${seatNumber}`,
      seated: (joined: number, target: number) => `${joined} / ${target} seated`,
    },
    leaveConfirmation: {
      body: "You will leave your seat. If you are the host, host controls will pass to the first remaining player.",
      meta: "Room access",
      title: "Leave this room?",
    },
    switchConfirmation: {
      createBody: (currentRoomCode: string) =>
        `You are still in room ${currentRoomCode}. Leave it and create a new room? If creation fails, you will remain in the current room.`,
      joinBody: (currentRoomCode: string, targetRoomCode: string) =>
        `You are still in room ${currentRoomCode}. Leave it and join room ${targetRoomCode}? If joining fails, you will remain in the current room.`,
      meta: "Room switch",
      title: "Leave the current room and switch?",
    },
    nightConversation: {
      draftCount: (current: number, max: number) => `${current}/${max}`,
      message: "Message",
      noMessages: "No messages yet.",
      readOnly: "Read only",
    },
    page: {
      result: "Result",
      room: (roomCode: string) => `Room ${roomCode}`,
      roomEntry: "Enter room",
    },
    player: {
      yourRole: "Your role",
    },
    phasePanel: {
      day: { label: "Day", message: "Dawn has come. Discuss who you will vote for." },
      execution: { label: "Execution", message: "Waiting for the condemned player's last words." },
      game: { label: "Game", message: "Loading the current game." },
      night: { label: "Night", message: "Night has fallen. Act in secret if your role allows it." },
      result: (winner: string) => ({ label: "Result", message: `${winner} won.` }),
      syncing: { label: "Updating", message: "Loading the latest game information." },
      voting: { label: "Voting", message: "Choose the player you want to execute." },
    },
    room: {
      checkingCurrent: "Checking your current room...",
      created: (roomCode: string) => `Room ${roomCode} created. Share the code with players.`,
      currentChanged: "Your current room changed. The latest room is now displayed.",
      currentCouldNotLoad:
        "Could not check your current room. Your room has not been cleared; reconnecting automatically.",
      currentExists: "You are still in another room. Return to it or leave it before switching.",
      enterCode: "Enter a six-digit room code.",
      closed: "That room is closed and can no longer be joined.",
      full: "That room is full. You are still in your current room.",
      gameChanged: "The game changed. Review the latest room state and try again.",
      identityExpired: "Your saved seat expired. Create a room or join again.",
      identityReset: "Your saved seat was reset on this device.",
      identityResetting: "Your saved seat expired. Reconnecting now.",
      initialStatus: "You can return to this room later from the same device.",
      joined: (roomCode: string) => `Joined room ${roomCode}.`,
      left: "Left the room.",
      notFound: "That room could not be found. Check the code and try again.",
      notJoinable: "That room can no longer be joined. You are still in your current room.",
      playersNotReady: "Every connected player must be ready before the game can start.",
      readyToJoin: "Ready to join a room.",
      rosterChanged: "The player roster changed. Review readiness and try again.",
      synced: (roomCode: string) => `Room ${roomCode} updated.`,
      syncFailed: "Could not load the latest room information. Retrying automatically.",
      switchForbidden: (roomCode: string) =>
        `Room ${roomCode} is in progress. You cannot leave or switch rooms during the game.`,
      switchForbiddenGeneric: "You cannot leave or switch rooms while the game is in progress.",
    },
    roomStatus: {
      status: {
        ended: "Ended",
        playing: "Playing",
        waiting: "Waiting",
      },
      value: (status: string, phase: string) => `${status} / ${phase}`,
    },
    setup: {
      createHint: "Create a new room and prepare the game as host.",
      createPanelTitle: "Prepare the game",
      createTitle: "Create a room",
      displayName: "Display name",
      guest: "Guest",
      host: "Host",
      joinHint:
        "Paste or type the six-digit code. The join button becomes active once all digits are filled.",
      joinPanelTitle: "Enter an invite code",
      joinTitle: "Join with code",
      player: "Player",
      players: "Players",
      profileNote: "Your display name is saved on this device.",
      roomCode: "Room code",
      roomCodeDigit: (index: number) => `Room code digit ${index}`,
      useIdentityHint: "Other players will see this name during the game.",
      yourSeat: "Your seat",
    },
    storageUnavailable: {
      body: "Jinroh Web cannot safely keep your anonymous seat because this browser is blocking local storage. Enable site storage or leave private browsing, then reload this page.",
      kicker: "Browser setup",
      title: "Browser storage is required",
    },
    settings: {
      dayMode: {
        ordered: {
          body: "Players speak through fixed slots before voting opens.",
          label: "Ordered",
          title: "Ordered speech",
        },
        readyCheck: {
          body: "Voting opens when players are ready or the meeting cap is reached.",
          label: "Ready check",
          title: "Ready check",
        },
      },
      flow: {
        day: "Day",
        firstNight: "First night",
        lastWords: "Last words",
        night: "Night",
        orderedDay: (firstRounds: number, normalRounds: number, duration: string) =>
          `${firstRounds}r first / ${normalRounds}r normal x ${duration}`,
        readyDay: (duration: string) => `alive x ${duration} cap`,
        vote: "Vote",
      },
      general: {
        dayProgressionBody: "The selected mode determines which timers are used during the day.",
        dayProgressionTitle: "Day progression",
        heading: "Overall settings",
        summary: "Set the day progression and vote result visibility for the room.",
        voteDetailBody: "Choose how much detail is shown after voting.",
        voteDetailTitle: "Vote detail",
        voteVisibility: "Visibility",
        voteVisibilityCountOnly: "Count only",
        voteVisibilityVoterToTarget: "Voter to target",
      },
      roles: {
        assigned: "assigned",
        count: (roleName: string) => `${roleName} count`,
        countsBody: "Adjust role counts for the selected room size.",
        countsTitle: "Role counts",
        custom: "Custom",
        decrease: (roleName: string) => `Decrease ${roleName}`,
        increase: (roleName: string) => `Increase ${roleName}`,
        mixAppearsAt: (playerCount: number) => `Role mix appears at ${playerCount} players`,
        noExtraOptions: "No extra role options for the current automatic mix.",
        presetRoleMix: (presetName: string) => `${presetName} role mix`,
        presetsBody: "Use a tested mix for this room size, then adjust manually if needed.",
        presetsTitle: "Role presets",
        specificBody: "Only options for active roles affect the game when it starts.",
        specificTitle: "Role-specific settings",
      },
      seats: (count: number) => `${count} seat${count === 1 ? "" : "s"}`,
      tabs: {
        general: "General",
        roles: "Roles",
        timers: "Timers",
      },
      timers: {
        commonBody: "These timers are used regardless of the day progression mode.",
        commonTitle: "Game timers",
        firstDayRounds: "First day rounds",
        firstNight: "First night",
        flowPreview: "Flow preview",
        heading: "Time settings",
        lastWords: "Last words",
        night: "Night",
        normalRounds: "Normal rounds",
        orderedFlow: "Ordered speech flow.",
        orderedSpeech: "Ordered speech",
        orderedSpeechBody: "Speech slot timing for first and normal days.",
        orderedSpeechTiming: "Ordered speech timing",
        readyCheck: "Ready check",
        readyCheckBody: "Meeting cap timing for ready-check days.",
        readyCheckFlow: "Ready check flow.",
        readyCheckTiming: "Ready check timing",
        readyPerPlayer: "Ready / player",
        speechPerPlayer: "Speech / player",
        summary: "Set shared timers separately from the selected daytime mode.",
        vote: "Vote",
      },
      title: "Game settings",
      validation: {
        addRoles: (count: number) => `Add ${count} more role${count === 1 ? "" : "s"}.`,
        availableForPlayers: (min: number, max: number) =>
          `Role counts are available for ${min}-${max} players.`,
        countAtLeast: (roleName: string, count: number) =>
          `${roleName} count must be at least ${count}.`,
        countAtMost: (roleName: string, count: number) =>
          `${roleName} count must be at most ${count}.`,
        countNonNegative: (roleName: string) => `${roleName} count must be a non-negative integer.`,
        needsAdjustment: "Needs adjustment",
        readyToApply: "Ready to apply",
        removeRoles: (count: number) => `Remove ${count} role${count === 1 ? "" : "s"}.`,
        validForWaiting: "Role counts match this room.",
      },
      description: "Adjust the room flow before the first night starts.",
    },
    status: {
      actionWindowClosed: "Action window is not open.",
      nightChatClosed: "Night chat is not open.",
      realtimeFailed: "Automatic updates paused. The room will still refresh periodically.",
    },
    table: {
      gameStateLoading: "Loading the game.",
      noticeDay: "When discussion ends, get ready to vote.",
      noticeExecution: "Waiting for the condemned player's last words.",
      noticeNight: "Your role action remains hidden from the other players.",
      noticeResult: (winner: string) => `${winner} win.`,
      noticeVoting: "Choose the player you want to execute.",
      operation: "Table operation",
    },
    time: {
      closed: "closed",
      dueNow: "due now",
      durationMinutes: (minutes: number) => `${minutes}m`,
      durationMinutesSeconds: (minutes: number, seconds: number) => `${minutes}m ${seconds}s`,
      durationSeconds: (seconds: number) => `${seconds}s`,
      unknown: "unknown",
    },
    toast: {
      tones: {
        error: "Error",
        info: "Notice",
        success: "Done",
        warning: "Warning",
      },
    },
  },
} as const;

export type Localization = WidenLocalization<typeof enLocalization>;

type WidenLocalization<Value> = Value extends (...args: infer Args) => infer Return
  ? (...args: Args) => WidenLocalization<Return>
  : Value extends string
    ? string
    : {
        readonly [Key in keyof Value]: WidenLocalization<Value[Key]>;
      };
