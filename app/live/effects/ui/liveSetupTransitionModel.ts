export type LiveSetupSurfaceKind = "entry" | "game" | "loading" | "waiting";

export type LiveSetupTransitionSnapshot = {
  readonly kind: LiveSetupSurfaceKind;
  readonly roomCode: string | null;
  readonly viewerPlayerId: string | null;
};

export type LiveSetupTransitionKind = Extract<LiveSetupSurfaceKind, "entry" | "waiting">;

export function reconcileLiveSetupTransition(
  previous: LiveSetupTransitionSnapshot | null,
  current: LiveSetupTransitionSnapshot,
  shouldAnimate: boolean,
): LiveSetupTransitionKind | null {
  if (previous === null || !shouldAnimate || snapshotsMatch(previous, current)) {
    return null;
  }

  if (current.kind === "entry" && (previous.kind === "loading" || previous.kind === "waiting")) {
    return "entry";
  }

  if (previous.kind === "entry" && current.kind === "waiting") {
    return "waiting";
  }

  return null;
}

export function getLiveSetupTransitionSnapshotKey(snapshot: LiveSetupTransitionSnapshot): string {
  return [snapshot.kind, snapshot.roomCode ?? "none", snapshot.viewerPlayerId ?? "none"].join(":");
}

function snapshotsMatch(
  previous: LiveSetupTransitionSnapshot,
  current: LiveSetupTransitionSnapshot,
): boolean {
  return (
    previous.kind === current.kind &&
    previous.roomCode === current.roomCode &&
    previous.viewerPlayerId === current.viewerPlayerId
  );
}
