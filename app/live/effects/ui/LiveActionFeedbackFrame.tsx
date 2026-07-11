"use client";

import { useRef } from "react";

import { gsap, useGSAP } from "../liveGsap";
import { usePrefersReducedMotion } from "../usePrefersReducedMotion";
import styles from "./liveActionFeedback.module.css";

import type { ReactNode, RefObject } from "react";

export type LiveActionFeedbackState = "confirmed" | "idle" | "pending";

type LiveActionFeedbackFrameProps = {
  readonly actionKey: string;
  readonly actionKind: string;
  readonly actionStatus: "open" | "submitted";
  readonly announcement: string;
  readonly children: ReactNode;
  readonly className: string;
  readonly confirmationLabel: string;
  readonly feedbackId: string | null;
  readonly state: LiveActionFeedbackState;
  readonly onConfirmationComplete: (receiptId: string) => void;
};

export function LiveActionFeedbackFrame({
  actionKey,
  actionKind,
  actionStatus,
  announcement,
  children,
  className,
  confirmationLabel,
  feedbackId,
  state,
  onConfirmationComplete,
}: LiveActionFeedbackFrameProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useLiveActionFeedbackTimeline({
    feedbackId,
    onConfirmationComplete,
    rootRef,
    state,
  });

  return (
    <div
      aria-busy={state === "pending"}
      className={`${className} ${styles["frame"]}`}
      data-live-action-feedback-id={feedbackId ?? undefined}
      data-live-action-feedback-state={state}
      data-live-action-key={actionKey}
      data-live-action-kind={actionKind}
      data-live-action-status={actionStatus}
      ref={rootRef}
    >
      {children}
      <span aria-hidden="true" className={styles["motionLayer"]}>
        <span className={styles["progress"]} data-live-action-feedback-progress />
        <span className={styles["sweep"]} data-live-action-feedback-sweep />
        <span className={styles["confirmation"]} data-live-action-feedback-confirmation>
          <span className={styles["seal"]} data-live-action-feedback-seal>
            ✓
          </span>
          {confirmationLabel}
        </span>
      </span>
      {state === "confirmed" ? (
        <p className="srOnly" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>
      ) : null}
    </div>
  );
}

function useLiveActionFeedbackTimeline({
  feedbackId,
  onConfirmationComplete,
  rootRef,
  state,
}: {
  readonly feedbackId: string | null;
  readonly onConfirmationComplete: (receiptId: string) => void;
  readonly rootRef: RefObject<HTMLDivElement | null>;
  readonly state: LiveActionFeedbackState;
}): void {
  const reducedMotion = usePrefersReducedMotion();

  useGSAP(
    () => {
      const root = rootRef.current;

      if (root === null) {
        return;
      }

      delete root.dataset["liveActionFeedbackMotionKind"];

      if (state === "idle") {
        return;
      }

      if (reducedMotion || document.visibilityState !== "visible") {
        if (state === "confirmed" && feedbackId !== null) {
          onConfirmationComplete(feedbackId);
        }

        return;
      }

      const button = root.querySelector<HTMLElement>("[data-live-action-submit-motion]");
      const progress = root.querySelector<HTMLElement>("[data-live-action-feedback-progress]");

      if (state === "pending") {
        root.dataset["liveActionFeedbackMotionKind"] = "pending";
        const timeline = gsap.timeline();

        if (button !== null) {
          timeline.fromTo(
            button,
            { scale: 1, willChange: "transform" },
            { duration: 0.11, ease: "power2.in", repeat: 1, scale: 0.95, yoyo: true },
            0,
          );
        }

        if (progress !== null) {
          timeline.fromTo(
            progress,
            { autoAlpha: 0.34, scaleX: 0.12, willChange: "transform, opacity" },
            {
              autoAlpha: 0.84,
              duration: 0.72,
              ease: "sine.inOut",
              repeat: -1,
              scaleX: 1,
              yoyo: true,
            },
            0,
          );
        }

        return () => {
          timeline.kill();
          delete root.dataset["liveActionFeedbackMotionKind"];
        };
      }

      const confirmation = root.querySelector<HTMLElement>(
        "[data-live-action-feedback-confirmation]",
      );
      const seal = root.querySelector<HTMLElement>("[data-live-action-feedback-seal]");
      const sweep = root.querySelector<HTMLElement>("[data-live-action-feedback-sweep]");

      root.dataset["liveActionFeedbackMotionKind"] = "confirm";
      const timeline = gsap.timeline({
        onComplete: () => {
          clearActionFeedbackProperties([button, confirmation, progress, seal, sweep]);
          delete root.dataset["liveActionFeedbackMotionKind"];

          if (feedbackId !== null) {
            onConfirmationComplete(feedbackId);
          }
        },
      });

      if (confirmation !== null) {
        timeline
          .fromTo(
            confirmation,
            { autoAlpha: 0, willChange: "opacity" },
            { autoAlpha: 1, duration: 0.16, ease: "power2.out" },
            0,
          )
          .to(confirmation, { autoAlpha: 0, duration: 0.26, ease: "power2.in" }, 0.55);
      }

      if (seal !== null) {
        timeline.fromTo(
          seal,
          { rotate: -9, scale: 0.7, willChange: "transform" },
          { duration: 0.46, ease: "back.out(1.8)", rotate: 0, scale: 1 },
          0.06,
        );
      }

      if (sweep !== null) {
        timeline.fromTo(
          sweep,
          { autoAlpha: 0, xPercent: 0, willChange: "transform, opacity" },
          { autoAlpha: 0.72, duration: 0.58, ease: "power2.inOut", xPercent: 430 },
          0.02,
        );
      }

      return () => {
        timeline.kill();
        delete root.dataset["liveActionFeedbackMotionKind"];
      };
    },
    {
      dependencies: [feedbackId, reducedMotion, state],
      revertOnUpdate: true,
      scope: rootRef,
    },
  );
}

function clearActionFeedbackProperties(elements: readonly (HTMLElement | null)[]): void {
  const presentElements = elements.filter((element): element is HTMLElement => element !== null);

  if (presentElements.length === 0) {
    return;
  }

  gsap.set(presentElements, {
    clearProps: "opacity,transform,visibility,will-change",
  });
}
