"use client";

import { useEffect, useRef, useState } from "react";

import { gsap, useGSAP } from "../liveGsap";
import { usePrefersReducedMotion } from "../usePrefersReducedMotion";

import type { RefObject } from "react";

export type LiveModalPhase = "entered" | "entering" | "exited" | "exiting";
export type LiveModalVariant = "popup" | "settings";

type LiveModalPresence = {
  readonly phase: LiveModalPhase;
  readonly rootRef: RefObject<HTMLDivElement | null>;
  readonly shouldRender: boolean;
};

type GsapTimeline = ReturnType<typeof gsap.timeline>;

type UseLiveModalPresenceOptions = {
  readonly isOpen: boolean;
  readonly onExitComplete?: () => void;
  readonly variant: LiveModalVariant;
};

const MODAL_MOTION_OFFSETS: Record<
  LiveModalVariant,
  { readonly entryY: number; readonly exitY: number }
> = {
  popup: { entryY: 20, exitY: 12 },
  settings: { entryY: 14, exitY: 10 },
};

export function useLiveModalPresence({
  isOpen,
  onExitComplete,
  variant,
}: UseLiveModalPresenceOptions): LiveModalPresence {
  const rootRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<GsapTimeline | null>(null);
  const hasActiveSurfaceRef = useRef(false);
  const phaseRef = useRef<LiveModalPhase>(isOpen ? "entering" : "exited");
  const onExitCompleteRef = useRef(onExitComplete);
  const [phase, setPhase] = useState<LiveModalPhase>(isOpen ? "entering" : "exited");
  const reducedMotion = usePrefersReducedMotion();
  const shouldRender = isOpen || phase !== "exited";

  useEffect(() => {
    onExitCompleteRef.current = onExitComplete;
  }, [onExitComplete]);

  useGSAP(
    () => {
      timelineRef.current?.kill();
      timelineRef.current = null;

      if (!shouldRender) {
        return;
      }

      const root = rootRef.current;
      const dialog = root?.querySelector<HTMLElement>("[data-live-modal-dialog]") ?? null;

      if (root === null || dialog === null) {
        return;
      }

      if (isOpen) {
        if (phaseRef.current === "entered" && hasActiveSurfaceRef.current) {
          clearModalMotionProperties([root, dialog]);
          delete root.dataset["liveModalMotionKind"];
          return;
        }

        const isFreshSurface = !hasActiveSurfaceRef.current;

        hasActiveSurfaceRef.current = true;
        updatePhase("entering", phaseRef, setPhase);
        root.dataset["liveModalMotionKind"] = "enter";

        if (reducedMotion) {
          const timeline = gsap.timeline({
            onComplete: () => {
              clearModalMotionProperties([root, dialog]);
              delete root.dataset["liveModalMotionKind"];
              timelineRef.current = null;
              updatePhase("entered", phaseRef, setPhase);
            },
            paused: true,
          });

          timeline.set(root, { opacity: 1 }).set(dialog, { opacity: 1, y: 0 }, 0);
          timelineRef.current = timeline;
          timeline.totalProgress(1);
          return;
        }

        if (isFreshSurface) {
          gsap.set(root, { opacity: 0, willChange: "opacity" });
          gsap.set(dialog, {
            opacity: 0,
            willChange: "transform, opacity",
            y: MODAL_MOTION_OFFSETS[variant].entryY,
          });
        } else {
          gsap.set(root, { willChange: "opacity" });
          gsap.set(dialog, { willChange: "transform, opacity" });
        }

        const timeline = gsap.timeline({
          defaults: { overwrite: "auto" },
          onComplete: () => {
            clearModalMotionProperties([root, dialog]);
            delete root.dataset["liveModalMotionKind"];
            timelineRef.current = null;
            updatePhase("entered", phaseRef, setPhase);
          },
        });

        timeline
          .to(root, { duration: 0.22, ease: "power2.out", opacity: 1 }, 0)
          .to(dialog, { duration: 0.34, ease: "power3.out", opacity: 1, y: 0 }, 0.025);
        timelineRef.current = timeline;
        return;
      }

      updatePhase("exiting", phaseRef, setPhase);
      root.dataset["liveModalMotionKind"] = "exit";

      if (reducedMotion) {
        const timeline = gsap.timeline({
          onComplete: () => {
            clearModalMotionProperties([root, dialog]);
            delete root.dataset["liveModalMotionKind"];
            timelineRef.current = null;
            hasActiveSurfaceRef.current = false;
            updatePhase("exited", phaseRef, setPhase);
            onExitCompleteRef.current?.();
          },
          paused: true,
        });

        timeline.set(dialog, { opacity: 0 }).set(root, { opacity: 0 }, 0);
        timelineRef.current = timeline;
        timeline.totalProgress(1);
        return;
      }

      const timeline = gsap.timeline({
        defaults: { overwrite: "auto" },
        onComplete: () => {
          delete root.dataset["liveModalMotionKind"];
          timelineRef.current = null;
          hasActiveSurfaceRef.current = false;
          updatePhase("exited", phaseRef, setPhase);
          onExitCompleteRef.current?.();
        },
      });

      timeline
        .to(
          dialog,
          {
            duration: 0.22,
            ease: "power2.in",
            opacity: 0,
            willChange: "transform, opacity",
            y: MODAL_MOTION_OFFSETS[variant].exitY,
          },
          0,
        )
        .to(root, { duration: 0.18, ease: "power1.in", opacity: 0, willChange: "opacity" }, 0.04);
      timelineRef.current = timeline;
    },
    {
      dependencies: [isOpen, reducedMotion, shouldRender, variant],
      scope: rootRef,
    },
  );

  return { phase, rootRef, shouldRender };
}

function updatePhase(
  nextPhase: LiveModalPhase,
  phaseRef: { current: LiveModalPhase },
  setPhase: (phase: LiveModalPhase) => void,
): void {
  phaseRef.current = nextPhase;
  setPhase(nextPhase);
}

function clearModalMotionProperties(elements: readonly HTMLElement[]): void {
  gsap.set(elements, {
    clearProps: "opacity,transform,will-change",
  });
}
