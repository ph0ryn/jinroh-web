import { notFound } from "next/navigation";

import LivePage from "@/app/live/page";

import { createDevLiveFixtures, type DevLiveFixtureId } from "./devLiveFixture";

const DEFAULT_FIXTURE_ID: DevLiveFixtureId = "night";
const FIXTURE_IDS: readonly DevLiveFixtureId[] = ["night", "day", "voting", "execution", "result"];

export const dynamic = "force-dynamic";

type DevLivePageProps = {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DevLivePage({ searchParams }: DevLivePageProps) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const params = await searchParams;
  const requestedFixtureId = params?.["phase"];
  const initialFixtureId = toFixtureId(requestedFixtureId);
  const devFixtures = createDevLiveFixtures();

  return <LivePage devFixtures={devFixtures} devInitialFixtureId={initialFixtureId} />;
}

function toFixtureId(value: string | string[] | undefined): DevLiveFixtureId {
  const candidate = Array.isArray(value) ? value[0] : value;

  if (candidate !== undefined && FIXTURE_IDS.includes(candidate as DevLiveFixtureId)) {
    return candidate as DevLiveFixtureId;
  }

  return DEFAULT_FIXTURE_ID;
}
