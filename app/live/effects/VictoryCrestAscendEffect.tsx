"use client";

import { useRef } from "react";

import { VictoryCrestIcon } from "./liveEffectIcons";
import styles from "./liveEffects.module.css";
import { gsap, useGSAP } from "./liveGsap";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

import type { LiveEffectCue } from "./liveEffectCues";

type VictoryCrestAscendEffectProps = {
  readonly cue: Extract<LiveEffectCue, { readonly kind: "victory" }>;
  readonly kicker: string;
  readonly onComplete: () => void;
  readonly result: string | null;
  readonly subtitle: string;
  readonly title: string;
};

export function VictoryCrestAscendEffect({
  cue,
  kicker,
  onComplete,
  result,
  subtitle,
  title,
}: VictoryCrestAscendEffectProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  useGSAP(
    () => {
      const root = rootRef.current;

      if (root === null) {
        return;
      }

      const emblem = root.querySelector<HTMLElement>("[data-effect-victory-emblem]");
      const rings = root.querySelectorAll<HTMLElement>("[data-effect-victory-ring]");
      const copy = root.querySelectorAll<HTMLElement>("[data-effect-victory-copy]");
      const staticElements = [...(emblem === null ? [] : [emblem]), ...rings, ...copy];
      const timeline = gsap.timeline({ onComplete });

      if (reducedMotion) {
        timeline
          .set(root, { autoAlpha: 0 })
          .set(staticElements, { clearProps: "all" })
          .to(root, { autoAlpha: 1, duration: 0.16, ease: "power1.out" })
          .to(root, { autoAlpha: 0, duration: 0.16, ease: "power1.in" }, "+=1.45");

        return () => timeline.kill();
      }

      timeline
        .set(root, { autoAlpha: 0 })
        .to(root, { autoAlpha: 1, duration: 0.24, ease: "power2.out" }, 0)
        .fromTo(
          emblem,
          { autoAlpha: 0, filter: "blur(14px)", rotate: -42, scale: 0.34, y: 88 },
          {
            autoAlpha: 1,
            duration: 1.28,
            ease: "expo.out",
            filter: "blur(0px)",
            rotate: 0,
            scale: 1,
            y: 0,
          },
          0.18,
        )
        .fromTo(
          rings,
          { autoAlpha: 0, rotate: -50, scale: 0.7 },
          { autoAlpha: 1, duration: 0.9, ease: "expo.out", rotate: 0, scale: 1, stagger: 0.12 },
          0.58,
        )
        .fromTo(
          copy,
          { autoAlpha: 0, filter: "blur(8px)", y: 24 },
          {
            autoAlpha: 1,
            duration: 0.66,
            ease: "power3.out",
            filter: "blur(0px)",
            stagger: 0.13,
            y: 0,
          },
          0.9,
        )
        .to(emblem, { duration: 1.1, ease: "sine.inOut", repeat: 1, scale: 1.06, yoyo: true }, 1.65)
        .to(rings, { duration: 2.2, ease: "none", rotate: 28, stagger: 0.08 }, 1.2)
        .to(root, { autoAlpha: 0, duration: 0.54, ease: "power2.inOut" }, 4.2);

      return () => timeline.kill();
    },
    { dependencies: [cue.id, reducedMotion], revertOnUpdate: true, scope: rootRef },
  );

  return (
    <div
      aria-hidden="true"
      className={`${styles["stage"]} ${styles["victoryStage"]}`}
      data-effect-victory-particles="none"
      data-live-effect="victory"
      ref={rootRef}
    >
      <div className={styles["victory"]}>
        <div className={styles["crestFrame"]} data-effect-victory-emblem>
          <span className={styles["crestRing"]} data-effect-victory-ring />
          <span className={styles["crestRing"]} data-effect-victory-ring />
          <VictoryCrestIcon className={styles["crestIcon"]} />
        </div>
        <span className={styles["victoryKicker"]} data-effect-victory-copy>
          {kicker}
        </span>
        <h2 className={styles["victoryTitle"]} data-effect-victory-copy>
          {title}
        </h2>
        <p className={styles["victorySub"]} data-effect-victory-copy>
          {subtitle}
        </p>
        {result === null ? null : (
          <strong className={styles["victoryResult"]} data-effect-victory-copy>
            {result}
          </strong>
        )}
      </div>
    </div>
  );
}
