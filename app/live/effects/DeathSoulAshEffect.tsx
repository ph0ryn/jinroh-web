"use client";

import { useRef } from "react";

import { SoulFeatherIcon } from "./liveEffectIcons";
import styles from "./liveEffects.module.css";
import { gsap, useGSAP } from "./liveGsap";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

import type { LiveEffectCue } from "./liveEffectCues";
import type { RefObject } from "react";

type DeathSoulAshEffectProps = {
  readonly cue: Extract<LiveEffectCue, { readonly kind: "death" }>;
  readonly kicker: string;
  readonly message: string;
  readonly onComplete: () => void;
  readonly onDisplayCommit: () => void;
  readonly shellRef: RefObject<HTMLElement | null>;
};

type SoulTarget = {
  readonly avatar: HTMLElement;
  readonly rect: DOMRect;
  readonly seat: HTMLElement;
  readonly soul: HTMLElement;
};

export function DeathSoulAshEffect({
  cue,
  kicker,
  message,
  onComplete,
  onDisplayCommit,
  shellRef,
}: DeathSoulAshEffectProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  useGSAP(
    () => {
      const root = rootRef.current;

      if (root === null) {
        return;
      }

      const card = root.querySelector<HTMLElement>("[data-effect-death-card]");
      const timeline = gsap.timeline({ onComplete });

      if (reducedMotion) {
        timeline
          .set(root, { opacity: 0 })
          .set(card, { clearProps: "all" })
          .to(root, { duration: 0.16, ease: "power1.out", opacity: 1 })
          .call(onDisplayCommit, undefined, "+=1.15")
          .to(root, { duration: 0.16, ease: "power1.in", opacity: 0 });

        return () => timeline.kill();
      }

      const souls = Array.from(root.querySelectorAll<HTMLElement>("[data-effect-soul]"));
      const seats = Array.from(
        shellRef.current?.querySelectorAll<HTMLElement>("[data-live-player-id]") ?? [],
      );
      const targets = cue.playerIds.flatMap((playerId, index): SoulTarget[] => {
        const seat = seats.find((candidate) => candidate.dataset["livePlayerId"] === playerId);
        const soul = souls[index];
        const avatar = seat?.querySelector<HTMLElement>("[data-live-seat-avatar]");

        if (seat === undefined || soul === undefined || avatar === null || avatar === undefined) {
          return [];
        }

        return [{ avatar, rect: avatar.getBoundingClientRect(), seat, soul }];
      });

      for (const { rect, soul } of targets) {
        gsap.set(soul, {
          x: rect.left + rect.width / 2 - 14,
          y: rect.top + rect.height / 2 - 21,
        });
      }

      timeline
        .set(root, { opacity: 0 })
        .to(root, { duration: 0.18, ease: "power2.out", opacity: 1 }, 0)
        .fromTo(
          card,
          { autoAlpha: 0, filter: "blur(8px)", y: 28 },
          { autoAlpha: 1, duration: 0.72, ease: "power3.out", filter: "blur(0px)", y: 0 },
          0.4,
        );

      targets.forEach(({ avatar, seat, soul }, index) => {
        const startAt = 0.42 + index * 0.18;
        const drift = index % 2 === 0 ? 10 : -10;

        timeline
          .fromTo(
            seat,
            {
              borderColor: "rgba(220, 235, 225, 0.82)",
              boxShadow: "0 0 30px rgba(205, 235, 220, 0.46)",
            },
            {
              borderColor: "rgba(167, 71, 61, 0.72)",
              boxShadow: "0 0 0 rgba(0, 0, 0, 0)",
              duration: 0.82,
              ease: "power2.inOut",
            },
            startAt,
          )
          .fromTo(
            soul,
            { autoAlpha: 0, scale: 0.55, x: `-=${drift / 2}`, y: "+=12" },
            {
              autoAlpha: 0.82,
              duration: 0.42,
              ease: "power2.out",
              scale: 1,
              x: `+=${drift / 2}`,
              y: "-=24",
            },
            startAt + 0.08,
          )
          .to(
            soul,
            {
              autoAlpha: 0,
              duration: 1.05,
              ease: "power1.in",
              scale: 1.22,
              x: `+=${drift}`,
              y: "-=88",
            },
            startAt + 0.34,
          )
          .fromTo(
            avatar,
            { filter: "grayscale(0) brightness(1)", opacity: 1, scale: 1 },
            {
              duration: 0.76,
              ease: "power2.inOut",
              filter: "grayscale(0.55) brightness(0.72)",
              opacity: 0.68,
              scale: 0.9,
            },
            startAt + 0.24,
          );
      });

      timeline
        .call(onDisplayCommit, undefined, "+=1.05")
        .to(root, { duration: 0.5, ease: "power2.inOut", opacity: 0 });

      return () => timeline.kill();
    },
    { dependencies: [cue.id, reducedMotion], revertOnUpdate: true, scope: rootRef },
  );

  return (
    <div
      aria-hidden="true"
      className={`${styles["stage"]} ${styles["deathStage"]}`}
      data-live-effect="death"
      ref={rootRef}
    >
      {reducedMotion
        ? null
        : cue.playerIds.map((playerId) => (
            <span className={styles["soul"]} data-effect-soul key={playerId} />
          ))}
      <div className={styles["deathCard"]} data-effect-death-card>
        <div className={styles["deathIconFrame"]}>
          <SoulFeatherIcon className={styles["deathIcon"]} />
        </div>
        <div>
          <span className={styles["deathKicker"]}>{kicker}</span>
          <p className={styles["deathTitle"]}>{message}</p>
        </div>
      </div>
    </div>
  );
}
