import styles from "./liveViewportLayout.module.css";

import type { ReactNode } from "react";

export type LiveRoomSurfaceKind = "ended" | "playing" | "waiting";

export type LiveRoomControlsProps = {
  readonly primary?: ReactNode;
  readonly scroll?: ReactNode;
  readonly status: ReactNode;
  readonly surface: LiveRoomSurfaceKind;
  readonly transitionItem?: "waiting";
  readonly utilities?: ReactNode;
};

type LiveRoomLayoutProps = {
  readonly controls: ReactNode;
  readonly table: ReactNode;
  readonly tableLabel: string;
  readonly title: string;
  readonly transitionItem?: "waiting";
};

export function LiveRoomLayout({
  controls,
  table,
  tableLabel,
  title,
  transitionItem,
}: LiveRoomLayoutProps) {
  return (
    <div className={styles["roomLayout"]} data-live-room-layout>
      <h1 className="srOnly">{title}</h1>
      <section
        aria-label={tableLabel}
        className={styles["tableRegion"]}
        data-live-setup-transition-item={transitionItem}
      >
        {table}
      </section>
      <div className={styles["controlsRegion"]}>{controls}</div>
    </div>
  );
}

export function LiveRoomControls({
  primary,
  scroll,
  status,
  surface,
  transitionItem,
  utilities,
}: LiveRoomControlsProps) {
  return (
    <aside
      className={styles["controls"]}
      data-live-controls
      data-live-controls-surface={surface}
      data-live-setup-transition-item={transitionItem}
    >
      <div className={styles["controlsStatus"]} data-live-controls-status>
        {status}
      </div>
      {scroll === undefined || scroll === null ? null : (
        <div className={styles["controlsScroll"]} data-live-scroll-region>
          {scroll}
        </div>
      )}
      {primary === undefined || primary === null ? null : (
        <div className={styles["controlsPrimary"]} data-live-primary-actions>
          {primary}
        </div>
      )}
      {utilities === undefined || utilities === null ? null : (
        <div className={styles["controlsUtilities"]} data-live-controls-utilities>
          {utilities}
        </div>
      )}
    </aside>
  );
}

export const liveViewportStyles = styles;
