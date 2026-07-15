"use client";

import { useRef, useState } from "react";

import { gsap, useGSAP } from "../liveGsap";
import { usePrefersReducedMotion } from "../usePrefersReducedMotion";
import styles from "./liveActionGuide.module.css";
import { LiveModalFrame } from "./LiveModalFrame";

import type { LiveActionGuideState } from "../../liveActionInteractionModel";
import type { Locale, Localization } from "@/lib/i18n/localization";
import type { PublicAction, PublicActionStatus, PublicPlayer } from "@/lib/shared/game";

type SinglePlayerPublicAction = Extract<PublicAction, { targetKind: "single_player" }>;

type LiveActionGuideProps = {
  readonly isObscured: boolean;
  readonly isPending: boolean;
  readonly locale: Locale;
  readonly selectedPlayer: PublicPlayer | null;
  readonly state: LiveActionGuideState;
  readonly t: Localization;
  readonly onConfirm: () => void;
  readonly onReselect: () => void;
  readonly onTargetlessSubmit: (action: PublicAction) => void;
};

const CONFIRMATION_DIALOG_ID = "live-action-confirmation-dialog";

export function LiveActionGuide({
  isObscured,
  isPending,
  locale,
  selectedPlayer,
  state,
  t,
  onConfirm,
  onReselect,
  onTargetlessSubmit,
}: LiveActionGuideProps) {
  const guideMotionRef = useRef<HTMLDivElement>(null);
  const guideAction = state.kind === "active" || state.kind === "accepted" ? state.action : null;
  const activeAction = state.kind === "active" ? state.action : null;
  const guideStatus = getGuideStatus(state);
  const guideMessage = getGuideMessage(state, locale, t);
  const confirmationAction =
    activeAction?.targetKind === "single_player" && selectedPlayer !== null ? activeAction : null;
  const isGuideVisible = !isObscured && guideMessage !== null;
  const isConfirmationOpen = !isObscured && confirmationAction !== null;
  const motionKey = [
    guideAction?.phaseInstanceId ?? "none",
    guideAction?.key ?? "none",
    state.kind,
  ].join(":");
  const reducedMotion = usePrefersReducedMotion();

  useGSAP(
    () => {
      const guide = guideMotionRef.current;

      if (guide === null) {
        return;
      }

      if (reducedMotion || document.visibilityState !== "visible") {
        gsap.set(guide, { clearProps: "opacity,transform,visibility,will-change" });
        return;
      }

      const timeline = gsap.timeline({
        onComplete: () => {
          gsap.set(guide, { clearProps: "opacity,transform,visibility,will-change" });
        },
      });

      timeline.fromTo(
        guide,
        { autoAlpha: 0, scale: 0.96, willChange: "transform, opacity", y: 8 },
        { autoAlpha: 1, duration: 0.28, ease: "power2.out", scale: 1, y: 0 },
      );

      return () => {
        timeline.kill();
        gsap.set(guide, { clearProps: "opacity,transform,visibility,will-change" });
      };
    },
    {
      dependencies: [isGuideVisible, motionKey, reducedMotion],
      revertOnUpdate: true,
      scope: guideMotionRef,
    },
  );

  return (
    <>
      {isGuideVisible ? (
        <div
          className={styles["placement"]}
          data-live-action-guide
          data-live-action-key={guideAction?.key}
          data-live-action-kind={guideAction?.kind}
          data-live-action-status={guideStatus ?? undefined}
        >
          <div className={styles["guide"]} ref={guideMotionRef}>
            <p aria-atomic="true" aria-live="polite" role="status">
              <strong>{guideMessage}</strong>
            </p>
            {activeAction?.targetKind === "none" ? (
              <button
                aria-busy={isPending}
                className={styles["targetlessButton"]}
                data-live-action-submit
                disabled={isPending}
                type="button"
                onClick={() => onTargetlessSubmit(activeAction)}
              >
                {isPending
                  ? t.live.actionGuide.submitting
                  : activeAction.presentation[locale].submitLabel}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <LiveActionConfirmationDialog
        action={confirmationAction}
        isOpen={isConfirmationOpen}
        isPending={isPending}
        locale={locale}
        player={selectedPlayer}
        t={t}
        onConfirm={onConfirm}
        onReselect={onReselect}
      />
    </>
  );
}

function LiveActionConfirmationDialog({
  action,
  isOpen,
  isPending,
  locale,
  player,
  t,
  onConfirm,
  onReselect,
}: {
  readonly action: SinglePlayerPublicAction | null;
  readonly isOpen: boolean;
  readonly isPending: boolean;
  readonly locale: Locale;
  readonly player: PublicPlayer | null;
  readonly t: Localization;
  readonly onConfirm: () => void;
  readonly onReselect: () => void;
}) {
  const titleId = `${CONFIRMATION_DIALOG_ID}-title`;
  const warningId = `${CONFIRMATION_DIALOG_ID}-warning`;
  const currentContent = action === null || player === null ? null : { action, player };
  const [retainedContent, setRetainedContent] = useState(currentContent);

  if (
    currentContent !== null &&
    (retainedContent?.action !== currentContent.action ||
      retainedContent.player !== currentContent.player)
  ) {
    setRetainedContent(currentContent);
  }

  const renderedContent = currentContent ?? retainedContent;
  const renderedAction = renderedContent?.action ?? null;
  const renderedPlayer = renderedContent?.player ?? null;
  const presentation = renderedAction?.presentation[locale] ?? null;

  return (
    <LiveModalFrame
      ariaLabelledBy={titleId}
      dialogClassName={`liveConfirmationModal ${styles["confirmationDialog"]}`}
      id={CONFIRMATION_DIALOG_ID}
      isDismissible={!isPending}
      isOpen={isOpen}
      variant="popup"
      onExitComplete={() => {
        setRetainedContent(null);
      }}
      onRequestClose={() => {
        if (!isPending) {
          onReselect();
        }
      }}
    >
      {renderedAction === null || renderedPlayer === null || presentation === null ? null : (
        <div
          aria-busy={isPending}
          className={styles["confirmationBody"]}
          data-live-action-confirmation
          data-live-action-key={renderedAction.key}
          data-live-action-kind={renderedAction.kind}
          data-live-action-status={renderedAction.status}
        >
          <div className={styles["confirmationHeading"]}>
            <span>{presentation.label}</span>
            <h2 id={titleId}>
              {presentation.targetConfirmation.beforeTarget}
              <strong>{renderedPlayer.displayName}</strong>
              {presentation.targetConfirmation.afterTarget}
            </h2>
          </div>
          <p data-live-action-warning id={warningId}>
            {t.live.actionGuide.irreversibleWarning}
          </p>
          <div className={styles["confirmationActions"]}>
            <button
              className="secondaryButton"
              data-live-action-reselect
              data-live-modal-initial-focus={!isPending ? "" : undefined}
              disabled={isPending}
              type="button"
              onClick={onReselect}
            >
              {t.live.actionGuide.reselect}
            </button>
            <button
              aria-busy={isPending}
              aria-describedby={warningId}
              data-live-action-confirm
              disabled={isPending}
              type="button"
              onClick={onConfirm}
            >
              {isPending ? t.live.actionGuide.submitting : presentation.submitLabel}
            </button>
          </div>
        </div>
      )}
    </LiveModalFrame>
  );
}

function getGuideMessage(
  state: LiveActionGuideState,
  locale: Locale,
  t: Localization,
): string | null {
  switch (state.kind) {
    case "active":
      return state.action.presentation[locale].label;
    case "accepted":
      return state.action.presentation[locale].submittedMessage;
    case "closed":
      return t.live.actionGuide.closedWithoutReceipt;
    case "idle":
      return null;
  }
}

function getGuideStatus(state: LiveActionGuideState): PublicActionStatus | null {
  switch (state.kind) {
    case "active":
      return "open";
    case "accepted":
    case "closed":
      return "submitted";
    case "idle":
      return null;
  }
}
