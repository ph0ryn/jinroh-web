import { expect, test } from "playwright/test";

import { apiFetch, createApiPlayer, createStartedRoom, readJsonResponse } from "./support/api";

import type { PublicAction, RoomSummary } from "@/lib/shared/game";
import type { APIRequestContext } from "playwright/test";

type ApiError = {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
};

type CurrentRoom = {
  readonly room: RoomSnapshot | null;
};

type RoomSnapshot = {
  readonly code: string;
  readonly currentPlayerId: string | null;
  readonly players: readonly {
    readonly displayName: string;
    readonly id: string;
    readonly isCurrent: boolean;
  }[];
  readonly status: string;
};

const MINIMUM_TOUCH_TARGET_SIZE = 44;
const BOUNDING_BOX_PRECISION_TOLERANCE = 0.01;

test("an account keeps one current room until it explicitly leaves", async ({ request }) => {
  const account = await createApiPlayer(request, "account", "Aster");
  const otherHost = await createApiPlayer(request, "otherHost", "Birch");
  const roomA = await createWaitingRoom(request, account.token, account.displayName);
  const roomB = await createWaitingRoom(request, otherHost.token, otherHost.displayName);
  const originalPlayerId = roomA.currentPlayerId;

  expect(originalPlayerId).not.toBeNull();
  await expectCurrentRoom(request, account.token, roomA.code);

  const secondCreate = await readJsonResponse<ApiError>(request, "/api/rooms", {
    body: { displayName: account.displayName, targetPlayerCount: 3 },
    method: "POST",
    token: account.token,
  });
  const otherJoin = await readJsonResponse<ApiError>(request, `/api/rooms/${roomB.code}/join`, {
    body: { displayName: account.displayName },
    method: "POST",
    token: account.token,
  });

  expect(secondCreate.status).toBe(409);
  expect(secondCreate.body.error.code).toBe("current_room_exists");
  expect(otherJoin.status).toBe(409);
  expect(otherJoin.body.error.code).toBe("current_room_exists");
  await expectCurrentRoom(request, account.token, roomA.code);

  const resumedRoom = await apiFetch<RoomSnapshot>(request, `/api/rooms/${roomA.code}/join`, {
    body: { displayName: "Changed name" },
    method: "POST",
    token: account.token,
  });
  const resumedPlayer = resumedRoom.players.find((player) => player.isCurrent);

  expect(resumedRoom.currentPlayerId).toBe(originalPlayerId);
  expect(resumedPlayer).toMatchObject({ displayName: account.displayName, id: originalPlayerId });

  await apiFetch(request, `/api/rooms/${roomA.code}/leave`, {
    method: "POST",
    token: account.token,
  });
  await expectCurrentRoom(request, account.token, null);

  const joinedRoom = await apiFetch<RoomSnapshot>(request, `/api/rooms/${roomB.code}/join`, {
    body: { displayName: account.displayName },
    method: "POST",
    token: account.token,
  });

  expect(joinedRoom.code).toBe(roomB.code);
  await expectCurrentRoom(request, account.token, roomB.code);
});

test("concurrent membership requests produce exactly one current room", async ({ request }) => {
  const targetHostA = await createApiPlayer(request, "targetHostA", "Cedar");
  const targetHostB = await createApiPlayer(request, "targetHostB", "Dahlia");
  const targetA = await createWaitingRoom(request, targetHostA.token, targetHostA.displayName);
  const targetB = await createWaitingRoom(request, targetHostB.token, targetHostB.displayName);

  for (const scenario of ["create-create", "create-join", "join-join"] as const) {
    const account = await createApiPlayer(request, scenario, `Player ${scenario}`);
    const requests = makeConcurrentMembershipRequests(
      request,
      scenario,
      account.token,
      account.displayName,
      targetA.code,
      targetB.code,
    );
    const responses = await Promise.all(requests);
    const successes = responses.filter(({ status }) => status >= 200 && status < 300);
    const conflicts = responses.filter(({ status }) => status === 409);

    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
    const conflict = conflicts[0];
    const success = successes[0];

    if (conflict === undefined || success === undefined) {
      throw new Error("Concurrent membership requests did not produce one result of each kind.");
    }

    expect((conflict.body as ApiError).error.code).toBe("current_room_exists");

    const successfulRoom = success.body as RoomSnapshot;

    await expectCurrentRoom(request, account.token, successfulRoom.code);
  }
});

test("confirmed switching is atomic and preserves the source room on failure", async ({
  request,
}) => {
  const account = await createApiPlayer(request, "switcher", "Elm");
  const targetHost = await createApiPlayer(request, "target", "Fir");
  const source = await createWaitingRoom(request, account.token, account.displayName);
  const target = await createWaitingRoom(request, targetHost.token, targetHost.displayName);

  const failedSwitch = await readJsonResponse<ApiError>(request, "/api/rooms/switch", {
    body: {
      displayName: account.displayName,
      expectedCurrentRoomCode: source.code,
      kind: "join",
      targetRoomCode: "000000",
    },
    method: "POST",
    token: account.token,
  });

  expect(failedSwitch.status).toBe(404);
  expect(failedSwitch.body.error.code).toBe("room_not_found");
  await expectCurrentRoom(request, account.token, source.code);

  const switchedRoom = await apiFetch<RoomSnapshot>(request, "/api/rooms/switch", {
    body: {
      displayName: account.displayName,
      expectedCurrentRoomCode: source.code,
      kind: "join",
      targetRoomCode: target.code,
    },
    method: "POST",
    token: account.token,
  });

  expect(switchedRoom.code).toBe(target.code);
  await expectCurrentRoom(request, account.token, target.code);

  const staleSwitch = await readJsonResponse<ApiError>(request, "/api/rooms/switch", {
    body: {
      displayName: account.displayName,
      expectedCurrentRoomCode: source.code,
      kind: "create",
      targetPlayerCount: 3,
    },
    method: "POST",
    token: account.token,
  });

  expect(staleSwitch.status).toBe(409);
  expect(staleSwitch.body.error.code).toBe("current_room_changed");
  await expectCurrentRoom(request, account.token, target.code);
});

test("a playing room cannot be left through the switch endpoint", async ({ request }) => {
  const { players, roomCode } = await createStartedRoom(request, ["Gale", "Harbor", "Iris"]);
  const host = players[0];

  if (host === undefined) {
    throw new Error("Started room host was not created.");
  }

  const response = await readJsonResponse<ApiError>(request, "/api/rooms/switch", {
    body: {
      displayName: host.displayName,
      expectedCurrentRoomCode: roomCode,
      kind: "create",
      targetPlayerCount: 3,
    },
    method: "POST",
    token: host.token,
  });

  expect(response.status).toBe(409);
  expect(response.body.error.code).toBe("room_switch_forbidden");
  await expectCurrentRoom(request, host.token, roomCode);
});

test("an ended room stays current until explicit leave or confirmed switch", async ({
  request,
}) => {
  const { players, roomCode } = await createStartedRoom(request, ["Lark", "Maple", "Nori"]);
  const roleViews = await Promise.all(
    players.map((player) => readRoom(request, roomCode, player.token)),
  );
  const werewolfView = roleViews.find((summary) => summary.self?.roleId === "werewolf");

  if (werewolfView?.currentPlayerId === null || werewolfView?.currentPlayerId === undefined) {
    throw new Error("The started game did not expose the werewolf to its own account.");
  }

  await submitPlayerActions(request, roomCode, players, () => null);
  await submitPlayerActions(request, roomCode, players, () => null);
  await submitPlayerActions(request, roomCode, players, (summary, action) => {
    if (action.kind !== "vote") {
      return null;
    }

    return summary.currentPlayerId === werewolfView.currentPlayerId
      ? (action.eligibleTargetIds[0] ?? null)
      : werewolfView.currentPlayerId;
  });
  await submitPlayerActions(request, roomCode, players, () => null);

  const host = players[0];

  if (host === undefined) {
    throw new Error("The ended-room host was not created.");
  }

  const endedRoom = await readRoom(request, roomCode, host.token);
  const leaver = players[1];

  expect(endedRoom.status).toBe("ended");
  await expectCurrentRoom(request, host.token, roomCode);

  if (leaver === undefined) {
    throw new Error("The ended-room leave player was not created.");
  }

  await apiFetch(request, `/api/rooms/${roomCode}/leave`, {
    method: "POST",
    token: leaver.token,
  });
  await expectCurrentRoom(request, leaver.token, null);

  const directCreate = await readJsonResponse<ApiError>(request, "/api/rooms", {
    body: { displayName: host.displayName, targetPlayerCount: 3 },
    method: "POST",
    token: host.token,
  });

  expect(directCreate.status).toBe(409);
  expect(directCreate.body.error.code).toBe("current_room_exists");

  const switched = await apiFetch<RoomSnapshot>(request, "/api/rooms/switch", {
    body: {
      displayName: host.displayName,
      expectedCurrentRoomCode: roomCode,
      kind: "create",
      targetPlayerCount: 3,
    },
    method: "POST",
    token: host.token,
  });

  expect(switched.status).toBe("waiting");
  await expectCurrentRoom(request, host.token, switched.code);
});

test("same-account tabs converge after restore, switch, and leave", async ({
  browser,
  request,
}) => {
  const targetHost = await createApiPlayer(request, "browserTargetHost", "Juniper");
  const targetRoom = await createWaitingRoom(request, targetHost.token, targetHost.displayName);
  const context = await browser.newContext({ viewport: { height: 720, width: 1280 } });
  const firstPage = await context.newPage();

  try {
    await firstPage.goto("/live");
    await expect(firstPage.locator('.liveShell[data-live-mood="setup"]')).toBeVisible();
    await firstPage.getByLabel("Display name").fill("Kestrel");
    await firstPage.getByLabel("Players").selectOption("3");
    await firstPage.getByRole("button", { name: "Create room" }).click();

    const firstPageRoomCode = firstPage.locator('[aria-label="Room invite tools"] strong');

    await expect(firstPageRoomCode).toHaveText(/^\d{6}$/u);
    const sourceRoomCode = await firstPageRoomCode.innerText();
    const secondPage = await context.newPage();

    await secondPage.goto("/live");
    await expect(secondPage.locator('[aria-label="Room invite tools"] strong')).toHaveText(
      sourceRoomCode,
    );

    await secondPage.setViewportSize({ height: 844, width: 390 });
    await secondPage.goto(`/live?roomCode=${targetRoom.code}`);

    const switchDialog = secondPage.getByRole("dialog", {
      name: "Leave the current room and switch?",
    });

    await expect(switchDialog).toBeVisible();
    await expect(
      switchDialog.getByRole("button", {
        name: "Close Leave the current room and switch?",
      }),
    ).toBeFocused();
    await expect(switchDialog).toContainText(sourceRoomCode);
    await expect(switchDialog).toContainText(targetRoom.code);

    const confirmSwitchButton = switchDialog.getByRole("button", { name: "Leave and switch" });
    const cancelSwitchButton = switchDialog.getByRole("button", { name: "Cancel" });

    await secondPage.keyboard.press("Shift+Tab");
    await expect(confirmSwitchButton).toBeFocused();
    await secondPage.keyboard.press("Tab");
    await expect(
      switchDialog.getByRole("button", {
        name: "Close Leave the current room and switch?",
      }),
    ).toBeFocused();

    const confirmSwitchBox = await confirmSwitchButton.boundingBox();
    const cancelSwitchBox = await cancelSwitchButton.boundingBox();

    expect(
      (confirmSwitchBox?.height ?? 0) + BOUNDING_BOX_PRECISION_TOLERANCE,
    ).toBeGreaterThanOrEqual(MINIMUM_TOUCH_TARGET_SIZE);
    expect(
      (cancelSwitchBox?.height ?? 0) + BOUNDING_BOX_PRECISION_TOLERANCE,
    ).toBeGreaterThanOrEqual(MINIMUM_TOUCH_TARGET_SIZE);
    expect(confirmSwitchBox?.y).toBeGreaterThan(cancelSwitchBox?.y ?? Number.POSITIVE_INFINITY);

    await secondPage.keyboard.press("Escape");
    await expect(switchDialog).toHaveCount(0);
    await expect(secondPage.locator('[aria-label="Room invite tools"] strong')).toHaveText(
      sourceRoomCode,
    );

    await secondPage.reload();
    await expect(switchDialog).toBeVisible();
    await switchDialog.getByRole("button", { name: "Leave and switch" }).click();

    await expect(secondPage.locator('[aria-label="Room invite tools"] strong')).toHaveText(
      targetRoom.code,
    );
    await expect(firstPage.locator('[aria-label="Room invite tools"] strong')).toHaveText(
      targetRoom.code,
      { timeout: 15_000 },
    );

    await firstPage.getByRole("button", { name: "Leave room", exact: true }).click();
    await firstPage
      .getByRole("dialog", { name: "Leave this room?" })
      .getByRole("button", { name: "Leave room", exact: true })
      .click();

    await expect(firstPage.locator('.liveShell[data-live-mood="setup"]')).toBeVisible();
    await expect(secondPage.locator('.liveShell[data-live-mood="setup"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(secondPage.getByRole("button", { name: "Create room" })).toBeVisible();
  } finally {
    await context.close();
  }
});

async function createWaitingRoom(
  request: Parameters<typeof apiFetch>[0],
  token: string,
  displayName: string,
): Promise<RoomSnapshot> {
  return apiFetch<RoomSnapshot>(request, "/api/rooms", {
    body: { displayName, targetPlayerCount: 3 },
    method: "POST",
    token,
  });
}

async function readRoom(
  request: APIRequestContext,
  roomCode: string,
  token: string,
): Promise<RoomSummary> {
  return apiFetch<RoomSummary>(request, `/api/rooms/${roomCode}`, { token });
}

async function submitPlayerActions(
  request: APIRequestContext,
  roomCode: string,
  players: readonly { readonly token: string }[],
  resolveTarget: (summary: RoomSummary, action: PublicAction) => string | null,
): Promise<void> {
  for (const player of players) {
    const summary = await readRoom(request, roomCode, player.token);

    if (summary.status === "ended") {
      return;
    }

    const action = summary.self?.actions[0];

    if (action === undefined || summary.game === null) {
      continue;
    }

    await apiFetch(request, `/api/rooms/${roomCode}/action`, {
      body: {
        actionKey: action.key,
        phaseInstanceId: action.phaseInstanceId,
        revision: summary.game.revision,
        targetPlayerId: resolveTarget(summary, action),
      },
      method: "POST",
      token: player.token,
    });
  }
}

function makeConcurrentMembershipRequests(
  request: Parameters<typeof readJsonResponse>[0],
  scenario: "create-create" | "create-join" | "join-join",
  token: string,
  displayName: string,
  targetRoomCodeA: string,
  targetRoomCodeB: string,
) {
  if (scenario === "create-create") {
    return [
      createRoomResponse(request, token, displayName),
      createRoomResponse(request, token, displayName),
    ];
  }

  if (scenario === "create-join") {
    return [
      createRoomResponse(request, token, displayName),
      joinRoomResponse(request, targetRoomCodeA, token, displayName),
    ];
  }

  return [
    joinRoomResponse(request, targetRoomCodeA, token, displayName),
    joinRoomResponse(request, targetRoomCodeB, token, displayName),
  ];
}

async function expectCurrentRoom(
  request: Parameters<typeof apiFetch>[0],
  token: string,
  expectedRoomCode: string | null,
): Promise<void> {
  const current = await apiFetch<CurrentRoom>(request, "/api/rooms/current", { token });

  expect(current.room?.code ?? null).toBe(expectedRoomCode);
  expect(JSON.stringify(current)).not.toContain("account_id");
  expect(JSON.stringify(current)).not.toContain("current_room_id");
}

function createRoomResponse(
  request: Parameters<typeof readJsonResponse>[0],
  token: string,
  displayName: string,
) {
  return readJsonResponse<RoomSnapshot | ApiError>(request, "/api/rooms", {
    body: { displayName, targetPlayerCount: 3 },
    method: "POST",
    token,
  });
}

function joinRoomResponse(
  request: Parameters<typeof readJsonResponse>[0],
  roomCode: string,
  token: string,
  displayName: string,
) {
  return readJsonResponse<RoomSnapshot | ApiError>(request, `/api/rooms/${roomCode}/join`, {
    body: { displayName },
    method: "POST",
    token,
  });
}
