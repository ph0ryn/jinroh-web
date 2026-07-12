import { getRoleCatalog } from "@/lib/server/game/roles";

import { JinrohSurface } from "./jinrohSurface";

export default function Page() {
  return <JinrohSurface roleCatalog={getRoleCatalog()} />;
}
