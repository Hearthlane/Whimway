import { distance } from "../geo";
import type { CandidatePlace, PlanRequest } from "../schema";

// These are retrieval/scoring preferences derived from provider categories,
// never claims of venue atmosphere, admission, accessibility or age suitability.
export function retrievalPreferences(
  request: PlanRequest,
  action?: string,
): PlanRequest {
  const extra: PlanRequest["interests"] = [];
  const add = (interest: PlanRequest["interests"][number]) => {
    if (!extra.includes(interest)) extra.push(interest);
  };
  if (action?.includes("More food")) add("Food & drinks");
  if (action?.includes("More hidden gems")) add("Hidden gems");
  if (action?.includes("More exciting")) add("Interactive fun");
  if (action?.includes("More relaxing")) add("Relaxation");
  const remixFocus = [...extra];
  if (request.companion === "family") add("Family");
  if (["friends", "group", "date"].includes(request.companion ?? ""))
    add("Interactive fun");
  if (request.energy === "chill") add("Relaxation");
  if (request.energy === "active") add("Outdoors");
  for (const vibe of request.vibes ?? []) {
    if (vibe === "budget-friendly") add("Outdoors");
    if (vibe === "romantic" || vibe === "cozy") add("Relaxation");
    if (vibe === "exciting") add("Interactive fun");
    if (vibe === "hidden-gems") add("Hidden gems");
    if (vibe === "trendy" || vibe === "luxurious") add("Food & drinks");
  }
  const explicit = request.interests.filter(
    (interest) => interest !== "Surprise me",
  );
  const interests = [...new Set([...remixFocus, ...explicit, ...extra])].slice(
    0,
    10,
  );
  return interests.length ? { ...request, interests } : request;
}

export function preferenceScore(
  request: PlanRequest,
  place: CandidatePlace,
  action?: string,
): number {
  const types = new Set([...place.types, place.category.replaceAll(" ", "_")]);
  const has = (...items: string[]) => items.some((type) => types.has(type));
  const quiet = has(
    "park",
    "garden",
    "botanical_garden",
    "cafe",
    "public_library",
    "art_gallery",
    "museum",
  );
  const interactive = has(
    "bowling_alley",
    "amusement_park",
    "amusement_center",
    "video_arcade",
    "escape_room",
    "sports_complex",
  );
  const outdoor = has("hiking_area", "national_park", "park", "beach");
  let score = 0;
  if (
    request.companion === "family" &&
    has("park", "museum", "art_gallery", "aquarium", "zoo", "amusement_park")
  )
    score += 0.4;
  if (
    ["date", "friends", "group"].includes(request.companion ?? "") &&
    interactive
  )
    score += 0.4;
  if (
    request.companion === "date" &&
    has("cafe", "art_gallery", "garden", "botanical_garden")
  )
    score += 0.2;
  if (
    request.companion === "solo" &&
    has("museum", "art_gallery", "public_library")
  )
    score += 0.2;
  const moreExciting = action?.includes("More exciting") === true;
  const moreRelaxing = action?.includes("More relaxing") === true;
  const relaxed = moreRelaxing || (request.energy === "chill" && !moreExciting);
  const energetic =
    moreExciting || (request.energy === "active" && !moreRelaxing);
  if (relaxed && quiet) score += moreRelaxing ? 0.75 : 0.45;
  if (energetic && (interactive || outdoor))
    score += moreExciting ? 0.75 : 0.45;
  if (
    action?.includes("More food") &&
    has("restaurant", "cafe", "food_court", "market", "food_market")
  )
    score += 0.75;
  if (
    action?.includes("More hidden gems") &&
    (place.reviews ?? Infinity) <= 100 &&
    (place.rating ?? 0) >= 4
  )
    score += 0.75;
  if (relaxed || action?.includes("Less walking"))
    score -=
      0.3 *
      Math.min(
        1,
        distance(place.point, request.start ?? request.area.center) /
          request.area.radius,
      );
  for (const vibe of request.vibes ?? []) {
    if (!moreExciting && (vibe === "cozy" || vibe === "romantic") && quiet)
      score += 0.2;
    if (!moreRelaxing && vibe === "exciting" && interactive) score += 0.3;
    if (
      vibe === "luxurious" &&
      place.price.confidence === "published-range" &&
      place.price.high !== null &&
      (place.rating ?? 0) >= 4
    )
      score +=
        0.15 * Math.min(1, place.price.high / Math.max(1, request.budget));
    // Review counts indicate popularity, not confirmed trend/hidden-gem status.
    if (vibe === "trendy" && (place.reviews ?? 0) >= 1000) score += 0.15;
    if (
      vibe === "hidden-gems" &&
      (place.reviews ?? Infinity) <= 100 &&
      (place.rating ?? 0) >= 4
    )
      score += 0.15;
  }
  if (
    request.vibes?.includes("budget-friendly") ||
    action?.includes("cheaper")
  ) {
    score +=
      place.price.high === null
        ? -0.3
        : 0.5 / (1 + place.price.high / Math.max(1, request.budget));
  }
  return score;
}
