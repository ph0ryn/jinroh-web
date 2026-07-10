"use client";

import { useRef } from "react";

import styles from "./liveEffects.module.css";
import { gsap, useGSAP } from "./liveGsap";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

import type { LiveEffectCue } from "./liveEffectCues";

type PhaseChapterEffectProps = {
  readonly code: string;
  readonly cue: Extract<LiveEffectCue, { readonly kind: "phase" }>;
  readonly label: string;
  readonly onComplete: () => void;
  readonly title: string;
};

export function PhaseChapterEffect({
  code,
  cue,
  label,
  onComplete,
  title,
}: PhaseChapterEffectProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  useGSAP(
    () => {
      const root = rootRef.current;

      if (root === null) {
        return;
      }

      const diamond = root.querySelector<HTMLElement>("[data-effect-chapter-diamond]");
      const codeElement = root.querySelector<HTMLElement>("[data-effect-chapter-code]");
      const titleElement = root.querySelector<HTMLElement>("[data-effect-chapter-title]");
      const line = root.querySelector<HTMLElement>("[data-effect-chapter-line]");
      const labelElement = root.querySelector<HTMLElement>("[data-effect-chapter-label]");
      const staticElements = [diamond, codeElement, titleElement, line, labelElement].filter(
        (element): element is HTMLElement => element !== null,
      );
      const timeline = gsap.timeline({ onComplete });

      if (reducedMotion) {
        timeline
          .set(root, { autoAlpha: 0 })
          .set(staticElements, { clearProps: "all" })
          .to(root, { autoAlpha: 1, duration: 0.16, ease: "power1.out" })
          .to(root, { autoAlpha: 0, duration: 0.16, ease: "power1.in" }, "+=1.05");

        return () => timeline.kill();
      }

      timeline
        .set(root, { autoAlpha: 0 })
        .to(root, { autoAlpha: 1, duration: 0.2, ease: "power2.out" }, 0)
        .fromTo(
          diamond,
          { autoAlpha: 0, rotate: -135, scale: 0 },
          { autoAlpha: 1, duration: 0.65, ease: "back.out(2)", rotate: 45, scale: 1 },
          0.14,
        )
        .fromTo(codeElement, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, duration: 0.45, y: 0 }, 0.42)
        .fromTo(
          titleElement,
          { autoAlpha: 0, filter: "blur(8px)", y: 25 },
          { autoAlpha: 1, duration: 0.74, ease: "power3.out", filter: "blur(0px)", y: 0 },
          0.55,
        )
        .fromTo(
          line,
          { autoAlpha: 0, scaleX: 0 },
          { autoAlpha: 1, duration: 0.75, ease: "expo.out", scaleX: 1 },
          0.86,
        )
        .fromTo(labelElement, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, duration: 0.42, y: 0 }, 1.1)
        .to(diamond, { duration: 1.5, ease: "none", rotate: 225 }, 1.25)
        .to(root, { autoAlpha: 0, duration: 0.5, ease: "power2.inOut" }, 2.85);

      return () => timeline.kill();
    },
    { dependencies: [cue.id, reducedMotion], revertOnUpdate: true, scope: rootRef },
  );

  return (
    <div
      aria-hidden="true"
      className={`${styles["stage"]} ${styles["phaseStage"]}`}
      data-live-effect="phase"
      data-phase={cue.phase}
      ref={rootRef}
    >
      <div className={styles["chapter"]}>
        <i className={styles["chapterDiamond"]} data-effect-chapter-diamond />
        <small className={styles["chapterCode"]} data-effect-chapter-code>
          {code}
        </small>
        <h2 className={styles["chapterTitle"]} data-effect-chapter-title>
          {title}
        </h2>
        <div className={styles["chapterLine"]} data-effect-chapter-line />
        <p className={styles["chapterLabel"]} data-effect-chapter-label>
          {label}
        </p>
      </div>
    </div>
  );
}
