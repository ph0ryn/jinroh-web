import "server-only";
import { NextResponse } from "next/server";

export type ApiErrorCode =
  | "bad_request"
  | "conflict"
  | "current_room_changed"
  | "current_room_exists"
  | "forbidden"
  | "game_changed"
  | "not_found"
  | "players_not_ready"
  | "rate_limited"
  | "roster_changed"
  | "room_closed"
  | "room_full"
  | "room_not_found"
  | "room_not_joinable"
  | "room_switch_forbidden"
  | "server_error"
  | "unauthorized";

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    message: string;
  };
};

export function jsonOk<Body>(body: Body, init?: ResponseInit): NextResponse<Body> {
  return NextResponse.json(body, init);
}

export function jsonError(
  code: ApiErrorCode,
  message: string,
  status: number,
): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error: { code, message } }, { status });
}

export function parseBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");

  if (header === null) {
    return null;
  }

  const match = /^Bearer (?<token>\S+)$/iu.exec(header.trim());

  return match?.groups?.["token"] ?? null;
}

export function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export async function readJson<Body>(request: Request): Promise<Body | null> {
  try {
    return (await request.json()) as Body;
  } catch {
    return null;
  }
}
