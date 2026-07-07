import { requireAccount } from "@/lib/server/authenticatedRoute";
import { submitWerewolfConsultation } from "@/lib/server/gameRepository";
import { jsonError, jsonOk, readJson } from "@/lib/server/http";

type SubmitConsultationBody = {
  nightNumber?: unknown;
  operation?: unknown;
  phaseInstanceId?: unknown;
  revision?: unknown;
  templateId?: unknown;
  values?: unknown;
};

type RouteContext = {
  params: Promise<{
    roomCode: string;
  }>;
};

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const auth = await requireAccount(request);

  if ("response" in auth) {
    return auth.response;
  }

  const body = await readJson<SubmitConsultationBody>(request);

  if (body === null) {
    return jsonError("bad_request", "Request body is required.", 400);
  }

  if (body.operation !== "submit" && body.operation !== "retract") {
    return jsonError("bad_request", "operation is invalid.", 400);
  }

  if (typeof body.templateId !== "string" || body.templateId === "") {
    return jsonError("bad_request", "templateId is required.", 400);
  }

  if (typeof body.phaseInstanceId !== "string" || body.phaseInstanceId === "") {
    return jsonError("bad_request", "phaseInstanceId is required.", 400);
  }

  const nightNumber = body.nightNumber;

  if (typeof nightNumber !== "number" || !Number.isSafeInteger(nightNumber) || nightNumber < 1) {
    return jsonError("bad_request", "nightNumber is invalid.", 400);
  }

  const revision = body.revision;

  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) {
    return jsonError("bad_request", "revision is invalid.", 400);
  }

  const values = body.operation === "submit" ? parseStringRecord(body.values) : {};

  if (values === null) {
    return jsonError("bad_request", "values are invalid.", 400);
  }

  const { roomCode } = await context.params;

  try {
    return jsonOk(
      await submitWerewolfConsultation(auth.account, roomCode, {
        nightNumber,
        operation: body.operation,
        phaseInstanceId: body.phaseInstanceId,
        revision,
        templateId: body.templateId,
        values,
      }),
    );
  } catch {
    return jsonError("conflict", "Consultation update failed.", 409);
  }
}

function parseStringRecord(value: unknown): Record<string, string> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      typeof entry === "string" ? [[key, entry]] : [],
    ),
  );
}
