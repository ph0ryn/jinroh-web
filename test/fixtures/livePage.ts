import { LOCALE_STORAGE_KEY, localizations } from "@/lib/i18n/localization";

import type { ApiPlayer } from "./apiClient";
import type { PublicAction } from "@/lib/shared/game";
import type { Browser, BrowserContext, Locator, Page } from "playwright/test";

const DISPLAY_NAME_STORAGE_KEY = "jinrohWeb.displayName";
const IDENTITY_TOKEN_STORAGE_KEY = "jinrohWeb.identityToken";

export type ShareStub = "deferred" | "immediate";

type OpenLiveOptions = {
  readonly displayName?: string;
  readonly identityToken?: string;
  readonly path?: string;
  readonly shareStub?: ShareStub;
};

export class LivePage {
  readonly page: Page;
  readonly t = localizations.en;

  constructor(page: Page) {
    this.page = page;
  }

  async open(options: OpenLiveOptions = {}): Promise<void> {
    await this.page.addInitScript(
      ({
        displayName,
        identityToken,
        localeStorageKey,
        displayNameStorageKey,
        tokenStorageKey,
        shareStub,
      }) => {
        window.localStorage.setItem(localeStorageKey, "en");

        if (displayName !== undefined) {
          window.localStorage.setItem(displayNameStorageKey, displayName);
        }

        if (identityToken !== undefined) {
          window.localStorage.setItem(tokenStorageKey, identityToken);
        }

        if (shareStub === "immediate") {
          Object.defineProperty(navigator, "share", {
            configurable: true,
            value: async () => undefined,
          });
        } else if (shareStub === "deferred") {
          Object.defineProperty(navigator, "share", {
            configurable: true,
            value: () =>
              new Promise<void>((resolve) => {
                Reflect.set(window, "__resolveLiveShare", () => {
                  resolve();
                  queueMicrotask(() => Reflect.set(window, "__liveShareSettled", true));
                });
              }),
          });
        }
      },
      {
        displayName: options.displayName,
        displayNameStorageKey: DISPLAY_NAME_STORAGE_KEY,
        identityToken: options.identityToken,
        localeStorageKey: LOCALE_STORAGE_KEY,
        shareStub: options.shareStub,
        tokenStorageKey: IDENTITY_TOKEN_STORAGE_KEY,
      },
    );
    await this.page.goto(options.path ?? "/live");
  }

  async createRoom(targetPlayerCount: number): Promise<string> {
    if (await this.createModeButton().isVisible()) {
      await this.createModeButton().click();
    }

    await this.page
      .getByRole("combobox", { name: this.t.live.setup.players, exact: true })
      .selectOption(String(targetPlayerCount));
    await this.page
      .getByRole("button", { name: this.t.live.buttons.createRoom, exact: true })
      .click();
    const roomCode = this.currentRoomCode();

    await roomCode.waitFor({ state: "visible" });
    const value = (await roomCode.textContent())?.trim();

    if (value === undefined || !/^\d{6}$/u.test(value)) {
      throw new Error("The room code was not rendered as six digits.");
    }

    return value;
  }

  async joinRoom(roomCode: string): Promise<void> {
    if (await this.joinModeButton().isVisible()) {
      await this.joinModeButton().click();
    }

    for (const [index, digit] of roomCode.split("").entries()) {
      await this.roomCodeDigit(index + 1).fill(digit);
    }

    await this.page
      .getByRole("button", { name: this.t.live.buttons.joinRoom, exact: true })
      .click();
    await this.currentRoomCode().waitFor({ state: "visible" });
  }

  async setDisplayName(displayName: string): Promise<void> {
    await this.page.getByLabel(this.t.live.setup.displayName, { exact: true }).fill(displayName);
  }

  async waitForCinematicEffects(): Promise<void> {
    await this.page.locator("[data-live-effect]").waitFor({ state: "detached", timeout: 10_000 });
  }

  actionRow(action: PublicAction): Locator {
    return this.page.locator(
      `[data-live-action-key="${action.key}"][data-live-action-kind="${action.kind}"]`,
    );
  }

  createModeButton(): Locator {
    return this.entryModeGroup().getByRole("button", {
      name: this.t.live.setup.createTitle,
      exact: true,
    });
  }

  currentRoomCode(): Locator {
    return this.page.locator("[data-live-room-code]:visible strong");
  }

  entryModeGroup(): Locator {
    return this.page.getByRole("group", { name: this.t.live.aria.entryMode, exact: true });
  }

  joinModeButton(): Locator {
    return this.entryModeGroup().getByRole("button", {
      name: this.t.live.setup.joinTitle,
      exact: true,
    });
  }

  lobbyReadinessButton(): Locator {
    return this.page.locator("[data-live-readiness-toggle]");
  }

  leaveButton(): Locator {
    return this.page.getByRole("button", { name: this.t.live.buttons.leaveRoom, exact: true });
  }

  leaveDialog(): Locator {
    return this.page.getByRole("dialog", {
      name: this.t.live.leaveConfirmation.title,
      exact: true,
    });
  }

  roomCodeDigit(index: number): Locator {
    return this.page.getByRole("textbox", {
      name: this.t.live.setup.roomCodeDigit(index),
      exact: true,
    });
  }

  settingsButton(): Locator {
    return this.page.getByRole("button", { name: this.t.live.buttons.settings, exact: true });
  }

  settingsDialog(): Locator {
    return this.page.getByRole("dialog", { name: this.t.live.settings.title, exact: true });
  }
}

export type BrowserPlayer = {
  readonly context: BrowserContext;
  readonly live: LivePage;
  readonly page: Page;
  readonly player: ApiPlayer;
};

export async function createBrowserPlayer(
  browser: Browser,
  player: ApiPlayer,
): Promise<BrowserPlayer> {
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-test-client-ip": "192.0.2.253" },
    viewport: { height: 720, width: 1280 },
  });
  const page = await context.newPage();
  const live = new LivePage(page);

  await live.open({ displayName: player.displayName, identityToken: player.token });

  return { context, live, page, player };
}

export function createGate(): { readonly release: () => void; readonly wait: Promise<void> } {
  let release = (): void => undefined;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { release: () => release(), wait };
}

export async function readInertElementCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLElement>("[inert]")].filter((element) => element.inert)
        .length,
  );
}

export async function readLayoutMode(page: Page): Promise<string> {
  return page
    .locator("[data-live-room-layout]")
    .evaluate((layout) => getComputedStyle(layout).getPropertyValue("--live-layout-mode").trim());
}

export async function readModalIsolation(page: Page): Promise<{
  readonly allUnderlyingBranchesInert: boolean;
  readonly inertBranchCount: number;
}> {
  return page.evaluate(() => {
    const modalRoot = document.querySelector<HTMLElement>("[data-live-modal-root]");

    if (modalRoot === null) {
      return { allUnderlyingBranchesInert: false, inertBranchCount: 0 };
    }

    const underlyingBranches: HTMLElement[] = [];
    let currentBranch = modalRoot;

    while (currentBranch.parentElement !== null) {
      const parent = currentBranch.parentElement;

      for (const sibling of parent.children) {
        if (
          sibling instanceof HTMLElement &&
          sibling !== currentBranch &&
          !sibling.hasAttribute("data-live-modal-inert-exempt")
        ) {
          underlyingBranches.push(sibling);
        }
      }

      if (parent === document.body) {
        break;
      }

      currentBranch = parent;
    }

    return {
      allUnderlyingBranchesInert:
        underlyingBranches.length > 0 && underlyingBranches.every((element) => element.inert),
      inertBranchCount: underlyingBranches.length,
    };
  });
}

export async function readDocumentOverflow(page: Page): Promise<{
  readonly overflowX: number;
  readonly overflowY: number;
  readonly scrollX: number;
  readonly scrollY: number;
}> {
  await page.evaluate(() =>
    window.scrollTo(document.documentElement.scrollWidth, document.documentElement.scrollHeight),
  );

  return page.evaluate(() => ({
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    overflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  }));
}
