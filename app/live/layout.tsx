import type { Metadata } from "next";
import type { ReactNode } from "react";

const liveDescription =
  "Create or join a Jinroh Web room, then keep roles, phases, actions, voting, and results in sync at the table.";
const liveTitle = "Play Werewolf — Jinroh Web";

export const metadata: Metadata = {
  alternates: {
    canonical: "/live",
  },
  description: liveDescription,
  openGraph: {
    description: liveDescription,
    images: [
      {
        alt: "Lantern-lit werewolf tabletop with role cards, voting tokens, and notes.",
        height: 630,
        url: "/images/jinroh-og.jpg",
        width: 1200,
      },
    ],
    siteName: "Jinroh Web",
    title: liveTitle,
    type: "website",
    url: "/live",
  },
  robots: {
    follow: false,
    index: false,
  },
  title: liveTitle,
  twitter: {
    card: "summary_large_image",
    description: liveDescription,
    images: ["/images/jinroh-og.jpg"],
    title: liveTitle,
  },
};

type LiveLayoutProps = {
  readonly children: ReactNode;
};

export default function LiveLayout({ children }: LiveLayoutProps) {
  return children;
}
