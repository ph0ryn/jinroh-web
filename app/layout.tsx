import { I18nProvider } from "./i18nProvider";

import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

const siteDescription =
  "Jinroh Web manages shared room and game state for in-person or voice-call werewolf games.";
const siteTitle = "Jinroh Web";
const siteUrl = getSiteUrl();

export const metadata: Metadata = {
  description: siteDescription,
  metadataBase: new URL(siteUrl),
  openGraph: {
    description: siteDescription,
    images: [
      {
        alt: "Lantern-lit werewolf tabletop with role cards, voting tokens, and notes.",
        height: 630,
        url: "/images/jinroh-og.jpg",
        width: 1200,
      },
    ],
    siteName: siteTitle,
    title: siteTitle,
    type: "website",
  },
  title: siteTitle,
  twitter: {
    card: "summary_large_image",
    description: siteDescription,
    images: ["/images/jinroh-og.jpg"],
    title: siteTitle,
  },
};

export const viewport: Viewport = {
  viewportFit: "cover",
};

type RootLayoutProps = {
  readonly children: ReactNode;
};

function getSiteUrl(): string {
  const explicitSiteUrl = process.env["NEXT_PUBLIC_SITE_URL"]?.trim();

  if (explicitSiteUrl !== undefined && explicitSiteUrl.length > 0) {
    return explicitSiteUrl;
  }

  const vercelUrl =
    process.env["VERCEL_PROJECT_PRODUCTION_URL"]?.trim() ?? process.env["VERCEL_URL"]?.trim();

  if (vercelUrl !== undefined && vercelUrl.length > 0) {
    return vercelUrl.startsWith("http") ? vercelUrl : `https://${vercelUrl}`;
  }

  return "http://localhost:3000";
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
