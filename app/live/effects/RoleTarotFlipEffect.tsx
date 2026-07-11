"use client";

import { useRef } from "react";

import styles from "./liveEffects.module.css";
import { gsap, useGSAP } from "./liveGsap";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

import type { LiveEffectCue } from "./liveEffectCues";
import type { Localization } from "@/lib/i18n/localization";

type RoleTarotFlipEffectProps = {
  readonly cue: Extract<LiveEffectCue, { readonly kind: "role" }>;
  readonly onComplete: () => void;
  readonly role: Localization["game"]["catalog"]["unknown"]["role"];
  readonly t: Localization;
};

export function RoleTarotFlipEffect({ cue, onComplete, role, t }: RoleTarotFlipEffectProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  useGSAP(
    () => {
      const root = rootRef.current;

      if (root === null) {
        return;
      }

      const card = root.querySelector<HTMLElement>("[data-effect-role-card]");
      const corners = root.querySelectorAll<HTMLElement>("[data-effect-card-corner]");
      const sigil = root.querySelector<HTMLElement>("[data-effect-role-sigil]");
      const copy = root.querySelectorAll<HTMLElement>("[data-effect-role-copy]");
      const staticElements = [
        ...(card === null ? [] : [card]),
        ...corners,
        ...(sigil === null ? [] : [sigil]),
        ...copy,
      ];
      const timeline = gsap.timeline({ onComplete });

      if (reducedMotion) {
        timeline
          .set(root, { autoAlpha: 0 })
          .set(staticElements, { clearProps: "all" })
          .to(root, { autoAlpha: 1, duration: 0.16, ease: "power1.out" })
          .to(root, { autoAlpha: 0, duration: 0.16, ease: "power1.in" }, "+=1.35");

        return () => timeline.kill();
      }

      timeline
        .set(root, { autoAlpha: 0 })
        .to(root, { autoAlpha: 1, duration: 0.24, ease: "power2.out" }, 0)
        .set(card, { transformOrigin: "50% 50%", transformPerspective: 1200 })
        .fromTo(
          card,
          { autoAlpha: 0, filter: "blur(12px)", rotateY: 104, scale: 0.76, y: 48 },
          {
            autoAlpha: 1,
            duration: 1.18,
            ease: "expo.out",
            filter: "blur(0px)",
            rotateY: 0,
            scale: 1,
            y: 0,
          },
          0.08,
        )
        .fromTo(
          corners,
          { autoAlpha: 0, scale: 0 },
          { autoAlpha: 1, duration: 0.4, ease: "back.out(2)", scale: 1, stagger: 0.055 },
          0.62,
        )
        .fromTo(
          sigil,
          { autoAlpha: 0, filter: "blur(8px)", rotate: -18, scale: 0.42 },
          {
            autoAlpha: 1,
            duration: 0.66,
            ease: "back.out(1.7)",
            filter: "blur(0px)",
            rotate: 0,
            scale: 1,
          },
          0.74,
        )
        .fromTo(
          copy,
          { autoAlpha: 0, y: 16 },
          { autoAlpha: 1, duration: 0.46, ease: "power3.out", stagger: 0.11, y: 0 },
          1.02,
        )
        .to(
          sigil,
          {
            boxShadow: "0 0 76px rgba(242, 202, 121, 0.36)",
            duration: 0.68,
            ease: "sine.inOut",
            repeat: 1,
            scale: 1.07,
            yoyo: true,
          },
          1.35,
        )
        .to(
          card,
          { duration: 1.25, ease: "sine.inOut", repeat: 1, rotationZ: 0.5, y: -7, yoyo: true },
          1.8,
        )
        .to(root, { autoAlpha: 0, duration: 0.5, ease: "power2.inOut" }, 4.65);

      return () => timeline.kill();
    },
    { dependencies: [cue.id, reducedMotion], revertOnUpdate: true, scope: rootRef },
  );

  return (
    <div
      aria-hidden="true"
      className={`${styles["stage"]} ${styles["roleStage"]}`}
      data-live-effect="role"
      ref={rootRef}
    >
      <article className={styles["roleCard"]} data-effect-role-card>
        <i className={styles["cardCorner"]} data-effect-card-corner />
        <i className={styles["cardCorner"]} data-effect-card-corner />
        <i className={styles["cardCorner"]} data-effect-card-corner />
        <i className={styles["cardCorner"]} data-effect-card-corner />
        <small>{t.live.effects.role.assignment}</small>
        <div className={styles["roleMain"]}>
          <div className={styles["roleSigil"]} data-effect-role-sigil>
            {role.shortLabel}
          </div>
          <p className={styles["effectKicker"]} data-effect-role-copy>
            {t.live.effects.role.kicker}
          </p>
          <h2 className={styles["roleTitle"]} data-effect-role-copy>
            {role.name}
          </h2>
        </div>
        <p className={styles["roleDescription"]} data-effect-role-copy>
          {role.description}
        </p>
      </article>
    </div>
  );
}
