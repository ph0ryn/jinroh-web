"use client";

import { useRef } from "react";

import sharedStyles from "./liveEffects.module.css";
import { gsap, useGSAP } from "./liveGsap";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import styles from "./voteVerdictLedgerEffect.module.css";

import type { LiveVoteEffectCue } from "./liveEffectCues";
import type { Localization } from "@/lib/i18n/localization";
import type { PublicPlayer } from "@/lib/shared/game";
import type { CSSProperties } from "react";

type VoteVerdictLedgerEffectProps = {
  readonly cue: LiveVoteEffectCue;
  readonly onComplete: () => void;
  readonly players: readonly PublicPlayer[];
  readonly t: Localization;
};

export function VoteVerdictLedgerEffect({
  cue,
  onComplete,
  players,
  t,
}: VoteVerdictLedgerEffectProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const playersById = new Map(players.map((player) => [player.id, player]));
  const maxVotes = Math.max(1, ...cue.rows.map((row) => row.count));
  const outcome = getOutcomePresentation(cue, playersById, t);

  useGSAP(
    () => {
      const root = rootRef.current;

      if (root === null) {
        return;
      }

      const panel = root.querySelector<HTMLElement>("[data-effect-vote-panel]");
      const rows = gsap.utils.toArray<HTMLElement>("[data-effect-vote-row]", root);
      const meters = gsap.utils.toArray<HTMLElement>("[data-effect-vote-meter]", root);
      const counters = gsap.utils.toArray<HTMLElement>("[data-effect-vote-count]", root);
      const footer = root.querySelector<HTMLElement>("[data-effect-vote-footer]");
      const seal = root.querySelector<HTMLElement>("[data-effect-vote-seal]");
      const timeline = gsap.timeline({ onComplete });

      counters.forEach((counter) => {
        counter.textContent = "0";
      });

      if (reducedMotion) {
        counters.forEach(setCounterToFinalValue);
        timeline
          .set(root, { autoAlpha: 0 })
          .set([panel, ...rows, ...meters, footer, seal], { clearProps: "all" })
          .to(root, { autoAlpha: 1, duration: 0.16, ease: "power1.out" })
          .to(root, { autoAlpha: 0, duration: 0.16, ease: "power1.in" }, "+=1.25");

        return () => timeline.kill();
      }

      timeline
        .set(root, { autoAlpha: 0 })
        .set(meters, { scaleX: 0, transformOrigin: "0 50%" })
        .to(root, { autoAlpha: 1, duration: 0.24, ease: "power2.out" }, 0)
        .fromTo(
          panel,
          { autoAlpha: 0, rotationY: -5, transformOrigin: "100% 50%", x: 84 },
          {
            autoAlpha: 1,
            duration: 0.62,
            ease: "power4.out",
            rotationY: 0,
            x: 0,
          },
          0.05,
        )
        .fromTo(
          rows,
          { autoAlpha: 0, x: 24 },
          { autoAlpha: 1, duration: 0.32, ease: "power2.out", stagger: 0.075, x: 0 },
          0.34,
        )
        .to(
          meters,
          {
            duration: 0.58,
            ease: "power3.out",
            scaleX: (index, meter: HTMLElement) => {
              void index;
              return Number(meter.dataset["scale"] ?? 1);
            },
            stagger: 0.065,
          },
          0.55,
        );

      counters.forEach((counter, index) => {
        const target = Number(counter.dataset["count"] ?? 0);
        const countState = { value: 0 };

        timeline.to(
          countState,
          {
            duration: 0.5,
            ease: "power2.out",
            onComplete: () => setCounterToFinalValue(counter),
            onUpdate: () => {
              counter.textContent = String(Math.round(countState.value));
            },
            value: target,
          },
          0.54 + index * 0.065,
        );
      });

      timeline
        .fromTo(
          footer,
          { autoAlpha: 0, y: 20 },
          { autoAlpha: 1, duration: 0.42, ease: "power3.out", y: 0 },
          1.02,
        )
        .fromTo(
          seal,
          { autoAlpha: 0, rotation: -18, scale: 2.2 },
          {
            autoAlpha: 1,
            duration: 0.42,
            ease: "back.out(2.2)",
            rotation: -6,
            scale: 1,
          },
          1.18,
        )
        .to(root, { autoAlpha: 0, duration: 0.42, ease: "power2.in" }, "+=1.05");

      return () => timeline.kill();
    },
    { dependencies: [cue.id, reducedMotion], revertOnUpdate: true, scope: rootRef },
  );

  return (
    <div
      aria-hidden="true"
      className={`${sharedStyles["stage"]} ${styles["stage"]}`}
      data-live-effect="vote"
      data-vote-outcome={cue.outcome.kind}
      ref={rootRef}
    >
      <div className={styles["scrim"]} />
      <section className={styles["panel"]} data-effect-vote-panel>
        <header className={styles["header"]}>
          <div>
            <span>{t.live.effects.vote.header(cue.dayNumber)}</span>
            <strong>{t.live.effects.vote.title}</strong>
          </div>
          <BalanceIcon className={styles["balance"]} />
        </header>

        <div className={styles["rule"]} />

        <div
          className={styles["rows"]}
          data-compact={cue.rows.length >= 8 ? "true" : "false"}
          data-effect-vote-rows
        >
          {cue.rows.length === 0 ? (
            <div className={styles["empty"]}>{t.live.effects.vote.ballotDetails.noVotes}</div>
          ) : (
            cue.rows.map((row, index) => {
              const player = playersById.get(row.playerId);
              const rowResult = getRowResult(cue, row.playerId);
              const rank = getVoteRank(cue.rows, index);

              return (
                <article
                  className={styles["row"]}
                  data-effect-vote-row
                  data-vote-row-result={rowResult}
                  key={row.playerId}
                >
                  <span className={styles["rank"]}>{String(rank).padStart(2, "0")}</span>
                  <div className={styles["person"]}>
                    <strong>{player?.displayName ?? t.game.seatStatus.player}</strong>
                    <small>{getBallotDetail(row.voterPlayerIds, playersById, t)}</small>
                  </div>
                  <div className={styles["meter"]}>
                    <i
                      data-scale={row.count / maxVotes}
                      data-effect-vote-meter
                      style={{ "--vote-meter-scale": row.count / maxVotes } as CSSProperties}
                    />
                  </div>
                  <b data-count={row.count} data-effect-vote-count>
                    0
                  </b>
                </article>
              );
            })
          )}
        </div>

        <footer className={styles["footer"]} data-effect-vote-footer>
          <div className={styles["outcome"]}>
            <span>{outcome.kicker}</span>
            <strong>{outcome.title}</strong>
            <small>{outcome.body}</small>
          </div>
          <div
            className={styles["seal"]}
            data-effect-vote-seal
            data-vote-seal-tone={cue.outcome.kind}
          >
            <span>{outcome.seal}</span>
          </div>
        </footer>
      </section>
    </div>
  );
}

function setCounterToFinalValue(counter: HTMLElement): void {
  counter.textContent = counter.dataset["count"] ?? "0";
}

function getVoteRank(rows: LiveVoteEffectCue["rows"], index: number): number {
  const row = rows[index];

  if (row === undefined) {
    return index + 1;
  }

  return rows.findIndex((candidate) => candidate.count === row.count) + 1;
}

function getRowResult(cue: LiveVoteEffectCue, playerId: string): "candidate" | "normal" | "tied" {
  if (cue.outcome.kind === "candidate" && cue.outcome.playerId === playerId) {
    return "candidate";
  }

  return cue.outcome.kind === "tie" && cue.outcome.playerIds.includes(playerId) ? "tied" : "normal";
}

function getBallotDetail(
  voterPlayerIds: readonly string[] | null,
  playersById: ReadonlyMap<string, PublicPlayer>,
  t: Localization,
): string {
  if (voterPlayerIds === null) {
    return t.live.effects.vote.ballotDetails.sealed;
  }

  if (voterPlayerIds.length === 0) {
    return t.live.effects.vote.ballotDetails.noVotes;
  }

  return voterPlayerIds
    .map((playerId) => playersById.get(playerId)?.displayName ?? t.game.seatStatus.player)
    .join(" · ");
}

function getOutcomePresentation(
  cue: LiveVoteEffectCue,
  playersById: ReadonlyMap<string, PublicPlayer>,
  t: Localization,
): {
  readonly body: string;
  readonly kicker: string;
  readonly seal: string;
  readonly title: string;
} {
  switch (cue.outcome.kind) {
    case "candidate":
      return {
        body: t.live.effects.vote.outcome.candidateBody(cue.outcome.voteCount),
        kicker: t.live.effects.vote.outcome.candidateKicker,
        seal: t.live.effects.vote.seal.candidate,
        title: playersById.get(cue.outcome.playerId)?.displayName ?? t.game.seatStatus.player,
      };
    case "no_votes":
      return {
        body: t.live.effects.vote.outcome.noVotesBody,
        kicker: t.live.effects.vote.outcome.noVotesKicker,
        seal: t.live.effects.vote.seal.noVotes,
        title: t.live.effects.vote.outcome.noCandidate,
      };
    case "tie":
      return {
        body: t.live.effects.vote.outcome.tieBody(cue.outcome.voteCount),
        kicker: t.live.effects.vote.outcome.tieKicker,
        seal: t.live.effects.vote.seal.tie,
        title: t.live.effects.vote.outcome.noCandidate,
      };
  }
}

function BalanceIcon({ className }: { readonly className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 48 48">
      <path d="M24 7v31M13 12h22M9 40h30M16 38h16" />
      <path d="m13 12-7 14h14L13 12Zm22 0-7 14h14L35 12Z" />
      <path d="M6 26c1 5 13 5 14 0M28 26c1 5 13 5 14 0" />
    </svg>
  );
}
