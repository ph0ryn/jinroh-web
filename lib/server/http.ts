import "server-only";
import { NextResponse } from "next/server";

export type ApiErrorCode =
  | "bad_request"
  | "conflict"
  | "forbidden"
  | "not_found"
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

  const [scheme, token] = header.split(" ");

  if (scheme?.toLowerCase() !== "bearer" || token === undefined || token.trim() === "") {
    return null;
  }

  return token;
}

export async function readJson<Body>(request: Request): Promise<Body | null> {
  try {
    return (await request.json()) as Body;
  } catch {
    return null;
  }
}
