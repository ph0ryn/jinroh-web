import { describe, expect, it, vi } from "vitest";

import { Role, RoleRegistry, roleRegistry } from "./game/roles";
import {
  ActionActorStateRequirement,
  ActionTargetStateRequirement,
  DEATH_REASON,
  EFFECT_TAG,
  GameEffectKind,
  GameEffectLayer,
  GamePhase,
  RoleSetupContributionKind,
  RoleTargetKind,
} from "./game/types";
import {
  getAvailableNightActions,
  makeDefaultRuleSetForPlayers,
  resolvePhase as resolvePhaseForGame,
  startGame,
} from "./gameEngine";

import type {
  DeathResolvedContext,
  ExecutionContext,
  ExecutionResolvedContext,
  PlayerRoleContext,
  RoleActionResolvedContext,
  RoleContext,
  WinnerJudgementContext,
} from "./game/roles";
import type {
  GameEndCandidate,
  GameEffect,
  PlayerId,
  ResolvedRoleSetup,
  RoleActionDefinition,
  RoleId,
  Team,
  WinnerJudgementContribution,
} from "./game/types";
import type {
  EngineAction,
  PhaseCurrentAction,
  PhaseResolutionInput,
  PlayerRuntimeState,
} from "./gameEngine";

const TEST_GAME_ID = "550e8400-e29b-41d4-a716-446655440000";

function resolvePhase(input: Omit<PhaseResolutionInput, "gameId">) {
  return resolvePhaseForGame({ ...input, gameId: TEST_GAME_ID });
}

const SYNTHETIC_ACTION_KIND = "execution_skip";
const FOX_TEAM = roleRegistry.get("fox").team;
const FUTURE_TEAM = {
  id: "future_collective",
  presentation: { en: "Future Collective", ja: "未来陣営" },
} as const;
const VILLAGE_TEAM = roleRegistry.get("villager").team;

describe("role action extension contract", () => {
  it("rejects action kinds that are absent from the resolver manifest", () => {
    const role = new ActionManifestRole("missing_action_definition", [
      DECLARED_PHASE_ACTION_DEFINITION,
    ]);

    expect(() => role.getActionDefinition("undeclared_action")).toThrow(
      "Role missing_action_definition does not define action: undeclared_action",
    );
  });

  it("rejects duplicate action kinds and meaningless targetless confirmation copy", () => {
    expect(
      () =>
        new RoleRegistry([
          new ActionManifestRole("duplicate_action_definition", [
            DECLARED_PHASE_ACTION_DEFINITION,
            DECLARED_PHASE_ACTION_DEFINITION,
          ]),
        ]),
    ).toThrow("Duplicate role action kinds: duplicate_action_definition");

    const invalidTargetlessDefinition = {
      ...DECLARED_PHASE_ACTION_DEFINITION,
      presentation: {
        en: {
          ...DECLARED_PHASE_ACTION_DEFINITION.presentation.en,
          targetConfirmation: { afterTarget: "?", beforeTarget: "Choose " },
        },
        ja: {
          ...DECLARED_PHASE_ACTION_DEFINITION.presentation.ja,
          targetConfirmation: { afterTarget: "を選びますか？", beforeTarget: "" },
        },
      },
    } as unknown as RoleActionDefinition;

    expect(
      () =>
        new RoleRegistry([
          new ActionManifestRole("invalid_targetless_presentation", [invalidTargetlessDefinition]),
        ]),
    ).toThrow(
      "Invalid role action definition: invalid_targetless_presentation:declared_phase_action",
    );
  });

  it("includes static action presentation in the registry version", () => {
    const changedDefinition: RoleActionDefinition = {
      ...DECLARED_PHASE_ACTION_DEFINITION,
      presentation: {
        ...DECLARED_PHASE_ACTION_DEFINITION.presentation,
        en: {
          ...DECLARED_PHASE_ACTION_DEFINITION.presentation.en,
          label: "Changed action guide",
        },
      },
    };
    const originalRegistry = new RoleRegistry([
      new ActionManifestRole("versioned_action", [DECLARED_PHASE_ACTION_DEFINITION]),
    ]);
    const changedRegistry = new RoleRegistry([
      new ActionManifestRole("versioned_action", [changedDefinition]),
    ]);

    expect(changedRegistry.version).not.toBe(originalRegistry.version);
  });

  it("opens registered role declarations during the first-night start window", () => {
    const villagerRole = roleRegistry.get("villager");
    const originalGetActionDefinition = villagerRole.getActionDefinition.bind(villagerRole);
    const getActionDefinitionSpy = vi
      .spyOn(villagerRole, "getActionDefinition")
      .mockImplementation((actionKind) =>
        actionKind === DECLARED_PHASE_ACTION_KIND
          ? DECLARED_PHASE_ACTION_DEFINITION
          : originalGetActionDefinition(actionKind),
      );
    const getActionsSpy = vi.spyOn(villagerRole, "getActions").mockImplementation((context) =>
      context.state.phase === "night" && context.state.nightNumber === 1
        ? [
            {
              kind: DECLARED_PHASE_ACTION_KIND,
              roleGroupRoleId: null,
              target: RoleTargetKind.None,
              targetStateRequirement: ActionTargetStateRequirement.Assigned,
            },
          ]
        : [],
    );

    try {
      const players = [
        { id: "1", name: "A" },
        { id: "2", name: "B" },
        { id: "3", name: "C" },
        { id: "4", name: "D" },
        { id: "5", name: "E" },
        { id: "6", name: "F" },
      ];
      const result = startGame(players, makeDefaultRuleSetForPlayers(players.length));

      expect(result.ok).toBe(true);

      if (result.ok) {
        const villagerPlayerIds = result.assignments
          .filter((assignment) => assignment.roleId === villagerRole.id)
          .map((assignment) => assignment.playerId);
        const declaredActions = result.actions.filter(
          (action) => action.kind === DECLARED_PHASE_ACTION_KIND,
        );

        expect(declaredActions).toHaveLength(villagerPlayerIds.length);
        expect(
          declaredActions
            .map((action) => action.actorPlayerId)
            .toSorted((left, right) => String(left).localeCompare(String(right))),
        ).toEqual(villagerPlayerIds.toSorted((left, right) => left.localeCompare(right)));
        expect(declaredActions.every((action) => action.resolverRoleId === villagerRole.id)).toBe(
          true,
        );
      }
    } finally {
      getActionsSpy.mockRestore();
      getActionDefinitionSpy.mockRestore();
    }
  });

  it("opens identical declarations from arbitrary role ids exactly once on every phase entry", () => {
    const firstRole = new PhaseDeclarationRole("phase_declaration_first");
    const secondRole = new PhaseDeclarationRole("phase_declaration_second");
    const roles = new RoleRegistry([...roleRegistry.getAll(), firstRole, secondRole]);
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: firstRole.id },
      { alive: true, playerId: "3", roleId: secondRole.id },
      { alive: true, playerId: "4", roleId: "villager" },
      { alive: true, playerId: "5", roleId: "seer" },
      { alive: true, playerId: "6", roleId: "guard" },
    ];
    const ruleSet = makeDefaultRuleSetForPlayers(players.length);
    const resolvedRoleSetup = createResolvedRoleSetup(players);
    const firstNightActions = getAvailableNightActions(
      players,
      1,
      ruleSet,
      resolvedRoleSetup,
      [],
      roles,
    );
    const day = resolvePhase({
      actions: [],
      currentPhase: "night",
      dayNumber: 0,
      nightNumber: 1,
      players,
      resolvedRoleSetup,
      roles,
      ruleSet,
    });
    const voting = resolvePhase({
      actions: [],
      currentPhase: "day",
      dayNumber: 1,
      nightNumber: 1,
      players,
      resolvedRoleSetup,
      roles,
      ruleSet,
    });
    const execution = resolvePhase({
      actions: [
        { actorPlayerId: "1", kind: "vote", resolverRoleId: null, targetPlayerId: "6" },
        { actorPlayerId: "2", kind: "vote", resolverRoleId: null, targetPlayerId: "6" },
        { actorPlayerId: "3", kind: "vote", resolverRoleId: null, targetPlayerId: "5" },
      ],
      currentPhase: "voting",
      dayNumber: 1,
      nightNumber: 1,
      players,
      resolvedRoleSetup,
      roles,
      ruleSet,
    });
    const secondNight = resolvePhase({
      actions: [
        {
          actorPlayerId: "6",
          kind: "execution_skip",
          resolverRoleId: null,
          targetPlayerId: null,
        },
      ],
      currentPhase: "execution",
      dayNumber: 1,
      nightNumber: 1,
      players,
      resolvedRoleSetup,
      roles,
      ruleSet,
    });

    expectDeclaredPhaseActions(firstNightActions, "night", firstRole.id, secondRole.id);
    expect(day.nextPhase).toBe("day");
    expectDeclaredPhaseActions(day.actionsToOpen, "day", firstRole.id, secondRole.id);
    expect(voting.nextPhase).toBe("voting");
    expectDeclaredPhaseActions(voting.actionsToOpen, "voting", firstRole.id, secondRole.id);
    expect(execution.nextPhase).toBe("execution");
    expectDeclaredPhaseActions(execution.actionsToOpen, "execution", firstRole.id, secondRole.id);
    expect(secondNight.nextPhase).toBe("night");
    expectDeclaredPhaseActions(secondNight.actionsToOpen, "night", firstRole.id, secondRole.id);
    expect(firstRole.observedPhases).toEqual(["night", "day", "voting", "execution", "night"]);
    expect(secondRole.observedPhases).toEqual(["night", "day", "voting", "execution", "night"]);
  });

  it("does not reopen phase declarations for a follow-up in the same phase", () => {
    const declarationRole = new PhaseDeclarationRole("same_phase_declaration");
    const roles = new RoleRegistry([...roleRegistry.getAll(), declarationRole]);
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: declarationRole.id },
      { alive: true, playerId: "3", roleId: "villager" },
      { alive: true, playerId: "4", roleId: "seer" },
    ];
    const ruleSet = makeDefaultRuleSetForPlayers(players.length);
    const resolvedRoleSetup = createResolvedRoleSetup(players);
    const day = resolvePhase({
      actions: [],
      currentPhase: "night",
      dayNumber: 0,
      nightNumber: 1,
      players,
      resolvedRoleSetup,
      roles,
      ruleSet,
    });
    const declaration = day.actionsToOpen.find(
      (action) => action.resolverRoleId === declarationRole.id,
    );

    expect(declaration).toBeDefined();

    if (declaration?.actorPlayerId === undefined || declaration.actorPlayerId === null) {
      return;
    }

    const currentAction = toCurrentAction(declaration);
    const followUp = resolvePhase({
      actions: [
        {
          actionKey: declaration.key,
          actorPlayerId: declaration.actorPlayerId,
          currentActionId: currentAction.id,
          kind: declaration.kind,
          resolverRoleId: declarationRole.id,
          submittedAt: "2099-01-01T00:00:01.000Z",
          targetPlayerId: null,
        },
      ],
      currentActions: [currentAction],
      currentPhase: "day",
      dayNumber: 1,
      nightNumber: 1,
      players,
      resolvedRoleSetup,
      roles,
      ruleSet,
    });

    expect(followUp.nextPhase).toBe("day");
    expect(followUp.actionsToOpen).toEqual([
      expect.objectContaining({
        kind: DECLARED_PHASE_FOLLOW_UP_ACTION_KIND,
        resolverRoleId: declarationRole.id,
      }),
    ]);
    expect(declarationRole.observedPhases).toEqual(["day"]);
  });

  it("resumes ordered speech after a timeout opens a synthetic role follow-up", () => {
    const declarationRole = new PhaseDeclarationRole("speech_follow_up");
    const roles = new RoleRegistry([...roleRegistry.getAll(), declarationRole]);
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: declarationRole.id },
      { alive: true, playerId: "3", roleId: "villager" },
      { alive: true, playerId: "4", roleId: "seer" },
    ];
    const orderedSpeechSlots = [
      { slotIndex: 0, speakerPlayerId: "1" },
      { slotIndex: 1, speakerPlayerId: "3" },
    ];
    const ruleSet = {
      ...makeDefaultRuleSetForPlayers(players.length),
      dayMode: "ordered_speech" as const,
    };
    const resolvedRoleSetup = createResolvedRoleSetup(players);
    const speechAction = toCurrentAction({
      actorPlayerId: "1",
      actorRoleId: null,
      actorStateRequirement: ActionActorStateRequirement.Alive,
      eligibleTargetPlayerIds: [],
      key: "end-speech:1:0:1",
      kind: "end_speech",
      resolverRoleId: null,
      targetKind: "none",
      targetStateRequirement: ActionTargetStateRequirement.Assigned,
    });
    const roleAction = toCurrentAction(
      {
        actorPlayerId: "2",
        actorRoleId: null,
        actorStateRequirement: ActionActorStateRequirement.Alive,
        eligibleTargetPlayerIds: [],
        key: "speech-follow-up:day:2",
        kind: DECLARED_PHASE_ACTION_KIND,
        resolverRoleId: declarationRole.id,
        targetKind: "none",
        targetStateRequirement: ActionTargetStateRequirement.Assigned,
      },
      1,
    );
    const timedOutWindow = resolvePhase({
      actions: [
        {
          actionKey: roleAction.key,
          actorPlayerId: "2",
          currentActionId: roleAction.id,
          kind: roleAction.kind,
          resolverRoleId: declarationRole.id,
          submittedAt: "2099-01-01T00:00:01.000Z",
          targetPlayerId: null,
        },
      ],
      currentActions: [speechAction, roleAction],
      currentPhase: "day",
      dayNumber: 1,
      nightNumber: 1,
      orderedSpeechSlots,
      players,
      resolvedRoleSetup,
      roles,
      ruleSet,
    });

    expect(timedOutWindow.nextPhase).toBe("day");
    expect(timedOutWindow.actionsToOpen).toEqual([
      expect.objectContaining({
        kind: DECLARED_PHASE_FOLLOW_UP_ACTION_KIND,
        resolverRoleId: declarationRole.id,
      }),
    ]);

    const followUpAction = toCurrentAction(timedOutWindow.actionsToOpen[0]!);
    const resumedWindow = resolvePhase({
      actions: [
        {
          actionKey: followUpAction.key,
          actorPlayerId: "2",
          currentActionId: followUpAction.id,
          kind: followUpAction.kind,
          resolverRoleId: declarationRole.id,
          submittedAt: "2099-01-01T00:00:02.000Z",
          targetPlayerId: null,
        },
      ],
      currentActions: [followUpAction],
      currentPhase: "day",
      dayNumber: 1,
      nightNumber: 1,
      orderedSpeechSlots,
      players,
      resolvedActionHistory: [
        {
          actionKey: speechAction.key,
          actionKind: speechAction.kind,
          actorPlayerId: speechAction.actorPlayerId,
          actorRoleId: null,
          dayNumber: 1,
          eventId: "1",
          nightNumber: 1,
          phase: "day",
          phaseInstanceId: "timed-out-speech-window",
          resolutionStatus: "missing",
          resolverRoleId: null,
          targetPlayerIds: [],
        },
      ],
      resolvedRoleSetup,
      roles,
      ruleSet,
    });

    expect(resumedWindow.nextPhase).toBe("day");
    expect(resumedWindow.actionsToOpen).toEqual([
      expect.objectContaining({
        key: "end-speech:1:1:3",
        kind: "end_speech",
        resolverRoleId: null,
      }),
    ]);
  });

  it("dispatches role-owned actions in every core phase without action-kind branches", () => {
    const portableRole = new PortableWindowRole();
    const roles = new RoleRegistry([...roleRegistry.getAll(), portableRole]);
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: portableRole.id },
      { alive: true, playerId: "3", roleId: "villager" },
      { alive: true, playerId: "4", roleId: "seer" },
    ];
    const resolvedRoleSetup = createResolvedRoleSetup(players);
    const ruleSet = makeDefaultRuleSetForPlayers(players.length);
    const actionResolvedSpy = vi.spyOn(portableRole, "onActionResolved");
    const roleAction = (id: string) => ({
      actionKey: `portable:${id}`,
      actorPlayerId: "2",
      currentActionId: `portable-current:${id}`,
      kind: SYNTHETIC_ACTION_KIND,
      resolverRoleId: portableRole.id,
      submittedAt: "2099-01-01T00:00:01.000Z",
      targetPlayerId: null,
    });
    const cases = [
      {
        actions: [
          {
            actorPlayerId: "1",
            kind: "first_night_ready",
            resolverRoleId: null,
            targetPlayerId: null,
          },
          roleAction("first-night"),
        ],
        currentPhase: "night" as const,
        dayNumber: 0,
        expectedNextPhase: "day",
        nightNumber: 1,
      },
      {
        actions: [
          {
            actorPlayerId: "1",
            kind: "day_ready",
            resolverRoleId: null,
            targetPlayerId: null,
          },
          roleAction("day"),
        ],
        currentPhase: "day" as const,
        dayNumber: 1,
        expectedNextPhase: "voting",
        nightNumber: 1,
      },
      {
        actions: [
          { actorPlayerId: "1", kind: "vote", resolverRoleId: null, targetPlayerId: "3" },
          { actorPlayerId: "4", kind: "vote", resolverRoleId: null, targetPlayerId: "3" },
          roleAction("voting"),
        ],
        currentPhase: "voting" as const,
        dayNumber: 1,
        expectedNextPhase: "execution",
        nightNumber: 1,
      },
      {
        actions: [
          {
            actorPlayerId: "4",
            kind: "execution_skip",
            resolverRoleId: null,
            targetPlayerId: null,
          },
          roleAction("execution"),
        ],
        currentPhase: "execution" as const,
        dayNumber: 1,
        expectedNextPhase: "night",
        nightNumber: 1,
      },
    ];

    for (const testCase of cases) {
      const resolution = resolvePhase({
        actions: testCase.actions,
        currentPhase: testCase.currentPhase,
        dayNumber: testCase.dayNumber,
        nightNumber: testCase.nightNumber,
        players,
        resolvedRoleSetup,
        roles,
        ruleSet,
      });

      expect(resolution.nextPhase).toBe(testCase.expectedNextPhase);
      expect(resolution.events.map((event) => event.kind)).toContain(PORTABLE_EVENT_KIND);
    }

    expect(actionResolvedSpy).toHaveBeenCalledTimes(cases.length);
    expect(actionResolvedSpy.mock.calls.map(([context]) => context.state.phase)).toEqual([
      "night",
      "day",
      "voting",
      "execution",
    ]);
  });

  it("settles a role-owned follow-up before crossing a core phase boundary", () => {
    const portableRole = new PortableWindowRole();
    const roles = new RoleRegistry([...roleRegistry.getAll(), portableRole]);
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: portableRole.id },
      { alive: true, playerId: "3", roleId: "villager" },
      { alive: true, playerId: "4", roleId: "seer" },
    ];
    const resolvedRoleSetup = createResolvedRoleSetup(players);
    const ruleSet = makeDefaultRuleSetForPlayers(players.length);
    const voting = resolvePhase({
      actions: [
        { actorPlayerId: "1", kind: "vote", resolverRoleId: null, targetPlayerId: "3" },
        { actorPlayerId: "4", kind: "vote", resolverRoleId: null, targetPlayerId: "3" },
        {
          actionKey: "portable:trigger",
          actorPlayerId: "2",
          currentActionId: "portable-current:trigger",
          kind: PORTABLE_TRIGGER_ACTION_KIND,
          resolverRoleId: portableRole.id,
          submittedAt: "2099-01-01T00:00:01.000Z",
          targetPlayerId: null,
        },
      ],
      currentPhase: "voting",
      dayNumber: 1,
      nightNumber: 1,
      players,
      resolvedRoleSetup,
      roles,
      ruleSet,
    });

    expect(voting.nextPhase).toBe("voting");
    expect(voting.events.map((event) => event.kind)).not.toContain("vote_resolved");
    expect(voting.actionsToOpen).toEqual([
      expect.objectContaining({
        kind: PORTABLE_FOLLOW_UP_ACTION_KIND,
        resolverRoleId: portableRole.id,
      }),
    ]);

    const currentActions = voting.actionsToOpen.map(toCurrentAction);
    const execution = resolvePhase({
      actions: currentActions.map((action) => ({
        actorPlayerId: action.actorPlayerId ?? "",
        actionKey: action.key,
        currentActionId: action.id,
        kind: action.kind,
        resolverRoleId: portableRole.id,
        submittedAt: "2099-01-01T00:00:02.000Z",
        targetPlayerId: null,
      })),
      currentActions,
      currentPhase: "voting",
      dayNumber: 1,
      nightNumber: 1,
      players,
      resolvedActionHistory: [
        {
          actionKey: "vote:1:1",
          actionKind: "vote",
          actorPlayerId: "1",
          actorRoleId: null,
          dayNumber: 1,
          eventId: "1",
          nightNumber: 1,
          phase: "voting",
          phaseInstanceId: "vote-window-1",
          resolutionStatus: "submitted",
          resolverRoleId: null,
          targetPlayerIds: ["3"],
        },
        {
          actionKey: "vote:1:4",
          actionKind: "vote",
          actorPlayerId: "4",
          actorRoleId: null,
          dayNumber: 1,
          eventId: "2",
          nightNumber: 1,
          phase: "voting",
          phaseInstanceId: "vote-window-1",
          resolutionStatus: "submitted",
          resolverRoleId: null,
          targetPlayerIds: ["3"],
        },
      ],
      resolvedRoleSetup,
      roles,
      ruleSet,
    });

    expect(execution.nextPhase).toBe("execution");
    expect(execution.actionsToOpen).toContainEqual(
      expect.objectContaining({ actorPlayerId: "3", kind: "execution_skip" }),
    );
    expect(execution.events.map((event) => event.kind)).toContain(PORTABLE_FOLLOW_UP_EVENT_KIND);
  });

  it("keeps resolver-owned role-group actions distinct when their opaque kinds collide", () => {
    const firstRole = new SharedGroupActionRole("shared_group_first");
    const secondRole = new SharedGroupActionRole("shared_group_second");
    const roles = new RoleRegistry([...roleRegistry.getAll(), firstRole, secondRole]);
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: firstRole.id },
      { alive: true, playerId: "3", roleId: secondRole.id },
      { alive: true, playerId: "4", roleId: "villager" },
    ];
    const ruleSet = makeDefaultRuleSetForPlayers(players.length);
    const actions = getAvailableNightActions(
      players,
      2,
      ruleSet,
      createResolvedRoleSetup(players),
      [],
      roles,
    ).filter((action) => action.kind === SHARED_GROUP_ACTION_KIND);

    expect(actions).toHaveLength(2);
    expect(new Set(actions.map((action) => action.key)).size).toBe(2);
    expect(actions.map((action) => action.resolverRoleId)).toEqual([firstRole.id, secondRole.id]);
  });

  it("keeps one resolver's group declarations distinct across owner roles", () => {
    const routedRole = new OwnerRoutedGroupActionRole();
    const roles = new RoleRegistry([...roleRegistry.getAll(), routedRole]);
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: routedRole.id },
      { alive: true, playerId: "3", roleId: routedRole.id },
      { alive: true, playerId: "4", roleId: "villager" },
    ];
    const actions = getAvailableNightActions(
      players,
      1,
      makeDefaultRuleSetForPlayers(players.length),
      createResolvedRoleSetup(players),
      [],
      roles,
    ).filter((action) => action.resolverRoleId === routedRole.id);

    expect(actions).toHaveLength(2);
    expect(
      actions
        .map((action) => action.actorRoleId)
        .toSorted((left, right) => String(left).localeCompare(String(right))),
    ).toEqual(["villager", "werewolf"]);
    expect(new Set(actions.map((action) => action.key)).size).toBe(2);
  });

  it("does not materialize a role-group declaration without an eligible owner", () => {
    const routedRole = new OwnerRoutedGroupActionRole();
    const roles = new RoleRegistry([...roleRegistry.getAll(), routedRole]);
    const players: PlayerRuntimeState[] = [{ alive: true, playerId: "2", roleId: routedRole.id }];

    expect(
      getAvailableNightActions(
        players,
        1,
        makeDefaultRuleSetForPlayers(3),
        createResolvedRoleSetup(players),
        [],
        roles,
      ),
    ).toEqual([]);
  });

  it("rejects declared targets outside the current game state", () => {
    const declaringRole = new PhaseDeclarationRole("invalid_target_declaration");
    const roles = new RoleRegistry([...roleRegistry.getAll(), declaringRole]);
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: declaringRole.id },
    ];

    vi.spyOn(declaringRole, "getEligibleTargets").mockReturnValue(["unknown-player"]);

    expect(() =>
      getAvailableNightActions(
        players,
        1,
        makeDefaultRuleSetForPlayers(3),
        createResolvedRoleSetup(players),
        [],
        roles,
      ),
    ).toThrow("Role invalid_target_declaration returned invalid eligible targets.");
  });

  it("dispatches the same opaque action kind to two resolver roles without common branches", () => {
    const executedRole = new ExecutedEchoRole();
    const witnessRole = new WitnessEchoRole();
    const roles = new RoleRegistry([...roleRegistry.getAll(), executedRole, witnessRole]);
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: executedRole.id },
      { alive: true, playerId: "3", roleId: witnessRole.id },
      { alive: true, playerId: "4", roleId: "villager" },
      { alive: true, playerId: "5", roleId: "seer" },
      { alive: true, playerId: "6", roleId: "guard" },
    ];
    const resolvedRoleSetup = createResolvedRoleSetup(players);
    const ruleSet = makeDefaultRuleSetForPlayers(players.length);
    const execution = resolvePhase({
      actions: [
        {
          actorPlayerId: "2",
          kind: "execution_skip",
          resolverRoleId: null,
          targetPlayerId: null,
        },
      ],
      currentPhase: "execution",
      dayNumber: 1,
      nightNumber: 1,
      players,
      resolvedRoleSetup,
      roles,
      ruleSet,
    });

    expect(roles.version).not.toBe(roleRegistry.version);
    expect(execution.deaths).toEqual([{ playerId: "2", reason: "execution" }]);
    expect(execution.actionsToOpen).toHaveLength(2);
    expect(execution.actionsToOpen).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorPlayerId: "2",
          actorStateRequirement: ActionActorStateRequirement.Assigned,
          kind: SYNTHETIC_ACTION_KIND,
          resolverRoleId: executedRole.id,
        }),
        expect.objectContaining({
          actorPlayerId: "3",
          kind: SYNTHETIC_ACTION_KIND,
          resolverRoleId: witnessRole.id,
        }),
      ]),
    );

    const currentActions = execution.actionsToOpen.map(toCurrentAction);
    const followUp = resolvePhase({
      actions: currentActions.map((action) => ({
        actorPlayerId: action.actorPlayerId ?? "",
        actionKey: action.key,
        currentActionId: action.id,
        kind: action.kind,
        resolverRoleId: action.resolverRoleId,
        submittedAt: "2099-01-01T00:00:01.000Z",
        targetPlayerId: action.resolverRoleId === executedRole.id ? "4" : "5",
      })),
      currentActions,
      currentPhase: "execution",
      dayNumber: 1,
      nightNumber: 1,
      players: players.map((player) =>
        player.playerId === "2" ? { ...player, alive: false } : player,
      ),
      resolvedRoleSetup,
      roles,
      ruleSet,
    });

    expect(followUp.deaths).toEqual([
      { playerId: "4", reason: "rule_effect" },
      { playerId: "5", reason: "rule_effect" },
    ]);
  });

  it("dispatches every missing opaque action to its resolver role", () => {
    const executedRole = new ExecutedEchoRole();
    const witnessRole = new WitnessEchoRole();
    const roles = new RoleRegistry([...roleRegistry.getAll(), executedRole, witnessRole]);
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: false, playerId: "2", roleId: executedRole.id },
      { alive: true, playerId: "3", roleId: witnessRole.id },
      { alive: true, playerId: "4", roleId: "villager" },
    ];
    const currentActions = [
      createSyntheticEngineAction("2", executedRole.id, "action-executed"),
      createSyntheticEngineAction("3", witnessRole.id, "action-witness"),
    ].map(toCurrentAction);
    const executedMissingSpy = vi.spyOn(executedRole, "onMissingAction");
    const witnessMissingSpy = vi.spyOn(witnessRole, "onMissingAction");

    resolvePhase({
      actions: [],
      currentActions,
      currentPhase: "execution",
      dayNumber: 1,
      nightNumber: 1,
      players,
      resolvedRoleSetup: createResolvedRoleSetup(players),
      roles,
      ruleSet: makeDefaultRuleSetForPlayers(players.length),
    });

    expect(executedMissingSpy).toHaveBeenCalledOnce();
    expect(witnessMissingSpy).toHaveBeenCalledOnce();
    expect(executedMissingSpy.mock.calls[0]?.[0]).toMatchObject({
      actorStateRequirement: ActionActorStateRequirement.Assigned,
      eligibleTargetPlayerIds: ["4"],
      targetStateRequirement: ActionTargetStateRequirement.Alive,
    });
    expect(witnessMissingSpy.mock.calls[0]?.[0]).toMatchObject({
      actorStateRequirement: ActionActorStateRequirement.Alive,
      eligibleTargetPlayerIds: ["4"],
      targetStateRequirement: ActionTargetStateRequirement.Alive,
    });
  });

  it("rejects malformed role-emitted contracts before persistence", () => {
    const portableRole = new PortableWindowRole();
    const roles = new RoleRegistry([...roleRegistry.getAll(), portableRole]);
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: portableRole.id },
      { alive: true, playerId: "3", roleId: "villager" },
    ];

    vi.spyOn(portableRole, "onActionResolved").mockReturnValue([
      {
        emitterRoleId: portableRole.id,
        eventKind: "Invalid Event Kind",
        id: "invalid-event-contract",
        kind: GameEffectKind.PublicMessage,
        layer: GameEffectLayer.Message,
        presentation: {
          details: [],
          message: { en: "Invalid", ja: "Invalid" },
          title: { en: "Invalid", ja: "Invalid" },
        },
        priority: 100,
        sourceActionId: null,
        tags: [],
      },
    ]);

    expect(() =>
      resolvePhase({
        actions: [
          {
            actionKey: "portable:invalid-contract",
            actorPlayerId: "2",
            currentActionId: "portable-current:invalid-contract",
            kind: SYNTHETIC_ACTION_KIND,
            resolverRoleId: portableRole.id,
            submittedAt: "2099-01-01T00:00:01.000Z",
            targetPlayerId: null,
          },
        ],
        currentPhase: "day",
        dayNumber: 1,
        nightNumber: 1,
        players,
        resolvedRoleSetup: createResolvedRoleSetup(players),
        roles,
        ruleSet: makeDefaultRuleSetForPlayers(players.length),
      }),
    ).toThrow("Invalid public message effect");
  });

  it("rejects role-emitted current actions that are absent from the resolver manifest", () => {
    const portableRole = new PortableWindowRole();
    const roles = new RoleRegistry([...roleRegistry.getAll(), portableRole]);
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: portableRole.id },
      { alive: true, playerId: "3", roleId: "villager" },
    ];

    vi.spyOn(portableRole, "onActionResolved").mockReturnValue([
      {
        actionKey: "undeclared-follow-up:2",
        actionKind: "undeclared_follow_up",
        actorPlayerId: "2",
        actorRoleId: null,
        actorStateRequirement: ActionActorStateRequirement.Alive,
        eligibleTargetPlayerIds: [],
        emitterRoleId: portableRole.id,
        id: "undeclared-follow-up:2",
        kind: GameEffectKind.CurrentAction,
        layer: GameEffectLayer.Action,
        priority: 200,
        resolverRoleId: portableRole.id,
        sourceActionId: null,
        tags: [],
        target: RoleTargetKind.None,
        targetStateRequirement: ActionTargetStateRequirement.Assigned,
      },
    ]);

    expect(() =>
      resolvePhase({
        actions: [
          {
            actionKey: "portable:undeclared-follow-up",
            actorPlayerId: "2",
            currentActionId: "portable-current:undeclared-follow-up",
            kind: SYNTHETIC_ACTION_KIND,
            resolverRoleId: portableRole.id,
            submittedAt: "2099-01-01T00:00:01.000Z",
            targetPlayerId: null,
          },
        ],
        currentPhase: "day",
        dayNumber: 1,
        nightNumber: 1,
        players,
        resolvedRoleSetup: createResolvedRoleSetup(players),
        roles,
        ruleSet: makeDefaultRuleSetForPlayers(players.length),
      }),
    ).toThrow("Role portable_window does not define action: undeclared_follow_up");
  });

  it("runs generic death-resolved hooks until a causal effect chain settles", () => {
    const cascadingRole = new CascadingDeathRole();
    const roles = new RoleRegistry([...roleRegistry.getAll(), cascadingRole]);
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: cascadingRole.id },
      { alive: true, playerId: "3", roleId: "villager" },
      { alive: true, playerId: "4", roleId: "seer" },
      { alive: true, playerId: "5", roleId: "guard" },
    ];

    const resolution = resolvePhase({
      actions: [
        {
          actionKey: "cascade:day:1",
          actorPlayerId: "2",
          currentActionId: "cascade-current:day:1",
          kind: CASCADE_ACTION_KIND,
          resolverRoleId: cascadingRole.id,
          submittedAt: "2099-01-01T00:00:01.000Z",
          targetPlayerId: "3",
        },
      ],
      currentPhase: "day",
      dayNumber: 1,
      nightNumber: 1,
      players,
      resolvedRoleSetup: createResolvedRoleSetup(players),
      roles,
      ruleSet: makeDefaultRuleSetForPlayers(players.length),
    });

    expect(resolution.deaths).toEqual([
      { playerId: "3", reason: "rule_effect" },
      { playerId: "4", reason: "rule_effect" },
    ]);
    expect(resolution.events.map((event) => event.kind)).toContain(CASCADE_SETTLED_EVENT_KIND);
  });

  it("drops an alive-only follow-up whose actor dies in the same effect window", () => {
    const cascadingRole = new CascadingDeathRole();
    const roles = new RoleRegistry([...roleRegistry.getAll(), cascadingRole]);
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: cascadingRole.id },
      { alive: true, playerId: "3", roleId: "villager" },
      { alive: true, playerId: "4", roleId: "seer" },
      { alive: true, playerId: "5", roleId: "villager" },
    ];

    const resolution = resolvePhase({
      actions: [
        {
          actionKey: "doomed:day:1",
          actorPlayerId: "2",
          currentActionId: "doomed-current:day:1",
          kind: DOOMED_FOLLOW_UP_ACTION_KIND,
          resolverRoleId: cascadingRole.id,
          submittedAt: "2099-01-01T00:00:01.000Z",
          targetPlayerId: null,
        },
      ],
      currentPhase: "day",
      dayNumber: 1,
      nightNumber: 1,
      players,
      resolvedRoleSetup: createResolvedRoleSetup(players),
      roles,
      ruleSet: makeDefaultRuleSetForPlayers(players.length),
    });

    expect(resolution.deaths).toContainEqual({ playerId: "2", reason: "rule_effect" });
    expect(resolution.actionsToOpen.some((action) => action.key === "doomed-follow-up:2")).toBe(
      false,
    );
  });

  it("drops an alive-target follow-up whose only target dies in the same effect window", () => {
    const cascadingRole = new CascadingDeathRole();
    const roles = new RoleRegistry([...roleRegistry.getAll(), cascadingRole]);
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: cascadingRole.id },
      { alive: true, playerId: "3", roleId: "villager" },
      { alive: true, playerId: "4", roleId: "seer" },
      { alive: true, playerId: "5", roleId: "villager" },
    ];

    const resolution = resolvePhase({
      actions: [
        {
          actionKey: "doomed-target:day:1",
          actorPlayerId: "2",
          currentActionId: "doomed-target-current:day:1",
          kind: DOOMED_TARGET_ACTION_KIND,
          resolverRoleId: cascadingRole.id,
          submittedAt: "2099-01-01T00:00:01.000Z",
          targetPlayerId: null,
        },
      ],
      currentPhase: "day",
      dayNumber: 1,
      nightNumber: 1,
      players,
      resolvedRoleSetup: createResolvedRoleSetup(players),
      roles,
      ruleSet: makeDefaultRuleSetForPlayers(players.length),
    });

    expect(resolution.deaths).toContainEqual({ playerId: "3", reason: "rule_effect" });
    expect(
      resolution.actionsToOpen.some((action) => action.key === "doomed-target-follow-up:2"),
    ).toBe(false);
  });

  it("never opens execution for a vote target killed by a generic voting action", () => {
    const cascadingRole = new CascadingDeathRole();
    const roles = new RoleRegistry([...roleRegistry.getAll(), cascadingRole]);
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: cascadingRole.id },
      { alive: true, playerId: "3", roleId: "villager" },
      { alive: true, playerId: "4", roleId: "seer" },
      { alive: true, playerId: "5", roleId: "guard" },
    ];

    const resolution = resolvePhase({
      actions: [
        { actorPlayerId: "1", kind: "vote", resolverRoleId: null, targetPlayerId: "3" },
        { actorPlayerId: "2", kind: "vote", resolverRoleId: null, targetPlayerId: "3" },
        { actorPlayerId: "5", kind: "vote", resolverRoleId: null, targetPlayerId: "3" },
        { actorPlayerId: "4", kind: "vote", resolverRoleId: null, targetPlayerId: "5" },
        {
          actionKey: "cascade:voting:1",
          actorPlayerId: "2",
          currentActionId: "cascade-current:voting:1",
          kind: CASCADE_ACTION_KIND,
          resolverRoleId: cascadingRole.id,
          submittedAt: "2099-01-01T00:00:01.000Z",
          targetPlayerId: "3",
        },
      ],
      currentPhase: "voting",
      dayNumber: 1,
      nightNumber: 1,
      players,
      resolvedRoleSetup: createResolvedRoleSetup(players),
      roles,
      ruleSet: makeDefaultRuleSetForPlayers(players.length),
    });

    expect(resolution.nextPhase).toBe("execution");
    expect(
      resolution.actionsToOpen.find((action) => action.kind === "execution_skip")?.actorPlayerId,
    ).toBe("5");
  });
});

describe("winner judgement extension contract", () => {
  it("evaluates end conditions against the phase that just resolved", () => {
    const observerRole = new OutcomeContextObserverRole();
    const roles = new RoleRegistry([...roleRegistry.getAll(), observerRole]);
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: observerRole.id },
      { alive: true, playerId: "3", roleId: "seer" },
      { alive: true, playerId: "4", roleId: "villager" },
    ];
    const executionAction = toCurrentAction({
      actorPlayerId: "4",
      actorRoleId: null,
      actorStateRequirement: ActionActorStateRequirement.Alive,
      eligibleTargetPlayerIds: [],
      key: "execution-skip:1:4",
      kind: "execution_skip",
      resolverRoleId: null,
      targetStateRequirement: ActionTargetStateRequirement.Assigned,
      targetKind: "none",
    });

    resolvePhase({
      actions: [
        {
          actionKey: executionAction.key,
          actorPlayerId: "4",
          currentActionId: executionAction.id,
          kind: executionAction.kind,
          resolverRoleId: null,
          submittedAt: "2099-01-01T00:00:01.000Z",
          targetPlayerId: null,
        },
      ],
      currentActions: [executionAction],
      currentPhase: "execution",
      dayNumber: 1,
      nightNumber: 1,
      players,
      resolvedRoleSetup: createResolvedRoleSetup(players),
      roles,
      ruleSet: makeDefaultRuleSetForPlayers(players.length),
    });

    expect(observerRole.observedEndConditionStates).toEqual([
      {
        currentActionKinds: ["execution_skip"],
        nightNumber: 1,
        pendingActionKinds: ["execution_skip"],
        phase: GamePhase.Execution,
        resolvedActionKinds: [],
      },
    ]);
  });

  it("isolates opaque action state by resolver role while preserving core actions", () => {
    const firstRole = new OutcomeContextObserverRole("first_context_observer");
    const secondRole = new OutcomeContextObserverRole("second_context_observer");
    const roles = new RoleRegistry([...roleRegistry.getAll(), firstRole, secondRole]);
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: firstRole.id },
      { alive: true, playerId: "3", roleId: secondRole.id },
      { alive: true, playerId: "4", roleId: "villager" },
      { alive: true, playerId: "5", roleId: "seer" },
    ];
    const executionAction = toCurrentAction({
      actorPlayerId: "4",
      actorRoleId: null,
      actorStateRequirement: ActionActorStateRequirement.Alive,
      eligibleTargetPlayerIds: [],
      key: "execution-skip:1:4",
      kind: "execution_skip",
      resolverRoleId: null,
      targetStateRequirement: ActionTargetStateRequirement.Assigned,
      targetKind: "none",
    });

    resolvePhase({
      actions: [
        {
          actionKey: executionAction.key,
          actorPlayerId: "4",
          currentActionId: executionAction.id,
          kind: executionAction.kind,
          resolverRoleId: null,
          submittedAt: "2099-01-01T00:00:01.000Z",
          targetPlayerId: null,
        },
      ],
      currentActions: [executionAction],
      currentPhase: "execution",
      dayNumber: 1,
      nightNumber: 1,
      players,
      resolvedActionHistory: [
        {
          actionKey: "role:first:night:1",
          actionKind: "first_private_action",
          actorPlayerId: "2",
          actorRoleId: firstRole.id,
          dayNumber: 0,
          eventId: "1",
          nightNumber: 1,
          phase: "night",
          phaseInstanceId: "first-night-window",
          resolutionStatus: "submitted",
          resolverRoleId: firstRole.id,
          targetPlayerIds: ["5"],
        },
        {
          actionKey: "role:second:night:1",
          actionKind: "second_private_action",
          actorPlayerId: "3",
          actorRoleId: secondRole.id,
          dayNumber: 0,
          eventId: "2",
          nightNumber: 1,
          phase: "night",
          phaseInstanceId: "first-night-window",
          resolutionStatus: "submitted",
          resolverRoleId: secondRole.id,
          targetPlayerIds: ["5"],
        },
        {
          actionKey: "first-night-ready:1:5",
          actionKind: "first_night_ready",
          actorPlayerId: "5",
          actorRoleId: null,
          dayNumber: 0,
          eventId: "3",
          nightNumber: 1,
          phase: "night",
          phaseInstanceId: "first-night-window",
          resolutionStatus: "submitted",
          resolverRoleId: null,
          targetPlayerIds: [],
        },
      ],
      resolvedRoleSetup: createResolvedRoleSetup(players),
      roles,
      ruleSet: makeDefaultRuleSetForPlayers(players.length),
    });

    expect(firstRole.observedEndConditionStates).toEqual([
      {
        currentActionKinds: ["execution_skip"],
        nightNumber: 1,
        pendingActionKinds: ["execution_skip"],
        phase: GamePhase.Execution,
        resolvedActionKinds: ["first_private_action"],
      },
    ]);
    expect(secondRole.observedEndConditionStates).toEqual([
      {
        currentActionKinds: ["execution_skip"],
        nightNumber: 1,
        pendingActionKinds: ["execution_skip"],
        phase: GamePhase.Execution,
        resolvedActionKinds: ["second_private_action"],
      },
    ]);
  });

  it("scopes colliding end reasons to the role that produced each candidate", () => {
    const candidateOwnerRole = new CandidateOwnerRole();
    const collidingJudgementRole = new CollidingJudgementRole();
    const roles = new RoleRegistry([
      ...roleRegistry.getAll(),
      candidateOwnerRole,
      collidingJudgementRole,
    ]);
    const players: PlayerRuntimeState[] = [
      { alive: true, playerId: "1", roleId: "werewolf" },
      { alive: true, playerId: "2", roleId: candidateOwnerRole.id },
      { alive: true, playerId: "3", roleId: collidingJudgementRole.id },
      { alive: true, playerId: "4", roleId: "villager" },
    ];
    const resolvedRoleSetup = createResolvedRoleSetup(players, [
      createWinnerJudgementContribution(
        collidingJudgementRole.id,
        COLLIDING_JUDGEMENT,
        10,
        FOX_TEAM.id,
      ),
      createWinnerJudgementContribution(
        candidateOwnerRole.id,
        CANDIDATE_OWNER_JUDGEMENT,
        20,
        FUTURE_TEAM.id,
      ),
    ]);
    const candidateOwnerSpy = vi.spyOn(candidateOwnerRole, "evaluateWinnerJudgement");
    const collidingJudgementSpy = vi.spyOn(collidingJudgementRole, "evaluateWinnerJudgement");

    const resolution = resolvePhase({
      actions: [
        {
          actorPlayerId: "4",
          kind: "execution_skip",
          resolverRoleId: null,
          targetPlayerId: null,
        },
      ],
      currentPhase: "execution",
      dayNumber: 1,
      nightNumber: 1,
      players,
      resolvedRoleSetup,
      roles,
      ruleSet: makeDefaultRuleSetForPlayers(players.length),
    });

    expect(resolution.finalOutcome?.winnerTeam).toBe(FUTURE_TEAM.id);
    expect(collidingJudgementSpy.mock.calls[0]?.[1].ownEndCandidates).toEqual([]);
    expect(candidateOwnerSpy.mock.calls[0]?.[1].ownEndCandidates).toEqual([
      {
        reason: SHARED_END_REASON,
        sourceRoleId: candidateOwnerRole.id,
      },
    ]);
  });
});

const PORTABLE_EVENT_KIND = "portable_action_resolved";
const PORTABLE_TRIGGER_ACTION_KIND = "portable_trigger";
const PORTABLE_FOLLOW_UP_ACTION_KIND = "portable_follow_up";
const PORTABLE_FOLLOW_UP_EVENT_KIND = "portable_follow_up_resolved";
const SHARED_GROUP_ACTION_KIND = "shared_group_action";
const DECLARED_PHASE_ACTION_KIND = "declared_phase_action";
const CASCADE_ACTION_KIND = "cascade_action";
const CASCADE_SETTLED_EVENT_KIND = "cascade_settled";
const DOOMED_FOLLOW_UP_ACTION_KIND = "doomed_follow_up";
const DOOMED_TARGET_ACTION_KIND = "doomed_target";
const DECLARED_PHASE_FOLLOW_UP_ACTION_KIND = "declared_phase_follow_up";

const DECLARED_PHASE_ACTION_DEFINITION = createTargetlessActionDefinition(
  DECLARED_PHASE_ACTION_KIND,
  ActionTargetStateRequirement.Assigned,
);
const DECLARED_PHASE_FOLLOW_UP_ACTION_DEFINITION = createTargetlessActionDefinition(
  DECLARED_PHASE_FOLLOW_UP_ACTION_KIND,
  ActionTargetStateRequirement.Assigned,
);
const SHARED_GROUP_ACTION_DEFINITION = createTargetlessActionDefinition(
  SHARED_GROUP_ACTION_KIND,
  ActionTargetStateRequirement.Assigned,
);
const PORTABLE_TRIGGER_ACTION_DEFINITION = createTargetlessActionDefinition(
  PORTABLE_TRIGGER_ACTION_KIND,
  ActionTargetStateRequirement.Assigned,
);
const PORTABLE_FOLLOW_UP_ACTION_DEFINITION = createTargetlessActionDefinition(
  PORTABLE_FOLLOW_UP_ACTION_KIND,
  ActionTargetStateRequirement.Assigned,
);
const CASCADE_ACTION_DEFINITION = createSinglePlayerActionDefinition(CASCADE_ACTION_KIND);
const DOOMED_FOLLOW_UP_ACTION_DEFINITION = createTargetlessActionDefinition(
  DOOMED_FOLLOW_UP_ACTION_KIND,
  ActionTargetStateRequirement.Assigned,
);
const DOOMED_TARGET_ACTION_DEFINITION =
  createSinglePlayerActionDefinition(DOOMED_TARGET_ACTION_KIND);
const SYNTHETIC_ACTION_DEFINITION = {
  kind: SYNTHETIC_ACTION_KIND,
  presentation: {
    en: {
      label: "Choose an echo target",
      submitLabel: "Echo",
      submittedMessage: "Echo submitted.",
      targetConfirmation: {
        afterTarget: " as the echo target?",
        beforeTarget: "Choose ",
      },
    },
    ja: {
      label: "反響の対象を選ぶ",
      submitLabel: "反響する",
      submittedMessage: "反響済みです",
      targetConfirmation: {
        afterTarget: "を反響の対象にしますか？",
        beforeTarget: "",
      },
    },
  },
  target: RoleTargetKind.SinglePlayer,
  targetStateRequirement: ActionTargetStateRequirement.Alive,
} as const satisfies RoleActionDefinition;

function createTargetlessActionDefinition(
  kind: string,
  targetStateRequirement: ActionTargetStateRequirement,
): Extract<RoleActionDefinition, { target: RoleTargetKind.None }> {
  return {
    kind,
    presentation: {
      en: {
        label: `Submit ${kind}`,
        submitLabel: "Submit",
        submittedMessage: "Submitted.",
      },
      ja: {
        label: `${kind}を送信する`,
        submitLabel: "送信",
        submittedMessage: "送信済みです",
      },
    },
    target: RoleTargetKind.None,
    targetStateRequirement,
  };
}

function createSinglePlayerActionDefinition(
  kind: string,
): Extract<RoleActionDefinition, { target: RoleTargetKind.SinglePlayer }> {
  return {
    kind,
    presentation: {
      en: {
        label: `Choose a target for ${kind}`,
        submitLabel: "Submit",
        submittedMessage: "Submitted.",
        targetConfirmation: {
          afterTarget: "?",
          beforeTarget: "Choose ",
        },
      },
      ja: {
        label: `${kind}の対象を選ぶ`,
        submitLabel: "送信",
        submittedMessage: "送信済みです",
        targetConfirmation: {
          afterTarget: "を対象にしますか？",
          beforeTarget: "",
        },
      },
    },
    target: RoleTargetKind.SinglePlayer,
    targetStateRequirement: ActionTargetStateRequirement.Alive,
  };
}

class ActionManifestRole extends Role {
  override readonly actionDefinitions: readonly RoleActionDefinition[];
  override readonly id: RoleId;
  override readonly presentation = {
    en: {
      description: "Exercises role action manifest validation.",
      name: "Action manifest",
      shortLabel: "A",
    },
    ja: {
      description: "Role action manifest の検証に使用します。",
      name: "Action manifest",
      shortLabel: "A",
    },
  };
  override readonly team = VILLAGE_TEAM;

  constructor(id: RoleId, actionDefinitions: readonly RoleActionDefinition[]) {
    super();
    this.id = id;
    this.actionDefinitions = actionDefinitions;
  }
}

class PhaseDeclarationRole extends Role {
  override readonly actionDefinitions = [
    DECLARED_PHASE_ACTION_DEFINITION,
    DECLARED_PHASE_FOLLOW_UP_ACTION_DEFINITION,
  ];
  override readonly id: RoleId;
  readonly observedPhases: PlayerRoleContext["state"]["phase"][] = [];
  override readonly presentation = {
    en: {
      description: "Declares the same action in every game phase.",
      name: "Phase declaration",
      shortLabel: "D",
    },
    ja: {
      description: "すべてのフェーズで同じアクションを宣言します。",
      name: "Phase declaration",
      shortLabel: "D",
    },
  };
  override readonly team = VILLAGE_TEAM;

  constructor(id: RoleId) {
    super();
    this.id = id;
  }

  override getActions(context: PlayerRoleContext) {
    this.observedPhases.push(context.state.phase);

    return [this.createAvailableAction(DECLARED_PHASE_ACTION_KIND, null)];
  }

  override onActionResolved(context: RoleActionResolvedContext): readonly GameEffect[] {
    if (context.actionKind !== DECLARED_PHASE_ACTION_KIND) {
      return [];
    }

    const actionKey = `phase-follow-up:${this.id}:${context.actorId}`;

    return [
      {
        actionKey,
        actionKind: DECLARED_PHASE_FOLLOW_UP_ACTION_KIND,
        actorPlayerId: context.actorId,
        actorRoleId: null,
        actorStateRequirement: ActionActorStateRequirement.Alive,
        eligibleTargetPlayerIds: [],
        emitterRoleId: this.id,
        id: actionKey,
        kind: GameEffectKind.CurrentAction,
        layer: GameEffectLayer.Action,
        priority: 200,
        resolverRoleId: this.id,
        sourceActionId: null,
        tags: [],
        target: RoleTargetKind.None,
        targetStateRequirement: ActionTargetStateRequirement.Assigned,
      },
    ];
  }
}

class OwnerRoutedGroupActionRole extends Role {
  override readonly actionDefinitions = [SHARED_GROUP_ACTION_DEFINITION];
  override readonly id: RoleId = "owner_routed_group";
  override readonly presentation = {
    en: {
      description: "Routes identical group actions to different owner roles.",
      name: "Owner-routed group",
      shortLabel: "O",
    },
    ja: {
      description: "同じグループアクションを異なる所有役職へ割り当てます。",
      name: "Owner-routed group",
      shortLabel: "O",
    },
  };
  override readonly team = VILLAGE_TEAM;

  override getActions(context: PlayerRoleContext) {
    return [
      this.createAvailableAction(
        SHARED_GROUP_ACTION_KIND,
        context.playerId === "2" ? "werewolf" : "villager",
      ),
    ];
  }
}

class CascadingDeathRole extends Role {
  override readonly actionDefinitions = [
    CASCADE_ACTION_DEFINITION,
    DOOMED_FOLLOW_UP_ACTION_DEFINITION,
    DOOMED_TARGET_ACTION_DEFINITION,
  ];
  override readonly id: RoleId = "cascading_death";
  override readonly presentation = {
    en: {
      description: "Exercises causal death hook chains.",
      name: "Cascading death",
      shortLabel: "C",
    },
    ja: {
      description: "因果順に続く死亡 hook を検証します。",
      name: "Cascading death",
      shortLabel: "C",
    },
  };
  override readonly team = VILLAGE_TEAM;

  override onActionResolved(context: RoleActionResolvedContext): readonly GameEffect[] {
    if (context.actionKind === DOOMED_TARGET_ACTION_KIND) {
      return [
        this.createDeathEffect({
          id: "doomed-target-death:3",
          playerId: "3",
          reason: DEATH_REASON.RuleEffect,
          tags: [EFFECT_TAG.Unpreventable],
        }),
        {
          actionKey: `doomed-target-follow-up:${context.actorId}`,
          actionKind: DOOMED_TARGET_ACTION_KIND,
          actorPlayerId: context.actorId,
          actorRoleId: null,
          actorStateRequirement: ActionActorStateRequirement.Alive,
          eligibleTargetPlayerIds: ["3"],
          emitterRoleId: this.id,
          id: `doomed-target-follow-up:${context.actorId}`,
          kind: GameEffectKind.CurrentAction,
          layer: GameEffectLayer.Action,
          priority: 200,
          resolverRoleId: this.id,
          sourceActionId: null,
          tags: [],
          target: RoleTargetKind.SinglePlayer,
          targetStateRequirement: ActionTargetStateRequirement.Alive,
        },
      ];
    }

    if (context.actionKind === DOOMED_FOLLOW_UP_ACTION_KIND) {
      return [
        this.createDeathEffect({
          id: `doomed-death:${context.actorId}`,
          playerId: context.actorId,
          reason: DEATH_REASON.RuleEffect,
          tags: [EFFECT_TAG.Unpreventable],
        }),
        {
          actionKey: `doomed-follow-up:${context.actorId}`,
          actionKind: DOOMED_FOLLOW_UP_ACTION_KIND,
          actorPlayerId: context.actorId,
          actorRoleId: null,
          actorStateRequirement: ActionActorStateRequirement.Alive,
          eligibleTargetPlayerIds: [],
          emitterRoleId: this.id,
          id: `doomed-follow-up:${context.actorId}`,
          kind: GameEffectKind.CurrentAction,
          layer: GameEffectLayer.Action,
          priority: 200,
          resolverRoleId: this.id,
          sourceActionId: null,
          tags: [],
          target: RoleTargetKind.None,
          targetStateRequirement: ActionTargetStateRequirement.Assigned,
        },
      ];
    }

    if (context.actionKind !== CASCADE_ACTION_KIND || context.targetId === null) {
      return [];
    }

    return [
      this.createDeathEffect({
        id: `cascade-death:${context.targetId}`,
        playerId: context.targetId,
        reason: DEATH_REASON.RuleEffect,
        tags: [EFFECT_TAG.Unpreventable],
      }),
    ];
  }

  override onDeathResolved(context: DeathResolvedContext): readonly GameEffect[] {
    if (context.death.playerId === "3") {
      return [
        this.createDeathEffect({
          id: "cascade-death:4",
          playerId: "4",
          reason: DEATH_REASON.RuleEffect,
          tags: [EFFECT_TAG.Unpreventable],
        }),
      ];
    }

    if (context.death.playerId !== "4") {
      return [];
    }

    return [
      {
        emitterRoleId: this.id,
        eventKind: CASCADE_SETTLED_EVENT_KIND,
        id: "cascade-settled:4",
        kind: GameEffectKind.PublicMessage,
        layer: GameEffectLayer.Message,
        presentation: {
          details: [],
          message: { en: "The chain settled.", ja: "連鎖が解決しました。" },
          title: { en: "Chain settled", ja: "連鎖解決" },
        },
        priority: 100,
        sourceActionId: null,
        tags: [],
      },
    ];
  }
}

class PortableWindowRole extends Role {
  override readonly actionDefinitions = [
    PORTABLE_TRIGGER_ACTION_DEFINITION,
    PORTABLE_FOLLOW_UP_ACTION_DEFINITION,
    SYNTHETIC_ACTION_DEFINITION,
  ];
  override readonly id: RoleId = "portable_window";
  override readonly presentation = {
    en: {
      description: "Exercises role actions across core phase boundaries.",
      name: "Portable window",
      shortLabel: "P",
    },
    ja: {
      description: "core phase をまたぐ role action を検証します。",
      name: "Portable window",
      shortLabel: "P",
    },
  };
  override readonly team = VILLAGE_TEAM;

  override onActionResolved(context: RoleActionResolvedContext): readonly GameEffect[] {
    if (context.actionKind === PORTABLE_TRIGGER_ACTION_KIND) {
      return [
        {
          actionKey: `portable-follow-up:${context.actorId}`,
          actionKind: PORTABLE_FOLLOW_UP_ACTION_KIND,
          actorPlayerId: context.actorId,
          actorRoleId: null,
          actorStateRequirement: ActionActorStateRequirement.Alive,
          eligibleTargetPlayerIds: [],
          emitterRoleId: this.id,
          id: `portable-follow-up:${context.actorId}`,
          kind: GameEffectKind.CurrentAction,
          layer: GameEffectLayer.Action,
          priority: 200,
          resolverRoleId: this.id,
          sourceActionId: null,
          tags: [],
          target: RoleTargetKind.None,
          targetStateRequirement: ActionTargetStateRequirement.Assigned,
        },
      ];
    }

    if (
      context.actionKind !== SYNTHETIC_ACTION_KIND &&
      context.actionKind !== PORTABLE_FOLLOW_UP_ACTION_KIND
    ) {
      return [];
    }

    const eventKind =
      context.actionKind === PORTABLE_FOLLOW_UP_ACTION_KIND
        ? PORTABLE_FOLLOW_UP_EVENT_KIND
        : PORTABLE_EVENT_KIND;

    return [
      {
        emitterRoleId: this.id,
        eventKind,
        id: `${eventKind}:${context.actorId}`,
        kind: GameEffectKind.PublicMessage,
        layer: GameEffectLayer.Message,
        presentation: {
          details: [],
          message: { en: "The portable action resolved.", ja: "portable action が解決しました。" },
          title: { en: "Portable action", ja: "Portable action" },
        },
        priority: 100,
        sourceActionId: null,
        tags: [],
      },
    ];
  }
}

class SharedGroupActionRole extends Role {
  override readonly actionDefinitions = [SHARED_GROUP_ACTION_DEFINITION];
  override readonly id: RoleId;
  override readonly presentation = {
    en: {
      description: "Exercises resolver-owned role-group action identity.",
      name: "Shared group action",
      shortLabel: "S",
    },
    ja: {
      description: "resolver 所有の role-group action identity を検証します。",
      name: "Shared group action",
      shortLabel: "S",
    },
  };
  override readonly team = VILLAGE_TEAM;

  constructor(id: RoleId) {
    super();
    this.id = id;
  }

  override getActions(context: PlayerRoleContext) {
    void context;

    return [this.createAvailableAction(SHARED_GROUP_ACTION_KIND, "werewolf")];
  }
}

abstract class SyntheticEchoRole extends Role {
  override readonly actionDefinitions = [SYNTHETIC_ACTION_DEFINITION];
  override readonly presentation = {
    en: {
      description: "Exercises the opaque role action extension contract.",
      name: "Synthetic echo",
      shortLabel: "E",
    },
    ja: {
      description: "opaque role action extension contract を検証します。",
      name: "Synthetic echo",
      shortLabel: "E",
    },
  };
  override readonly team = VILLAGE_TEAM;

  override onActionResolved(context: RoleActionResolvedContext): readonly GameEffect[] {
    if (context.actionKind !== SYNTHETIC_ACTION_KIND || context.targetId === null) {
      return [];
    }

    return [
      this.createDeathEffect({
        id: `synthetic-death:${this.id}:${context.targetId}`,
        playerId: context.targetId,
        reason: DEATH_REASON.RuleEffect,
        tags: [EFFECT_TAG.Unpreventable],
      }),
    ];
  }
}

class ExecutedEchoRole extends SyntheticEchoRole {
  override readonly id: RoleId = "executed_echo";

  override onExecuted(context: ExecutionContext): readonly GameEffect[] {
    return [
      ...super.onExecuted(context),
      createSyntheticAction(context.targetId, this.id, "action-executed"),
    ];
  }
}

class WitnessEchoRole extends SyntheticEchoRole {
  override readonly id: RoleId = "witness_echo";

  override onExecutionResolved(context: ExecutionResolvedContext): readonly GameEffect[] {
    const actorPlayerId = findPlayerIdForRole(context.state.roleByPlayerId, this.id);

    return actorPlayerId === null
      ? []
      : [createSyntheticAction(actorPlayerId, this.id, "action-witness")];
  }
}

const SHARED_END_REASON = "shared_end_reason";
const CANDIDATE_OWNER_JUDGEMENT = "candidate_owner_judgement";
const COLLIDING_JUDGEMENT = "colliding_judgement";

class OutcomeContextObserverRole extends Role {
  override readonly id: RoleId;
  readonly observedEndConditionStates: {
    currentActionKinds: string[];
    nightNumber: number;
    pendingActionKinds: string[];
    phase: GamePhase | null;
    resolvedActionKinds: string[];
  }[] = [];
  override readonly presentation = {
    en: {
      description: "Observes the context used for generic outcome hooks.",
      name: "Outcome context observer",
      shortLabel: "O",
    },
    ja: {
      description: "汎用勝敗 hook に渡る context を検証します。",
      name: "Outcome context observer",
      shortLabel: "O",
    },
  };
  override readonly team = VILLAGE_TEAM;

  constructor(id: RoleId = "outcome_context_observer") {
    super();
    this.id = id;
  }

  override checkEndCondition(context: RoleContext): null {
    this.observedEndConditionStates.push({
      currentActionKinds: context.state.currentActions.map((action) => action.kind),
      nightNumber: context.state.nightNumber,
      pendingActionKinds: context.state.pendingActions.map((action) => action.kind),
      phase: context.state.phase,
      resolvedActionKinds: context.state.resolvedActions.map((action) => action.kind),
    });

    return null;
  }
}

abstract class SyntheticWinnerRole extends Role {
  override readonly presentation = {
    en: {
      description: "Exercises winner judgement ownership.",
      name: "Synthetic winner",
      shortLabel: "W",
    },
    ja: {
      description: "勝敗判定の所有権を検証します。",
      name: "Synthetic winner",
      shortLabel: "W",
    },
  };
}

class CandidateOwnerRole extends SyntheticWinnerRole {
  override readonly id: RoleId = "candidate_owner";
  override readonly team = FUTURE_TEAM;

  override checkEndCondition(context: RoleContext): GameEndCandidate {
    void context;

    return {
      reason: SHARED_END_REASON,
      sourceRoleId: this.id,
    };
  }

  override evaluateWinnerJudgement(
    judgement: WinnerJudgementContribution,
    context: WinnerJudgementContext,
  ): boolean {
    return (
      judgement.id === CANDIDATE_OWNER_JUDGEMENT &&
      context.ownEndCandidates.some((candidate) => candidate.reason === SHARED_END_REASON)
    );
  }
}

class CollidingJudgementRole extends SyntheticWinnerRole {
  override readonly id: RoleId = "colliding_judgement";
  override readonly team = FOX_TEAM;

  override evaluateWinnerJudgement(
    judgement: WinnerJudgementContribution,
    context: WinnerJudgementContext,
  ): boolean {
    return (
      judgement.id === COLLIDING_JUDGEMENT &&
      context.ownEndCandidates.some((candidate) => candidate.reason === SHARED_END_REASON)
    );
  }
}

function createSyntheticAction(
  actorPlayerId: PlayerId,
  resolverRoleId: RoleId,
  actionKey: string,
): Extract<GameEffect, { kind: GameEffectKind.CurrentAction }> {
  return {
    actionKey,
    actionKind: SYNTHETIC_ACTION_KIND,
    actorPlayerId,
    actorRoleId: null,
    actorStateRequirement:
      resolverRoleId === "executed_echo"
        ? ActionActorStateRequirement.Assigned
        : ActionActorStateRequirement.Alive,
    eligibleTargetPlayerIds: ["4", "5"],
    emitterRoleId: resolverRoleId,
    id: actionKey,
    kind: GameEffectKind.CurrentAction,
    layer: GameEffectLayer.Action,
    priority: 200,
    resolverRoleId,
    sourceActionId: null,
    tags: [],
    target: RoleTargetKind.SinglePlayer,
    targetStateRequirement: ActionTargetStateRequirement.Alive,
  };
}

function toCurrentAction(action: EngineAction, index = 0): PhaseCurrentAction {
  return {
    ...action,
    closesAt: "2099-01-01T00:01:00.000Z",
    id: `${index}:${action.key}`,
    openedAt: "2099-01-01T00:00:00.000Z",
  };
}

function createSyntheticEngineAction(
  actorPlayerId: PlayerId,
  resolverRoleId: RoleId,
  key: string,
): EngineAction {
  return {
    actorPlayerId,
    actorRoleId: null,
    actorStateRequirement:
      resolverRoleId === "executed_echo"
        ? ActionActorStateRequirement.Assigned
        : ActionActorStateRequirement.Alive,
    eligibleTargetPlayerIds: ["4"],
    key,
    kind: SYNTHETIC_ACTION_KIND,
    resolverRoleId,
    targetStateRequirement: ActionTargetStateRequirement.Alive,
    targetKind: "single_player",
  };
}

function createResolvedRoleSetup(
  players: readonly PlayerRuntimeState[],
  contributions: ResolvedRoleSetup["contributions"] = [],
): ResolvedRoleSetup {
  return {
    activeRoleIds: [...new Set(players.map((player) => player.roleId))],
    contributions,
    nightConversationGroups: [],
  };
}

function expectDeclaredPhaseActions(
  actions: readonly EngineAction[],
  phase: "day" | "execution" | "night" | "voting",
  ...resolverRoleIds: readonly RoleId[]
): void {
  const declaredActions = actions.filter((action) => action.kind === DECLARED_PHASE_ACTION_KIND);

  expect(declaredActions).toHaveLength(resolverRoleIds.length);
  expect(
    declaredActions
      .map((action) => action.resolverRoleId)
      .toSorted((left, right) => String(left).localeCompare(String(right))),
  ).toEqual(resolverRoleIds.toSorted((left, right) => left.localeCompare(right)));
  expect(new Set(declaredActions.map((action) => action.key)).size).toBe(resolverRoleIds.length);
  expect(declaredActions.every((action) => action.key.includes(`:${phase}:`))).toBe(true);
}

function createWinnerJudgementContribution(
  sourceRoleId: RoleId,
  id: string,
  priority: number,
  winnerTeam: Team,
): ResolvedRoleSetup["contributions"][number] {
  return {
    judgement: {
      id,
      priority,
      sourceRoleId,
      winnerTeam,
    },
    kind: RoleSetupContributionKind.WinnerJudgement,
  };
}

function findPlayerIdForRole(
  roleByPlayerId: ReadonlyMap<PlayerId, RoleId>,
  roleId: RoleId,
): PlayerId | null {
  for (const [playerId, assignedRoleId] of roleByPlayerId) {
    if (assignedRoleId === roleId) {
      return playerId;
    }
  }

  return null;
}
