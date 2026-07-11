import type { Localization } from "@/lib/i18n/localization";
import type { RealtimeScope, RealtimeSubscription } from "@/lib/shared/game";

type ApiErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

type RequestOptions = {
  body?: unknown;
  method?: "GET" | "POST";
  signal?: AbortSignal;
  token?: string;
};

type RealtimeInvalidationPayload = {
  readonly reason: string;
  readonly roomCode: string;
  readonly scope: RealtimeScope;
  readonly sentAt: string;
};

type RealtimeSubscriptionSnapshot = Pick<RealtimeSubscription, "scope" | "topic">;

class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.status = status;
  }
}

export async function apiFetch<Body>(path: string, options: RequestOptions): Promise<Body> {
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
    signal: options.signal,
  });
  const json = await parseJson(response);

  if (!response.ok) {
    const apiError = extractApiError(json, response.status);

    throw new ApiRequestError(apiError.message, response.status, apiError.code);
  }

  return json as Body;
}

export function isNotFoundRequestError(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 404;
}

export function isApiRequestErrorCode(error: unknown, code: string): boolean {
  return error instanceof ApiRequestError && error.code === code;
}

export function isUnauthorizedRequestError(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 401;
}

export async function writeClipboardText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function getLiveRoomUrl(roomCode: string, origin: string): string {
  const url = new URL("/live", origin);

  url.searchParams.set("roomCode", roomCode);

  return url.toString();
}

export function getRoomCodeSearchParam(search: string): string | null {
  const roomCode = new URLSearchParams(search).get("roomCode");

  return roomCode !== null && /^\d{6}$/.test(roomCode) ? roomCode : null;
}

export function toRequestFailureMessage(error: unknown, t: Localization): string {
  if (
    error instanceof TypeError ||
    (error instanceof Error && /failed to fetch|load failed|networkerror/iu.test(error.message))
  ) {
    return t.api.networkFailure;
  }

  if (error instanceof ApiRequestError) {
    return formatApiError(error, t);
  }

  return error instanceof Error ? error.message : t.api.errors.unknown;
}

export function toRealtimeSubscriptionKey(subscriptions: RealtimeSubscription[]): string {
  return JSON.stringify(
    subscriptions
      .map(({ scope, topic }) => ({ scope, topic }))
      .toSorted((left, right) =>
        `${left.scope}:${left.topic}`.localeCompare(`${right.scope}:${right.topic}`),
      ),
  );
}

export function parseRealtimeSubscriptionKey(key: string): RealtimeSubscriptionSnapshot[] {
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

export function isRealtimeInvalidationPayload(
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
    isRealtimeScope(value["scope"])
  );
}

export function readStorage(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(key);
}

export function writeStorage(key: string, value: string): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(key, value);
  }
}

export function removeStorage(key: string): void {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(key);
  }
}

export function requireRoomCode(roomCode: string, t: Localization): string {
  if (!/^\d{6}$/.test(roomCode)) {
    throw new Error(t.live.room.enterCode);
  }

  return roomCode;
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function extractApiError(
  value: unknown,
  status: number,
): { readonly code: string; readonly message: string } {
  if (isApiErrorResponse(value)) {
    return {
      code: value.error.code,
      message: value.error.message,
    };
  }

  return {
    code: "unknown",
    message: `Request failed with HTTP ${status}.`,
  };
}

function formatApiError(error: ApiRequestError, t: Localization): string {
  switch (error.code) {
    case "bad_request":
      return t.api.errors.bad_request;
    case "conflict":
      return t.api.errors.conflict;
    case "current_room_changed":
      return t.live.room.currentChanged;
    case "current_room_exists":
      return t.live.room.currentExists;
    case "not_found":
      return t.api.errors.not_found;
    case "room_expired":
      return t.live.room.expired;
    case "room_full":
      return t.live.room.full;
    case "room_not_found":
      return t.live.room.notFound;
    case "room_not_joinable":
      return t.live.room.notJoinable;
    case "room_switch_forbidden":
      return t.live.room.switchForbiddenGeneric;
    case "server_error":
      return t.api.errors.server_error;
    case "unauthorized":
      return t.api.errors.unauthorized;
    default:
      return t.api.errors.unknown;
  }
}

function parseUnknownJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isRealtimeScope(value: unknown): value is RealtimeScope {
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

  return "code" in candidate.error && "message" in candidate.error;
}
