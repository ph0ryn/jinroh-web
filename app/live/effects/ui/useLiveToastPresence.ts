"use client";

import { useEffectEvent, useRef, useState } from "react";

import { gsap, useGSAP } from "../liveGsap";
import { usePrefersReducedMotion } from "../usePrefersReducedMotion";

import type { RefObject } from "react";

export type LiveToastVisualPhase = "entered" | "entering" | "exited" | "exiting";

type GsapTimeline = ReturnType<typeof gsap.timeline>;

type UseLiveToastPresenceOptions = {
  readonly isOpen: boolean;
  readonly onEntered: (toastId: number) => void;
  readonly onExited: (toastId: number) => void;
  readonly toastId: number;
};

type LiveToastPresence = {
  readonly phase: LiveToastVisualPhase;
  readonly rootRef: RefObject<HTMLDivElement | null>;
};

export function useLiveToastPresence({
  isOpen,
  onEntered,
  onExited,
  toastId,
}: UseLiveToastPresenceOptions): LiveToastPresence {
  const initialPhase: LiveToastVisualPhase = isOpen ? "entering" : "exited";
  const rootRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<GsapTimeline | null>(null);
  const phaseRef = useRef<LiveToastVisualPhase>(initialPhase);
  const activeToastIdRef = useRef<number | null>(null);
  const hasActiveSurfaceRef = useRef(false);
  const generationRef = useRef(0);
  const [phase, setPhase] = useState<LiveToastVisualPhase>(initialPhase);
  const reducedMotion = usePrefersReducedMotion();
  const handleEntered = useEffectEvent(onEntered);
  const handleExited = useEffectEvent(onExited);

  useGSAP(
    () => {
      timelineRef.current?.kill();
      timelineRef.current = null;
      const generation = (generationRef.current += 1);
      const root = rootRef.current;

      if (root === null) {
        return;
      }

      const content = [...root.querySelectorAll<HTMLElement>("[data-live-toast-content]")];
      const rail = root.querySelector<HTMLElement>("[data-live-toast-rail]");
      const sheen = root.querySelector<HTMLElement>("[data-live-toast-sheen]");
      const motionElements = [root, ...content, rail, sheen].filter(
        (element): element is HTMLElement => element !== null,
      );
      const previousToastId = activeToastIdRef.current;
      const isReplacement = isOpen && previousToastId !== null && previousToastId !== toastId;

      if (!isOpen && !hasActiveSurfaceRef.current && phaseRef.current === "exited") {
        clearToastMotionProperties(motionElements);
        delete root.dataset["liveToastMotionKind"];
        return;
      }

      if (
        isOpen &&
        previousToastId === toastId &&
        hasActiveSurfaceRef.current &&
        phaseRef.current === "entered"
      ) {
        clearToastMotionProperties(motionElements);
        delete root.dataset["liveToastMotionKind"];
        return;
      }

      if (isOpen) {
        const isFreshSurface = !hasActiveSurfaceRef.current;
        const isSameToastReversal =
          hasActiveSurfaceRef.current &&
          previousToastId === toastId &&
          phaseRef.current === "exiting";
        let motionKind: "enter" | "replace" | "resume" = "enter";

        if (isReplacement) {
          motionKind = "replace";
        } else if (isSameToastReversal) {
          motionKind = "resume";
        }

        activeToastIdRef.current = toastId;
        hasActiveSurfaceRef.current = true;
        updatePhase("entering", phaseRef, setPhase);
        root.dataset["liveToastMotionKind"] = motionKind;

        const timeline = createTimeline({
          generation,
          generationRef,
          onComplete: () => {
            clearToastMotionProperties(motionElements);
            delete root.dataset["liveToastMotionKind"];
            timelineRef.current = null;
            updatePhase("entered", phaseRef, setPhase);
            handleEntered(toastId);
          },
          paused: reducedMotion || document.visibilityState !== "visible",
        });

        if (reducedMotion || document.visibilityState !== "visible") {
          timeline.set(root, { opacity: 1, x: 0, y: 0 });

          if (content.length > 0) {
            timeline.set(content, { opacity: 1, y: 0 }, 0);
          }

          if (rail !== null) {
            timeline.set(rail, { opacity: 0, scaleY: 1 }, 0);
          }

          if (sheen !== null) {
            timeline.set(sheen, { opacity: 0, xPercent: 110 }, 0);
          }

          timelineRef.current = timeline;
          timeline.totalProgress(1);
          return;
        }

        if (isFreshSurface || isReplacement) {
          gsap.set(root, {
            opacity: 0,
            willChange: "transform, opacity",
            x: 24,
            y: -8,
          });
          gsap.set(content, { opacity: 0, willChange: "transform, opacity", y: -4 });

          if (rail !== null) {
            gsap.set(rail, {
              opacity: 0,
              scaleY: 0.25,
              transformOrigin: "50% 0%",
              willChange: "transform, opacity",
            });
          }

          if (sheen !== null) {
            gsap.set(sheen, {
              opacity: 0,
              willChange: "transform, opacity",
              xPercent: -110,
            });
          }
        } else {
          gsap.set(root, { willChange: "transform, opacity" });

          if (!isSameToastReversal) {
            gsap.set(content, { opacity: 0, willChange: "transform, opacity", y: -4 });
          }
        }

        timeline.to(root, { duration: 0.34, ease: "power3.out", opacity: 1, x: 0, y: 0 }, 0);

        if (content.length > 0 && !isSameToastReversal) {
          timeline.to(
            content,
            {
              duration: 0.2,
              ease: "power2.out",
              opacity: 1,
              stagger: 0.045,
              y: 0,
            },
            0.075,
          );
        }

        if ((isFreshSurface || isReplacement) && rail !== null) {
          timeline
            .to(rail, { duration: 0.16, ease: "power2.out", opacity: 0.9, scaleY: 1 }, 0.02)
            .to(rail, { duration: 0.18, ease: "power1.in", opacity: 0 }, 0.2);
        }

        if ((isFreshSurface || isReplacement) && sheen !== null) {
          timeline
            .to(sheen, { duration: 0.12, ease: "power1.out", opacity: 0.55 }, 0.06)
            .to(sheen, { duration: 0.34, ease: "power2.out", xPercent: 110 }, 0.06)
            .to(sheen, { duration: 0.12, ease: "power1.in", opacity: 0 }, 0.28);
        }

        timelineRef.current = timeline;
        return;
      }

      activeToastIdRef.current = toastId;
      updatePhase("exiting", phaseRef, setPhase);
      root.dataset["liveToastMotionKind"] = "exit";

      const timeline = createTimeline({
        generation,
        generationRef,
        onComplete: () => {
          delete root.dataset["liveToastMotionKind"];
          timelineRef.current = null;
          hasActiveSurfaceRef.current = false;
          updatePhase("exited", phaseRef, setPhase);
          handleExited(toastId);
        },
        paused: reducedMotion || document.visibilityState !== "visible",
      });

      if (reducedMotion || document.visibilityState !== "visible") {
        timeline.set(root, { opacity: 0, x: 18, y: -4 });
        timelineRef.current = timeline;
        timeline.totalProgress(1);
        return;
      }

      gsap.set(root, { willChange: "transform, opacity" });
      timeline.to(root, {
        duration: 0.18,
        ease: "power2.in",
        opacity: 0,
        x: 18,
        y: -4,
      });
      timelineRef.current = timeline;
    },
    {
      dependencies: [isOpen, reducedMotion, toastId],
      scope: rootRef,
    },
  );

  return { phase, rootRef };
}

function createTimeline({
  generation,
  generationRef,
  onComplete,
  paused,
}: {
  readonly generation: number;
  readonly generationRef: RefObject<number>;
  readonly onComplete: () => void;
  readonly paused: boolean;
}): GsapTimeline {
  return gsap.timeline({
    defaults: { overwrite: "auto" },
    onComplete: () => {
      if (generationRef.current === generation) {
        onComplete();
      }
    },
    paused,
  });
}

function updatePhase(
  nextPhase: LiveToastVisualPhase,
  phaseRef: { current: LiveToastVisualPhase },
  setPhase: (phase: LiveToastVisualPhase) => void,
): void {
  phaseRef.current = nextPhase;
  setPhase(nextPhase);
}

function clearToastMotionProperties(elements: readonly HTMLElement[]): void {
  if (elements.length === 0) {
    return;
  }

  gsap.set(elements, {
    clearProps: "opacity,transform,transformOrigin,willChange",
  });
}
