"use client";

import { useRef } from "react";

import { gsap, useGSAP } from "../liveGsap";
import { useDocumentHidden } from "../useDocumentHidden";
import { usePrefersReducedMotion } from "../usePrefersReducedMotion";
import {
  getLiveSetupTransitionSnapshotKey,
  reconcileLiveSetupTransition,
  type LiveSetupTransitionSnapshot,
} from "./liveSetupTransitionModel";

import type { RefObject } from "react";

type LiveSetupTransitionControllerProps = {
  readonly rootRef: RefObject<HTMLElement | null>;
  readonly snapshot: LiveSetupTransitionSnapshot;
};

export function LiveSetupTransitionController({
  rootRef,
  snapshot,
}: LiveSetupTransitionControllerProps) {
  const previousSnapshotRef = useRef<LiveSetupTransitionSnapshot | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const isDocumentHidden = useDocumentHidden();
  const snapshotKey = getLiveSetupTransitionSnapshotKey(snapshot);

  useGSAP(
    () => {
      const root = rootRef.current;
      const previousSnapshot = previousSnapshotRef.current;
      const transition = reconcileLiveSetupTransition(
        previousSnapshot,
        snapshot,
        !reducedMotion && !isDocumentHidden,
      );

      previousSnapshotRef.current = snapshot;

      if (root === null) {
        return;
      }

      delete root.dataset["liveSetupMotionKind"];

      if (transition === null) {
        return;
      }

      const targets = gsap.utils.toArray<HTMLElement>(
        `[data-live-setup-transition-item="${transition}"]`,
        root,
      );

      if (targets.length === 0) {
        return;
      }

      root.dataset["liveSetupMotionKind"] = transition;
      const timeline = gsap.timeline({
        defaults: { overwrite: "auto" },
        onComplete: () => {
          clearSetupTransitionProperties(targets);
          delete root.dataset["liveSetupMotionKind"];
        },
      });

      timeline.fromTo(
        targets,
        { opacity: 0, willChange: "transform, opacity", y: 12 },
        {
          duration: 0.56,
          ease: "power3.out",
          opacity: 1,
          stagger: 0.075,
          y: 0,
        },
      );

      return () => {
        timeline.kill();
        clearSetupTransitionProperties(targets);
        delete root.dataset["liveSetupMotionKind"];
      };
    },
    {
      dependencies: [isDocumentHidden, reducedMotion, snapshotKey],
      scope: rootRef,
    },
  );

  return null;
}

function clearSetupTransitionProperties(targets: readonly HTMLElement[]): void {
  gsap.set(targets, { clearProps: "opacity,transform,willChange" });

  for (const target of targets) {
    if (target.getAttribute("style") === "") {
      target.removeAttribute("style");
    }
  }
}
