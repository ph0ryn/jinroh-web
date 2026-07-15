# Night Conversation

Night conversation is a lightweight role-group chat for players whose role
definitions explicitly opt in.

It is not a game action. Messages do not affect attack resolution, vote
counting, endgame judgement, or PlayerResult judgement.

## Role Opt-In

Each Role can declare whether it participates in a night conversation group.

```ts
export type RoleNightConversationDefinition = {
  groupId: string;
  label: LocalizedText;
};

export class WerewolfRole extends Role {
  override readonly nightConversation = {
    groupId: "werewolf",
    label: { en: "Werewolf council", ja: "人狼の密談" },
  };
}
```

The game start setup resolves active role definitions into
`resolvedRoleSetup.nightConversationGroups`.

```text
game start
  collect active Role definitions
  read Role.nightConversation
  group roles by groupId
  persist resolvedRoleSetup.nightConversationGroups in game_rule_sets
```

Only active roles can contribute conversation groups. A role without
`nightConversation` contributes nothing. Future roles can join the same
`groupId` or define a separate group without changing the chat storage model.
Each Role can belong to at most one resolved conversation group.

## Visibility

Night conversation is shown only to players whose assigned role is included in
the resolved conversation group's `roleIds`.

Current v1 group:

```text
groupId: werewolf
label: { en: Werewolf council, ja: 人狼の密談 }
roleIds: [werewolf]
```

Important boundary:

- Madman can share the Werewolf team result but does not have WerewolfRole.
- Therefore Madman does not see the Werewolf night conversation.
- Public game view, public realtime payload, villagers, and non-member private
  views never include conversation messages.

## Timing

- During `night`, eligible, alive, connected players can open the night chat and
  send messages.
- Dead or disconnected group members keep the same view as read-only.
- Outside `night`, eligible players can open the same view as read-only.
- Ended games can omit the conversation view.
- The button can be hidden for roles with no conversation group.

The view is a role-private view, not a public game view.

## Message Shape

Messages are append-only.

```ts
export type NightConversationMessage = {
  id: string;
  senderPlayerId: string;
  senderName: string;
  body: string;
  createdAt: string;
};
```

Rules:

- `body` is trimmed before storage.
- `body` must be 1 to 100 characters.
- sender is the authenticated Player in the room.
- timestamp is server-generated.
- raw Account ID is never exposed.
- messages are ordered by `createdAt`, then internal id.

## Transaction Rules

Sending a message happens in one server-side transaction.

- Authenticate Account token.
- Resolve the Player in the room.
- Lock the exact current `games` row identified by the request Game ID.
- Confirm room and game status are `playing`.
- Confirm phase is `night`.
- Confirm the sender is `joined` and alive.
- Confirm request `phaseInstanceId` and `nightNumber` match current state.
- Resolve sender role from the current Game's `game_players` roster.
- Confirm sender role is in the requested conversation group.
- Validate message body length and group id shape.
- Insert one row into `night_conversation_messages`.
- Increment only the resolved group's role-private snapshot revision without
  changing the room-public or phase revision.
- Return a private-view invalidation result.

Rejected requests do not insert messages.

## Realtime

Realtime notifications are invalidation only. Payloads may include safe room
identifier, reason, scope, and event time, but never message content.

After a notification, clients reload the room view from the Next.js API. The API
cuts the view into public, self private, and role private shapes before returning
anything to the browser.

## Tests

Required coverage:

- Werewolf players see the Werewolf night conversation.
- Madman and villagers do not see the Werewolf night conversation.
- A Werewolf can send a 1 to 100 character message during night.
- Dead or disconnected group members cannot send messages.
- A non-member role cannot send by calling the API directly.
- Stale `phaseInstanceId` or stale `nightNumber` is rejected.
- Day view is read-only but preserves current night's messages.
- Public game view and realtime payload do not include message bodies.
