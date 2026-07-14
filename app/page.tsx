import Image from "next/image";
import Link from "next/link";

import styles from "./landingPage.module.css";

import type { ReactNode } from "react";

type IconProps = {
  readonly size?: number;
};

export default function Page() {
  return (
    <main className={styles["page"]}>
      <div className={styles["backdrop"]} aria-hidden="true" />
      <div className={styles["grid"]} aria-hidden="true" />

      <header className={styles["header"]}>
        <Link className={styles["brand"]} href="/" aria-label="Jinroh Web home">
          <span className={styles["brandMark"]}>
            <Image alt="" aria-hidden="true" height={32} src="/images/jinroh-mark.png" width={32} />
          </span>
          <span className={styles["brandName"]}>
            <strong>Jinroh</strong>
            <span>WEB</span>
          </span>
        </Link>
        <span className={styles["headerStatus"]}>
          <span /> Ready for game night
        </span>
      </header>

      <section className={styles["hero"]} aria-labelledby="hero-title">
        <div className={styles["heroContent"]}>
          <h1 id="hero-title">
            Play the night.
            <br />
            <em>Trust no one.</em>
          </h1>
          <p className={styles["lead"]}>
            Create a room, share the code, and let Jinroh Web handle the game flow.
          </p>
          <Link className={styles["playButton"]} href="/live" aria-label="Play Jinroh Web">
            <span className={styles["playButtonCore"]}>
              <PlayIcon size={24} />
            </span>
            <span>PLAY</span>
          </Link>
          <div className={styles["notes"]}>
            <span>NO ACCOUNT</span>
            <i />
            <span>6-DIGIT ROOM CODE</span>
            <i />
            <span>VOICE CHAT READY</span>
          </div>
        </div>
      </section>

      <footer className={styles["footer"]}>
        <span>© 2026 JINROH WEB</span>
      </footer>
    </main>
  );
}

function PlayIcon({ size = 24 }: IconProps): ReactNode {
  return (
    <svg aria-hidden="true" fill="none" height={size} viewBox="0 0 24 24" width={size}>
      <path d="m9 6 9 6-9 6V6Z" fill="currentColor" stroke="none" />
    </svg>
  );
}
