import { createWaitingRoom, requirePlayer } from "../fixtures/roomScenario";
import { expect, test } from "../fixtures/test";

type PhoenixFrame = {
  event: string;
  payload: Record<string, unknown>;
  ref: string;
  topic: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parsePhoenixFrame(payload: string): PhoenixFrame | null {
  const parsed = parseJson(payload);

  const frame = Array.isArray(parsed)
    ? {
        event: parsed[3],
        payload: parsed[4],
        ref: parsed[1],
        topic: parsed[2],
      }
    : parsed;

  if (
    !isRecord(frame) ||
    typeof frame["event"] !== "string" ||
    !isRecord(frame["payload"]) ||
    (typeof frame["ref"] !== "string" && typeof frame["ref"] !== "number") ||
    typeof frame["topic"] !== "string"
  ) {
    return null;
  }

  return {
    event: frame["event"],
    payload: frame["payload"],
    ref: String(frame["ref"]),
    topic: frame["topic"],
  };
}

test("private Realtime subscriptions accept the ES256 grant", async ({ live, page, request }) => {
  const { players } = await createWaitingRoom(request, ["Iris"], 3);
  const host = requirePlayer(players, 0);
  let hasAuthorizedChannel = false;
  const privateJoinReferences = new Set<string>();

  page.on("websocket", (webSocket) => {
    webSocket.on("framesent", ({ payload }) => {
      const frame = parsePhoenixFrame(String(payload));
      const config = frame === null ? null : frame.payload["config"];

      if (
        frame?.event === "phx_join" &&
        frame.topic.startsWith("realtime:") &&
        typeof frame.payload["access_token"] === "string" &&
        isRecord(config) &&
        config["private"] === true
      ) {
        privateJoinReferences.add(`${frame.topic}:${frame.ref}`);
      }
    });

    webSocket.on("framereceived", ({ payload }) => {
      const frame = parsePhoenixFrame(String(payload));

      if (
        frame?.event === "phx_reply" &&
        frame.payload["status"] === "ok" &&
        privateJoinReferences.has(`${frame.topic}:${frame.ref}`)
      ) {
        hasAuthorizedChannel = true;
      }
    });
  });

  await live.open({ identityToken: host.token });

  await expect.poll(() => hasAuthorizedChannel, { timeout: 10_000 }).toBe(true);
});

test("toast announcements preserve the trigger focus contract", async ({ live, page, request }) => {
  const { players } = await createWaitingRoom(request, ["Juniper"], 3);
  const host = requirePlayer(players, 0);

  await live.open({ identityToken: host.token, shareStub: "immediate" });

  const shareButton = page.getByRole("button", {
    name: live.t.live.buttons.shareInvite,
    exact: true,
  });

  await shareButton.click();

  const toast = page.locator('[data-live-toast][data-tone="success"]');
  const announcer = page.locator('[data-live-toast-announcer="polite"]');
  const dismissButton = toast.getByRole("button", {
    name: live.t.live.buttons.dismissNotification,
    exact: true,
  });

  await expect(toast).toBeVisible();
  await expect(announcer).toHaveAttribute("aria-atomic", "true");
  await expect(announcer).toHaveAttribute("aria-live", "polite");
  await expect(announcer).toHaveAttribute("role", "status");
  const visibleMessage = toast.locator("p[data-live-toast-content]");

  await expect.poll(async () => (await visibleMessage.textContent())?.trim()).not.toBe("");
  const message = (await visibleMessage.textContent())?.trim();

  if (message === undefined || message === "") {
    throw new Error("The visible notification did not render a message.");
  }

  await expect(announcer).toContainText(message);
  await expect(shareButton).toBeFocused();

  await dismissButton.focus();
  await dismissButton.press("Enter");
  await expect(toast).toHaveCount(0);
  await expect(shareButton).toBeFocused();
});

test("an error replacement stays singular and non-interactive behind a modal", async ({
  live,
  page,
  request,
}) => {
  const { players } = await createWaitingRoom(request, ["Kite"], 3);
  const host = requirePlayer(players, 0);

  await live.open({ identityToken: host.token, shareStub: "immediate" });
  await page.getByRole("button", { name: live.t.live.buttons.shareInvite, exact: true }).click();
  await expect(page.locator("[data-live-toast]")).toBeVisible();

  await live.leaveButton().click();
  const dialog = live.leaveDialog();

  await page.route("**/api/rooms/*/leave", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ error: { code: "server_error", message: "Fixture failure" } }),
      contentType: "application/json",
      status: 500,
    });
  });
  await dialog
    .getByRole("button", { name: live.t.live.buttons.confirmLeaveRoom, exact: true })
    .click();

  const toast = page.locator("[data-live-toast]");
  const announcer = page.locator('[data-live-toast-announcer="assertive"]');
  const dismissButton = toast.getByRole("button", {
    name: live.t.live.buttons.dismissNotification,
    exact: true,
  });

  await expect(toast).toHaveCount(1);
  await expect(toast).toHaveAttribute("data-tone", "error");
  await expect(announcer).toHaveAttribute("aria-live", "assertive");
  await expect(announcer).toHaveAttribute("role", "alert");
  await expect(dismissButton).toBeDisabled();

  await dialog.getByRole("button", { name: live.t.live.buttons.cancel, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(dismissButton).toBeEnabled();
});

test("a room-scoped result is discarded after its room session ends", async ({
  live,
  page,
  request,
}) => {
  const { players } = await createWaitingRoom(request, ["Linden"], 3);
  const host = requirePlayer(players, 0);

  await live.open({ identityToken: host.token, shareStub: "deferred" });
  await page.getByRole("button", { name: live.t.live.buttons.shareInvite, exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => typeof Reflect.get(window, "__resolveLiveShare")))
    .toBe("function");

  await live.leaveButton().click();
  await live
    .leaveDialog()
    .getByRole("button", { name: live.t.live.buttons.confirmLeaveRoom, exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: live.t.live.buttons.createRoom, exact: true }),
  ).toBeVisible();

  await page.evaluate(() => {
    const resolveShare = Reflect.get(window, "__resolveLiveShare");

    if (typeof resolveShare === "function") {
      resolveShare();
    }
  });
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "__liveShareSettled") === true))
    .toBe(true);
  await expect(page.locator('[data-live-toast][data-tone="success"]')).toHaveCount(0);
});
