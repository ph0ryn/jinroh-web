import { expect, test } from "playwright/test";

import type { APIRequestContext } from "playwright/test";

type Identity = { readonly token: string };

test("a shared network admits a normal host and nine guests", async ({ request }) => {
  const clientIp = "192.0.2.10";
  const identities = await Promise.all(
    Array.from({ length: 10 }, () => createIdentity(request, clientIp)),
  );
  const host = requireIdentity(identities, 0);
  const roomResponse = await request.post("/api/rooms", {
    data: { displayName: "Host", targetPlayerCount: 10 },
    headers: authenticatedHeaders(host.token, clientIp),
  });

  expect(roomResponse.status()).toBe(201);

  const room = (await roomResponse.json()) as { readonly code: string };
  const joinResponses = await Promise.all(
    identities.slice(1).map((identity, index) =>
      request.post(`/api/rooms/${room.code}/join`, {
        data: { displayName: `Guest ${index + 1}` },
        headers: authenticatedHeaders(identity.token, clientIp),
      }),
    ),
  );

  expect(joinResponses.map((response) => response.status())).toEqual(Array(9).fill(200));
});

test("parallel identity creation allows exactly the IP burst capacity", async ({ request }) => {
  const responses = await Promise.all(
    Array.from({ length: 16 }, () =>
      request.post("/api/identity", { headers: { "x-test-client-ip": "192.0.2.20" } }),
    ),
  );
  const statuses = responses
    .map((response) => response.status())
    .sort((left, right) => left - right);
  const rejected = responses.find((response) => response.status() === 429);

  expect(statuses).toEqual([...Array(15).fill(201), 429]);
  expect(rejected).toBeDefined();
  expect(Number(rejected?.headers()["retry-after"])).toBeGreaterThan(0);
});

test("parallel room creation consumes the account bucket atomically", async ({ request }) => {
  const clientIp = "192.0.2.30";
  const identity = await createIdentity(request, clientIp);
  const responses = await Promise.all(
    Array.from({ length: 4 }, (_, index) =>
      request.post("/api/rooms", {
        data: { displayName: `Host ${index}`, targetPlayerCount: 3 },
        headers: authenticatedHeaders(identity.token, clientIp),
      }),
    ),
  );

  expect(
    responses.map((response) => response.status()).sort((left, right) => left - right),
  ).toEqual([201, 409, 409, 429]);
});

test("invalid switch and unknown-room attempts consume their operation quota", async ({
  request,
}) => {
  const switchIp = "192.0.2.40";
  const switchIdentity = await createIdentity(request, switchIp);
  const invalidSwitchResponses = [
    await request.post("/api/rooms", {
      data: {},
      headers: authenticatedHeaders(switchIdentity.token, switchIp),
    }),
    await request.post("/api/rooms/switch", {
      data: { kind: "create" },
      headers: authenticatedHeaders(switchIdentity.token, switchIp),
    }),
    await request.post("/api/rooms", {
      data: {},
      headers: authenticatedHeaders(switchIdentity.token, switchIp),
    }),
    await request.post("/api/rooms/switch", {
      data: { kind: "create" },
      headers: authenticatedHeaders(switchIdentity.token, switchIp),
    }),
  ];

  expect(invalidSwitchResponses.map((response) => response.status())).toEqual([400, 400, 400, 429]);

  const joinIp = "192.0.2.41";
  const joinIdentity = await createIdentity(request, joinIp);
  const unknownRoomResponses = [];

  for (let index = 0; index < 3; index += 1) {
    unknownRoomResponses.push(
      await request.post("/api/rooms/000000/join", {
        data: { displayName: "Guest" },
        headers: authenticatedHeaders(joinIdentity.token, joinIp),
      }),
    );
  }

  for (let index = 0; index < 3; index += 1) {
    unknownRoomResponses.push(
      await request.post("/api/rooms/switch", {
        data: {
          displayName: "Guest",
          expectedCurrentRoomCode: "111111",
          kind: "join",
          targetRoomCode: "000000",
        },
        headers: authenticatedHeaders(joinIdentity.token, joinIp),
      }),
    );
  }

  unknownRoomResponses.push(
    await request.post("/api/rooms/000000/join", {
      data: { displayName: "Guest" },
      headers: authenticatedHeaders(joinIdentity.token, joinIp),
    }),
  );

  expect(unknownRoomResponses.map((response) => response.status())).toEqual([
    404, 404, 404, 409, 409, 409, 429,
  ]);
});

test("a target-room bucket is shared across distinct client networks", async ({ request }) => {
  const hostIp = "192.0.2.60";
  const host = await createIdentity(request, hostIp);
  const roomResponse = await request.post("/api/rooms", {
    data: { displayName: "Host", targetPlayerCount: 10 },
    headers: authenticatedHeaders(host.token, hostIp),
  });
  const room = (await roomResponse.json()) as { readonly code: string };
  const guests = await Promise.all(
    Array.from({ length: 13 }, (_, index) => createIdentity(request, `203.0.113.${index + 1}`)),
  );
  const responses = [];

  for (const [index, guest] of guests.entries()) {
    responses.push(
      await request.post(`/api/rooms/${room.code}/join`, {
        data: { displayName: `Guest ${index + 1}` },
        headers: authenticatedHeaders(guest.token, `203.0.113.${index + 1}`),
      }),
    );
  }

  expect(responses.map((response) => response.status())).toEqual([
    200, 200, 200, 200, 200, 200, 200, 200, 200, 409, 409, 409, 429,
  ]);
});

test("room lookup limits outsiders without throttling active members", async ({ request }) => {
  const hostIp = "192.0.2.50";
  const host = await createIdentity(request, hostIp);
  const roomResponse = await request.post("/api/rooms", {
    data: { displayName: "Host", targetPlayerCount: 3 },
    headers: authenticatedHeaders(host.token, hostIp),
  });
  const room = (await roomResponse.json()) as { readonly code: string };
  const memberResponses = await Promise.all(
    Array.from({ length: 30 }, () =>
      request.get(`/api/rooms/${room.code}`, {
        headers: authenticatedHeaders(host.token, hostIp),
      }),
    ),
  );

  expect(memberResponses.every((response) => response.status() === 200)).toBe(true);

  const outsiderIp = "192.0.2.51";
  const outsider = await createIdentity(request, outsiderIp);
  const outsiderResponses = [];

  for (let index = 0; index < 7; index += 1) {
    outsiderResponses.push(
      await request.get(`/api/rooms/${room.code}`, {
        headers: authenticatedHeaders(outsider.token, outsiderIp),
      }),
    );
  }

  expect(outsiderResponses.map((response) => response.status())).toEqual([
    200, 200, 200, 200, 200, 200, 429,
  ]);
});

test("unknown room lookup and invalid trusted headers fail closed", async ({ request }) => {
  const clientIp = "192.0.2.70";
  const identity = await createIdentity(request, clientIp);
  const unknownRoomResponses = [];

  for (let index = 0; index < 7; index += 1) {
    unknownRoomResponses.push(
      await request.get("/api/rooms/999999", {
        headers: authenticatedHeaders(identity.token, clientIp),
      }),
    );
  }

  expect(unknownRoomResponses.map((response) => response.status())).toEqual([
    404, 404, 404, 404, 404, 404, 429,
  ]);

  const missingHeader = await fetch("http://127.0.0.1:3010/api/identity", { method: "POST" });
  const invalidHeader = await fetch("http://127.0.0.1:3010/api/identity", {
    headers: { "x-test-client-ip": "192.0.2.1, 198.51.100.2" },
    method: "POST",
  });

  expect(missingHeader.status).toBe(503);
  expect(invalidHeader.status).toBe(503);
});

async function createIdentity(request: APIRequestContext, clientIp: string): Promise<Identity> {
  const response = await request.post("/api/identity", {
    headers: { "x-test-client-ip": clientIp },
  });

  expect(response.status()).toBe(201);

  return (await response.json()) as Identity;
}

function authenticatedHeaders(token: string, clientIp: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "x-test-client-ip": clientIp,
  };
}

function requireIdentity(identities: readonly Identity[], index: number): Identity {
  const identity = identities[index];

  if (identity === undefined) {
    throw new Error(`Identity ${index} is missing.`);
  }

  return identity;
}
