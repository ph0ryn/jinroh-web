"use client";

import { useRef } from "react";

import { gsap, useGSAP } from "../liveGsap";
import { useDocumentHidden } from "../useDocumentHidden";
import { usePrefersReducedMotion } from "../usePrefersReducedMotion";
import {
  createLiveListAdditionMotionState,
  getLiveListAdditionMotionSnapshotKey,
  reconcileLiveListAdditionMotion,
  type LiveListAdditionMotionSnapshot,
} from "./liveListAdditionMotionModel";

import type { RefObject } from "react";

type UseLiveListAdditionMotionOptions = LiveListAdditionMotionSnapshot & {
  readonly motionKind: "event" | "message";
};

export function useLiveListAdditionMotion(
  rootRef: RefObject<HTMLOListElement | null>,
  options: UseLiveListAdditionMotionOptions,
): void {
  const motionStateRef = useRef(createLiveListAdditionMotionState());
  const reducedMotion = usePrefersReducedMotion();
  const isDocumentHidden = useDocumentHidden();
  const snapshot: LiveListAdditionMotionSnapshot = {
    isObscured: options.isObscured,
    isOpen: options.isOpen,
    itemIds: options.itemIds,
    sessionKey: options.sessionKey,
  };
  const snapshotKey = getLiveListAdditionMotionSnapshotKey(snapshot);

  useGSAP(
    () => {
      const root = rootRef.current;
      const reconciliation = reconcileLiveListAdditionMotion(
        motionStateRef.current,
        snapshot,
        !reducedMotion && !isDocumentHidden,
      );

      motionStateRef.current = reconciliation.state;

      if (root === null || reconciliation.animatedItemIds.length === 0) {
        return;
      }

      const addedIdSet = new Set(reconciliation.animatedItemIds);
      const targets = gsap.utils
        .toArray<HTMLElement>("[data-live-list-item-id]", root)
        .filter((row) => {
          const itemId = row.dataset["liveListItemId"];

          return itemId !== undefined && addedIdSet.has(itemId);
        });

      if (targets.length === 0) {
        return;
      }

      root.dataset["liveListMotionCount"] = String(targets.length);
      root.dataset["liveListMotionKind"] = options.motionKind;

      for (const target of targets) {
        target.dataset["liveListItemMotion"] = "new";
      }

      const timeline = gsap.timeline({
        defaults: { overwrite: "auto" },
        onComplete: () => clearListAdditionMotion(root, targets),
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
        clearListAdditionMotion(root, targets);
      };
    },
    {
      dependencies: [isDocumentHidden, options.motionKind, reducedMotion, snapshotKey],
      scope: rootRef,
    },
  );
}

function clearListAdditionMotion(root: HTMLElement, targets: readonly HTMLElement[]): void {
  gsap.set(targets, { clearProps: "opacity,transform,willChange" });
  delete root.dataset["liveListMotionCount"];
  delete root.dataset["liveListMotionKind"];

  for (const target of targets) {
    delete target.dataset["liveListItemMotion"];

    if (target.getAttribute("style") === "") {
      target.removeAttribute("style");
    }
  }
}
