"use client";

import { useRef } from "react";

import { gsap, useGSAP } from "../liveGsap";
import { useDocumentHidden } from "../useDocumentHidden";
import { usePrefersReducedMotion } from "../usePrefersReducedMotion";
import {
  createLiveEventLogMotionState,
  getLiveEventLogMotionSnapshotKey,
  reconcileLiveEventLogMotion,
  type LiveEventLogMotionSnapshot,
} from "./liveEventLogMotionModel";

import type { RefObject } from "react";

export function useLiveEventLogMotion(
  rootRef: RefObject<HTMLOListElement | null>,
  snapshot: LiveEventLogMotionSnapshot,
): void {
  const motionStateRef = useRef(createLiveEventLogMotionState());
  const reducedMotion = usePrefersReducedMotion();
  const isDocumentHidden = useDocumentHidden();
  const snapshotKey = getLiveEventLogMotionSnapshotKey(snapshot);

  useGSAP(
    () => {
      const root = rootRef.current;
      const reconciliation = reconcileLiveEventLogMotion(
        motionStateRef.current,
        snapshot,
        !reducedMotion && !isDocumentHidden,
      );

      motionStateRef.current = reconciliation.state;
      const addedEventIds = reconciliation.animatedEventIds;

      if (root === null || addedEventIds.length === 0) {
        return;
      }

      const addedIdSet = new Set(addedEventIds);
      const targets = gsap.utils
        .toArray<HTMLElement>("[data-live-event-id]", root)
        .filter((row) => {
          const eventId = row.dataset["liveEventId"];

          return eventId !== undefined && addedIdSet.has(eventId);
        });

      if (targets.length === 0) {
        return;
      }

      root.dataset["liveEventLogMotionCount"] = String(targets.length);

      for (const target of targets) {
        target.dataset["liveEventLogMotion"] = "new";
      }

      const timeline = gsap.timeline({
        defaults: { overwrite: "auto" },
        onComplete: () => clearEventLogMotion(root, targets),
      });

      timeline.fromTo(
        targets,
        { opacity: 0, willChange: "transform, opacity", y: 10 },
        {
          duration: 0.38,
          ease: "power2.out",
          opacity: 1,
          stagger: 0.055,
          y: 0,
        },
      );

      return () => {
        timeline.kill();
        clearEventLogMotion(root, targets);
      };
    },
    {
      dependencies: [isDocumentHidden, reducedMotion, snapshotKey],
      scope: rootRef,
    },
  );
}

function clearEventLogMotion(root: HTMLElement, targets: readonly HTMLElement[]): void {
  gsap.set(targets, { clearProps: "opacity,transform,willChange" });
  delete root.dataset["liveEventLogMotionCount"];

  for (const target of targets) {
    delete target.dataset["liveEventLogMotion"];

    if (target.getAttribute("style") === "") {
      target.removeAttribute("style");
    }
  }
}
