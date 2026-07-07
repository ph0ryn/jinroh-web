import "server-only";
import type { CountGroup } from "../types";
import type { RoleContext } from "./base";

export function countAliveByGroup(context: RoleContext, group: CountGroup): number {
  let count = 0;

  for (const playerId of context.state.alivePlayerIds) {
    const roleId = context.state.roleByPlayerId.get(playerId);

    if (roleId === undefined) {
      continue;
    }

    const role = context.roles.get(roleId);

    if (role.countAs({ ...context, playerId }) === group) {
      count += 1;
    }
  }

  return count;
}
