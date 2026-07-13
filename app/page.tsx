import Image from "next/image";
import Link from "next/link";

import styles from "./landingPage.module.css";

import type { ReactNode } from "react";

type IconName =
  | "arrow"
  | "check"
  | "clock"
  | "layers"
  | "lock"
  | "moon"
  | "shield"
  | "spark"
  | "users"
  | "vote"
  | "wolf";

type IconProps = {
  readonly name: IconName;
  readonly size?: number;
};

const steps = [
  {
    detail: "Start a room in seconds. No account, setup sheet, or commitment required.",
    icon: "spark" as const,
    number: "01",
    title: "Set the scene",
  },
  {
    detail: "Share one short code. Everyone takes a seat from their own phone or laptop.",
    icon: "users" as const,
    number: "02",
    title: "Invite the table",
  },
  {
    detail: "Jinroh Web carries the hidden state while the group keeps the conversation human.",
    icon: "vote" as const,
    number: "03",
    title: "Play the night",
  },
];

const managedFeatures = [
  {
    detail: "One shared view for the room, with private role information kept private.",
    icon: "layers" as const,
    title: "One source of truth",
  },
  {
    detail: "Night actions, votes, executions, and results move in the right order.",
    icon: "clock" as const,
    title: "Every phase in sync",
  },
  {
    detail: "Anonymous rooms mean game night starts with a link, not a registration flow.",
    icon: "lock" as const,
    title: "Private by default",
  },
];

const phaseCards = [
  {
    image: "/images/jinroh-waiting.jpg",
    label: "01 / Waiting room",
    title: "Get everyone seated",
  },
  {
    image: "/images/jinroh-night.jpg",
    label: "02 / Night",
    title: "Keep secrets secret",
  },
  {
    image: "/images/jinroh-voting.jpg",
    label: "03 / Voting",
    title: "Make the reveal count",
  },
];

export default function Page() {
  return (
    <main className={styles["page"]} id="top">
      <div className={styles["ambientGlow"]} aria-hidden="true" />

      <header className={styles["header"]}>
        <Link className={styles["brand"]} href="#top" aria-label="Jinroh Web home">
          <span className={styles["brandMark"]}>
            <Icon name="wolf" size={21} />
          </span>
          <span className={styles["brandName"]}>
            <strong>Jinroh</strong>
            <span>WEB</span>
          </span>
        </Link>

        <nav className={styles["nav"]} aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#features">What it manages</a>
          <a href="#game-night">For game night</a>
        </nav>

        <Link className={styles["headerCta"]} href="/live">
          Open the table <Icon name="arrow" size={16} />
        </Link>
      </header>

      <section className={styles["hero"]} aria-labelledby="hero-title">
        <div className={styles["heroBackdrop"]} aria-hidden="true" />
        <div className={styles["heroGrid"]} aria-hidden="true" />
        <div className={styles["heroContent"]}>
          <div className={styles["heroCopy"]}>
            <p className={styles["eyebrow"]}>
              <span className={styles["eyebrowDot"]} /> A shared game state for real tables
            </p>
            <h1 id="hero-title">
              Keep the tension
              <br />
              <em>at the table.</em>
            </h1>
            <p className={styles["heroLead"]}>
              Jinroh Web handles the hidden work of a werewolf game—rooms, roles, phases, and
              votes—so your group can focus on reading the room.
            </p>
            <div className={styles["heroActions"]}>
              <Link className={styles["primaryButton"]} href="/live">
                Start a new room <Icon name="arrow" size={18} />
              </Link>
              <Link className={styles["secondaryButton"]} href="/live?mode=join">
                Join with a room code <Icon name="arrow" size={16} />
              </Link>
            </div>
            <div className={styles["heroNotes"]}>
              <span>
                <Icon name="check" size={14} /> No account required
              </span>
              <span>
                <Icon name="check" size={14} /> Built for voice chat
              </span>
            </div>
          </div>

          <div className={styles["heroVisual"]} aria-label="A preview of a live Jinroh Web room">
            <div className={styles["heroVisualHalo"]} aria-hidden="true" />
            <div className={styles["roomPreview"]}>
              <div className={styles["previewTopline"]}>
                <span className={styles["previewRoom"]}>ROOM 428 913</span>
                <span className={styles["livePill"]}>
                  <span /> LIVE
                </span>
              </div>
              <div className={styles["previewTitleRow"]}>
                <div>
                  <span className={styles["previewKicker"]}>CURRENT PHASE</span>
                  <strong>Night 02</strong>
                </div>
                <span className={styles["previewTimer"]}>04:32</span>
              </div>
              <div className={styles["previewTable"]}>
                <div className={styles["previewOrbit"]} aria-hidden="true" />
                <span className={`${styles["previewSeat"]} ${styles["previewSeatOne"]}`}>S</span>
                <span className={`${styles["previewSeat"]} ${styles["previewSeatTwo"]}`}>M</span>
                <span className={`${styles["previewSeat"]} ${styles["previewSeatThree"]}`}>K</span>
                <span className={`${styles["previewSeat"]} ${styles["previewSeatFour"]}`}>R</span>
                <div className={styles["previewCenter"]}>
                  <Icon name="moon" size={20} />
                  <span>Role actions</span>
                  <strong>3 / 4 ready</strong>
                </div>
              </div>
              <div className={styles["previewFooter"]}>
                <span>
                  <Icon name="lock" size={13} /> Private actions stay private
                </span>
                <span className={styles["previewRevision"]}>REV. 018</span>
              </div>
            </div>
            <div className={`${styles["floatingNote"]} ${styles["floatingNoteTop"]}`}>
              <span className={styles["floatingIcon"]}>
                <Icon name="users" size={15} />
              </span>
              <span>
                <strong>8 players</strong>
                <small>seated and ready</small>
              </span>
            </div>
            <div className={`${styles["floatingNote"]} ${styles["floatingNoteBottom"]}`}>
              <span className={styles["floatingIconAccent"]}>
                <Icon name="shield" size={15} />
              </span>
              <span>
                <strong>State protected</strong>
                <small>server-authorized</small>
              </span>
            </div>
          </div>
        </div>
        <div className={styles["heroBottom"]}>
          <span>JINROH WEB / 2026</span>
          <span className={styles["heroScroll"]}>
            Scroll to explore <span>↓</span>
          </span>
          <span>THE NIGHT IS YOURS</span>
        </div>
      </section>

      <section className={styles["signalBar"]} aria-label="Product principles">
        <div>
          <span className={styles["signalNumber"]}>01</span>
          <span>Anonymous rooms</span>
        </div>
        <div>
          <span className={styles["signalNumber"]}>02</span>
          <span>Live shared state</span>
        </div>
        <div>
          <span className={styles["signalNumber"]}>03</span>
          <span>Human-led discussion</span>
        </div>
        <div>
          <span className={styles["signalNumber"]}>04</span>
          <span>Private role actions</span>
        </div>
      </section>

      <section className={styles["section"]} id="how-it-works" aria-labelledby="how-title">
        <div className={styles["sectionHeading"]}>
          <p className={styles["eyebrow"]}>A lighter way to host</p>
          <h2 id="how-title">
            From first name
            <br />
            to final reveal.
          </h2>
          <p>
            The table stays human. Jinroh Web takes care of the details that usually get lost in a
            notebook, a group chat, or someone&apos;s memory.
          </p>
        </div>
        <div className={styles["stepGrid"]}>
          {steps.map((step) => (
            <article className={styles["stepCard"]} key={step.number}>
              <div className={styles["stepTopline"]}>
                <span className={styles["stepNumber"]}>{step.number}</span>
                <span className={styles["stepIcon"]}>
                  <Icon name={step.icon} size={20} />
                </span>
              </div>
              <h3>{step.title}</h3>
              <p>{step.detail}</p>
              <span className={styles["stepRule"]} />
            </article>
          ))}
        </div>
      </section>

      <section
        className={`${styles["section"]} ${styles["featureSection"]}`}
        id="features"
        aria-labelledby="features-title"
      >
        <div className={styles["featureVisual"]}>
          <Image
            fill
            priority
            alt="A lantern-lit table with role cards ready for the night phase"
            sizes="(max-width: 820px) 100vw, 55vw"
            src="/images/jinroh-night.jpg"
          />
          <div className={styles["imageVignette"]} aria-hidden="true" />
          <div className={styles["privateCard"]}>
            <span className={styles["privateCardIcon"]}>
              <Icon name="lock" size={16} />
            </span>
            <span>
              <strong>Private by default</strong>
              <small>Only the right role sees the right thing.</small>
            </span>
          </div>
          <span className={styles["imageCaption"]}>
            The app manages the state, not the conversation.
          </span>
        </div>
        <div className={styles["featureCopy"]}>
          <p className={styles["eyebrow"]}>The quiet infrastructure</p>
          <h2 id="features-title">All the invisible work, finally visible.</h2>
          <p className={styles["featureLead"]}>
            No one should pause a good accusation to ask who has acted, what phase comes next, or
            whether the vote was counted. The shared state stays clear, current, and out of the way.
          </p>
          <div className={styles["featureList"]}>
            {managedFeatures.map((feature) => (
              <div className={styles["featureItem"]} key={feature.title}>
                <span className={styles["featureIcon"]}>
                  <Icon name={feature.icon} size={18} />
                </span>
                <span>
                  <strong>{feature.title}</strong>
                  <small>{feature.detail}</small>
                </span>
              </div>
            ))}
          </div>
          <Link className={styles["textLink"]} href="/live">
            Open a live room <Icon name="arrow" size={16} />
          </Link>
        </div>
      </section>

      <section
        className={`${styles["section"]} ${styles["phasesSection"]}`}
        aria-labelledby="phases-title"
      >
        <div className={styles["phaseHeading"]}>
          <div>
            <p className={styles["eyebrow"]}>One calm surface for every turn</p>
            <h2 id="phases-title">
              The whole night,
              <br />
              <em>in good hands.</em>
            </h2>
          </div>
          <p>
            Move from waiting room to first night, discussion, vote, and result without losing the
            thread.
          </p>
        </div>
        <div className={styles["phaseGrid"]}>
          {phaseCards.map((card) => (
            <article className={styles["phaseCard"]} key={card.label}>
              <div className={styles["phaseImageWrap"]}>
                <Image fill alt="" sizes="(max-width: 580px) 100vw, 33vw" src={card.image} />
                <span className={styles["phaseImageOverlay"]} aria-hidden="true" />
                <span className={styles["phaseLabel"]}>{card.label}</span>
              </div>
              <h3>{card.title}</h3>
            </article>
          ))}
        </div>
      </section>

      <section
        className={`${styles["section"]} ${styles["audienceSection"]}`}
        id="game-night"
        aria-labelledby="audience-title"
      >
        <div className={styles["audienceHeader"]}>
          <p className={styles["eyebrow"]}>Made for the people around the table</p>
          <h2 id="audience-title">
            More room for the
            <br />
            <em>good kind of chaos.</em>
          </h2>
        </div>
        <div className={styles["audienceGrid"]}>
          <article className={styles["audienceCard"]}>
            <span className={styles["audienceIndex"]}>FOR THE HOST</span>
            <span className={styles["audienceIcon"]}>
              <Icon name="wolf" size={22} />
            </span>
            <h3>Keep the room moving.</h3>
            <p>Set the rules, see the whole table, and advance the game with confidence.</p>
            <span className={styles["audienceArrow"]}>
              <Icon name="arrow" size={18} />
            </span>
          </article>
          <article className={`${styles["audienceCard"]} ${styles["audienceCardLight"]}`}>
            <span className={styles["audienceIndex"]}>FOR EVERY PLAYER</span>
            <span className={styles["audienceIcon"]}>
              <Icon name="moon" size={22} />
            </span>
            <h3>Stay inside the mystery.</h3>
            <p>See what belongs to you, act when it is your turn, and keep talking face to face.</p>
            <span className={styles["audienceArrow"]}>
              <Icon name="arrow" size={18} />
            </span>
          </article>
        </div>
      </section>

      <section className={styles["finalCta"]} aria-labelledby="cta-title">
        <div className={styles["finalCtaBackdrop"]} aria-hidden="true" />
        <div className={styles["finalCtaContent"]}>
          <p className={styles["eyebrow"]}>The table is waiting</p>
          <h2 id="cta-title">
            Make tonight
            <br />
            <em>worth remembering.</em>
          </h2>
          <p>Bring the people. We&apos;ll keep the night moving.</p>
          <Link className={styles["primaryButton"]} href="/live">
            Start a new room <Icon name="arrow" size={18} />
          </Link>
          <Link className={styles["finalJoinLink"]} href="/live?mode=join">
            Have a room code? Join a table
          </Link>
        </div>
        <div className={styles["finalCtaStamp"]} aria-hidden="true">
          <Icon name="wolf" size={35} />
          <span>
            PLAY
            <br />
            THE
            <br />
            NIGHT
          </span>
        </div>
      </section>

      <footer className={styles["footer"]}>
        <div className={styles["footerBrand"]}>
          <span className={styles["brandMark"]}>
            <Icon name="wolf" size={17} />
          </span>
          <span>
            <strong>Jinroh Web</strong>
            <small>Shared state for real tables.</small>
          </span>
        </div>
        <div className={styles["footerLinks"]}>
          <a href="#how-it-works">How it works</a>
          <a href="#features">Features</a>
          <Link href="/live">Open the table</Link>
        </div>
        <span className={styles["footerMeta"]}>© 2026 JINROH WEB</span>
      </footer>
    </main>
  );
}

function Icon({ name, size = 24 }: IconProps): ReactNode {
  return (
    <svg aria-hidden="true" fill="none" height={size} viewBox="0 0 24 24" width={size}>
      {getIconContent(name)}
    </svg>
  );
}

function getIconContent(name: IconName): ReactNode {
  switch (name) {
    case "arrow":
      return (
        <>
          <path d="M4 12h15" />
          <path d="m13 6 6 6-6 6" />
        </>
      );
    case "check":
      return <path d="m5 12 4 4L19 6" />;
    case "clock":
      return (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7v5l3 2" />
        </>
      );
    case "layers":
      return (
        <>
          <path d="m12 4 8 4-8 4-8-4 8-4Z" />
          <path d="m4 12 8 4 8-4" />
          <path d="m4 16 8 4 8-4" />
        </>
      );
    case "lock":
      return (
        <>
          <rect x="5" y="10" width="14" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          <path d="M12 14v2" />
        </>
      );
    case "moon":
      return <path d="M19.5 15.8A8.4 8.4 0 0 1 8.2 4.5 8.5 8.5 0 1 0 19.5 15.8Z" />;
    case "shield":
      return (
        <>
          <path d="M12 3 19 6v5c0 4.4-2.8 7.7-7 10-4.2-2.3-7-5.6-7-10V6l7-3Z" />
          <path d="m9 12 2 2 4-4" />
        </>
      );
    case "spark":
      return (
        <>
          <path d="m12 3 1.4 5.6L19 10l-5.6 1.4L12 17l-1.4-5.6L5 10l5.6-1.4L12 3Z" />
          <path d="m19 16 .6 2.4L22 19l-2.4.6L19 22l-.6-2.4L16 19l2.4-.6L19 16Z" />
        </>
      );
    case "users":
      return (
        <>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
          <path d="M16 5.5a3 3 0 0 1 0 5.8M17.2 14.2a4.5 4.5 0 0 1 3.3 4.3" />
        </>
      );
    case "vote":
      return (
        <>
          <path d="m5 12 4 4L19 6" />
          <path d="M4 20h16" />
          <path d="M7 17v3M17 17v3" />
        </>
      );
    case "wolf":
      return (
        <>
          <path d="m5 4 4 2 3-3 3 3 4-2-1 7c-.3 4-3 7-6 9-3-2-5.7-5-6-9L5 4Z" />
          <path d="m9 12 1.5 1M15 12l-1.5-1M10 16h4" />
        </>
      );
    default:
      return null;
  }
}
