import "server-only";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";

import { getServerEnv } from "./env";
import { jsonError } from "./http";
import { consumeRateLimits, type RateLimitRule } from "./rateLimitRepository";

type RoomMutationKind = "create" | "join";

type RuleDefinition = {
  readonly capacity: number;
  readonly name: string;
  readonly refillSeconds: number;
  readonly subject: string;
};

const CLIENT_IP_HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const RATE_LIMIT_KEY_CONTEXT = "jinroh-web:rate-limit:v1";
const UNATTRIBUTED_CLIENT = "unattributed-client";

const IDENTITY_IP_RULES = [
  { capacity: 15, name: "identity-ip-burst", refillSeconds: 30 * 60 },
  { capacity: 50, name: "identity-ip-sustained", refillSeconds: 24 * 60 * 60 },
] as const;

const COMMON_ROOM_MUTATION_ACCOUNT_RULES = [
  { capacity: 8, name: "room-mutation-account-burst", refillSeconds: 10 * 60 },
  { capacity: 24, name: "room-mutation-account-sustained", refillSeconds: 24 * 60 * 60 },
] as const;

const COMMON_ROOM_MUTATION_IP_RULES = [
  { capacity: 32, name: "room-mutation-ip-burst", refillSeconds: 60 },
  { capacity: 120, name: "room-mutation-ip-sustained", refillSeconds: 24 * 60 * 60 },
] as const;

const CREATE_ACCOUNT_RULES = [
  { capacity: 3, name: "room-create-account-burst", refillSeconds: 30 * 60 },
  { capacity: 8, name: "room-create-account-sustained", refillSeconds: 24 * 60 * 60 },
] as const;

const CREATE_IP_RULES = [
  { capacity: 8, name: "room-create-ip-burst", refillSeconds: 5 * 60 },
  { capacity: 30, name: "room-create-ip-sustained", refillSeconds: 24 * 60 * 60 },
] as const;

const JOIN_ACCOUNT_RULES = [
  { capacity: 6, name: "room-join-account-burst", refillSeconds: 2 * 60 },
  { capacity: 20, name: "room-join-account-sustained", refillSeconds: 24 * 60 * 60 },
] as const;

const JOIN_IP_RULES = [
  { capacity: 24, name: "room-join-ip-burst", refillSeconds: 30 },
  { capacity: 100, name: "room-join-ip-sustained", refillSeconds: 24 * 60 * 60 },
] as const;

const JOIN_ROOM_IP_RULES = [
  { capacity: 12, name: "room-join-ip-target", refillSeconds: 60 },
] as const;

const JOIN_ROOM_GLOBAL_RULES = [
  { capacity: 12, name: "room-join-target", refillSeconds: 60 },
] as const;

const ROOM_LOOKUP_ACCOUNT_RULES = [
  { capacity: 6, name: "room-lookup-account-burst", refillSeconds: 10 * 60 },
  { capacity: 30, name: "room-lookup-account-sustained", refillSeconds: 24 * 60 * 60 },
] as const;

const ROOM_LOOKUP_IP_RULES = [
  { capacity: 30, name: "room-lookup-ip-burst", refillSeconds: 10 * 60 },
  { capacity: 100, name: "room-lookup-ip-sustained", refillSeconds: 24 * 60 * 60 },
] as const;

export async function enforceIdentityRateLimit(request: Request): Promise<Response | null> {
  return enforceRateLimit(() =>
    toRules(
      IDENTITY_IP_RULES.map((definition) => ({
        ...definition,
        subject: getClientSubject(request),
      })),
    ),
  );
}

export function rateLimitUnavailableResponse(): Response {
  const response = jsonError("server_error", "Request protection is temporarily unavailable.", 503);

  response.headers.set("cache-control", "no-store");

  return response;
}

export async function enforceRoomMutationClientRateLimit(
  request: Request,
  kind?: RoomMutationKind,
  roomCode?: string,
): Promise<Response | null> {
  return enforceRateLimit(() => {
    const clientSubject = getClientSubject(request);
    const definitions: RuleDefinition[] = [
      ...COMMON_ROOM_MUTATION_IP_RULES.map((definition) => ({
        ...definition,
        subject: clientSubject,
      })),
    ];

    if (kind === "create") {
      definitions.push(
        ...CREATE_IP_RULES.map((definition) => ({ ...definition, subject: clientSubject })),
      );
    }

    if (kind === "join") {
      const roomSubject = `room:${normalizeRoomCodeSubject(roomCode)}`;

      definitions.push(
        ...JOIN_IP_RULES.map((definition) => ({ ...definition, subject: clientSubject })),
        ...JOIN_ROOM_IP_RULES.map((definition) => ({
          ...definition,
          subject: `${clientSubject}:${roomSubject}`,
        })),
        ...JOIN_ROOM_GLOBAL_RULES.map((definition) => ({ ...definition, subject: roomSubject })),
      );
    }

    return toRules(definitions);
  });
}

export async function enforceRoomMutationAccountRateLimit(
  accountId: number,
  kind?: RoomMutationKind,
): Promise<Response | null> {
  return enforceRateLimit(() => {
    const accountSubject = `account:${accountId}`;
    const definitions: RuleDefinition[] = [
      ...COMMON_ROOM_MUTATION_ACCOUNT_RULES.map((definition) => ({
        ...definition,
        subject: accountSubject,
      })),
    ];

    if (kind === "create") {
      definitions.push(
        ...CREATE_ACCOUNT_RULES.map((definition) => ({ ...definition, subject: accountSubject })),
      );
    }

    if (kind === "join") {
      definitions.push(
        ...JOIN_ACCOUNT_RULES.map((definition) => ({ ...definition, subject: accountSubject })),
      );
    }

    return toRules(definitions);
  });
}

export async function enforceRoomLookupClientRateLimit(request: Request): Promise<Response | null> {
  return enforceRateLimit(() => {
    const clientSubject = getClientSubject(request);

    return toRules(
      ROOM_LOOKUP_IP_RULES.map((definition) => ({
        ...definition,
        subject: clientSubject,
      })),
    );
  });
}

export async function enforceRoomLookupAccountRateLimit(
  accountId: number,
): Promise<Response | null> {
  return enforceRateLimit(() =>
    toRules(
      ROOM_LOOKUP_ACCOUNT_RULES.map((definition) => ({
        ...definition,
        subject: `account:${accountId}`,
      })),
    ),
  );
}

export function getTrustedClientAddress(
  request: Request,
  headerName: string | null,
): string | null {
  if (headerName === null) {
    return null;
  }

  if (!CLIENT_IP_HEADER_NAME_PATTERN.test(headerName)) {
    throw new Error("RATE_LIMIT_TRUSTED_CLIENT_IP_HEADER must be a valid HTTP header name.");
  }

  const value = request.headers.get(headerName);

  if (value === null) {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized.includes(",") || isIP(normalized) === 0) {
    return null;
  }

  if (isIP(normalized) === 4) {
    return normalized;
  }

  return getIpv4MappedAddress(normalized) ?? toIpv6Network64(normalized);
}

export function hashRateLimitKey(name: string, subject: string): string {
  const { accountTokenHashSecret } = getServerEnv();

  return createHmac("sha256", accountTokenHashSecret)
    .update(`${RATE_LIMIT_KEY_CONTEXT}\0${name}\0${subject}`)
    .digest("base64url");
}

async function enforceRateLimit(
  createRules: () => readonly RateLimitRule[],
): Promise<Response | null> {
  try {
    const decision = await consumeRateLimits(createRules());

    if (decision.allowed) {
      return null;
    }

    const retryAfterSeconds = Math.max(1, decision.retryAfterSeconds);
    const response = jsonError("rate_limited", "Too many attempts. Wait before trying again.", 429);

    response.headers.set("cache-control", "no-store");
    response.headers.set("retry-after", String(retryAfterSeconds));

    return response;
  } catch {
    return rateLimitUnavailableResponse();
  }
}

function getClientSubject(request: Request): string {
  const { rateLimitTrustedClientIpHeader: headerName } = getServerEnv();
  const clientAddress = getTrustedClientAddress(request, headerName);

  if (headerName !== null && clientAddress === null) {
    throw new Error("The trusted client IP header is missing or invalid.");
  }

  return `client:${clientAddress ?? UNATTRIBUTED_CLIENT}`;
}

function toIpv6Network64(address: string): string {
  const groups = expandIpv6Groups(address);

  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(":")}::/64`;
}

function getIpv4MappedAddress(address: string): string | null {
  const groups = expandIpv6Groups(address);

  if (
    !groups.slice(0, 5).every((group) => group === 0) ||
    groups[5] !== 0xffff ||
    groups[6] === undefined ||
    groups[7] === undefined
  ) {
    return null;
  }

  return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
}

function expandIpv6Groups(address: string): number[] {
  const ipv4Match = /(?<ipv4>\d+\.\d+\.\d+\.\d+)$/u.exec(address);
  let normalized = address;

  if (ipv4Match?.groups?.["ipv4"] !== undefined) {
    const octets = ipv4Match.groups["ipv4"].split(".").map(Number);
    const high = ((octets[0] ?? 0) << 8) | (octets[1] ?? 0);
    const low = ((octets[2] ?? 0) << 8) | (octets[3] ?? 0);

    normalized = normalized.replace(
      ipv4Match.groups["ipv4"],
      `${high.toString(16)}:${low.toString(16)}`,
    );
  }

  const [leftText, rightText] = normalized.split("::");
  const left = leftText === "" ? [] : (leftText ?? "").split(":");
  const right = rightText === undefined || rightText === "" ? [] : rightText.split(":");
  const missingGroupCount = 8 - left.length - right.length;
  const groups = [...left, ...Array.from({ length: missingGroupCount }, () => "0"), ...right];

  return groups.map((group) => Number.parseInt(group, 16));
}

function normalizeRoomCodeSubject(roomCode: string | undefined): string {
  const normalized = roomCode?.trim();

  return normalized !== undefined && /^\d{6}$/u.test(normalized) ? normalized : "invalid";
}

function toRules(definitions: readonly RuleDefinition[]): RateLimitRule[] {
  return definitions.map(({ capacity, name, refillSeconds, subject }) => ({
    capacity,
    key: hashRateLimitKey(name, subject),
    refillSeconds,
  }));
}
