import { getLiveGameSessionIdentity } from "../liveGameSession";

import type { LiveEffectCue } from "./liveEffectCues";
import type { RoomSummary } from "@/lib/shared/game";

export type LiveDisplayCommitTicket = {
  readonly cueId: string;
  readonly gameId: string;
  readonly roomCode: string;
  readonly summary: RoomSummary;
  readonly viewerPlayerId: string | null;
};

export type ReconciledLiveDisplayCommit =
  | {
      readonly kind: "display";
      readonly summary: RoomSummary;
    }
  | {
      readonly kind: "defer";
      readonly ticket: LiveDisplayCommitTicket;
    };

export function getLiveDisplayCommitOwner(
  incomingCues: readonly LiveEffectCue[],
): LiveEffectCue | null {
  return incomingCues.at(-1) ?? null;
}

export function reconcileLiveDisplayCommit(
  currentTicket: LiveDisplayCommitTicket | null,
  summary: RoomSummary,
  ownerCue: LiveEffectCue | null,
  availableCues: readonly LiveEffectCue[],
  settleImmediately = false,
): ReconciledLiveDisplayCommit {
  if (settleImmediately) {
    return { kind: "display", summary };
  }

  if (ownerCue !== null) {
    return {
      kind: "defer",
      ticket: createLiveDisplayCommitTicket(summary, ownerCue),
    };
  }

  if (
    currentTicket !== null &&
    doesLiveDisplayCommitTicketMatchSummary(currentTicket, summary) &&
    availableCues.some((cue) => cue.id === currentTicket.cueId)
  ) {
    return {
      kind: "defer",
      ticket: { ...currentTicket, summary },
    };
  }

  return { kind: "display", summary };
}

export function resolveLiveDisplayCommit(
  ticket: LiveDisplayCommitTicket | null,
  activeCue: LiveEffectCue | null,
  acceptedSummary: RoomSummary | null,
): RoomSummary | null {
  if (
    ticket === null ||
    activeCue === null ||
    acceptedSummary === null ||
    ticket.cueId !== activeCue.id ||
    ticket.gameId !== activeCue.gameId ||
    ticket.roomCode !== activeCue.roomCode ||
    ticket.summary.snapshotRevision !== acceptedSummary.snapshotRevision ||
    !doesLiveDisplayCommitTicketMatchSummary(ticket, acceptedSummary)
  ) {
    return null;
  }

  return ticket.summary;
}

function createLiveDisplayCommitTicket(
  summary: RoomSummary,
  ownerCue: LiveEffectCue,
): LiveDisplayCommitTicket {
  return {
    cueId: ownerCue.id,
    gameId: ownerCue.gameId,
    roomCode: ownerCue.roomCode,
    summary,
    viewerPlayerId: summary.currentPlayerId,
  };
}

function doesLiveDisplayCommitTicketMatchSummary(
  ticket: LiveDisplayCommitTicket,
  summary: RoomSummary,
): boolean {
  const identity = getLiveGameSessionIdentity(summary);

  return (
    ticket.roomCode === identity.roomCode &&
    ticket.viewerPlayerId === identity.viewerPlayerId &&
    ticket.gameId === identity.gameId
  );
}
