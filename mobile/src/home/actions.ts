import { router } from "expo-router";
import { DateTime } from "luxon";
import { areaByKey } from "@shared/areas";
import { buildRequest, interpret } from "@shared/intent";
import type { TasteProfile } from "@shared/profile";
import type { PlanRequest } from "@shared/schema";

type Favourite = TasteProfile["favourites"][number];

/** Build a whole outing around a saved place (late in the day, it plans for tomorrow evening). */
export function planAround(
  f: Favourite,
  profile: TasteProfile,
  store: { unlocked: boolean; setPending: (r: PlanRequest) => void },
) {
  if (!store.unlocked) return router.push({ pathname: "/plus", params: { reason: "favourite" } });
  const now = DateTime.now().setZone("America/Toronto");
  const prompt = `Plan something around ${f.name}`;
  const base = buildRequest(prompt, interpret(prompt, now), profile, now, { area: areaByKey(f.area) });
  const late = base.date === now.toISODate() && base.startTime >= "19:30";
  store.setPending({
    ...base,
    ...(late ? { date: now.plus({ days: 1 }).toISODate()!, startTime: "18:30" } : {}),
    anchorPlaceIds: [f.id],
    excludedPlaceIds: profile.disliked.filter((id) => id !== f.id),
  });
  router.push("/plan/new");
}
