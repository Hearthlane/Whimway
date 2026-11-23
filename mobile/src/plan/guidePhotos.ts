// Photos for the guided planner's choices. They show a kind of food or outing, never a
// specific venue. All from Unsplash (free to use under the Unsplash License).

import { activities, cuisines, groupByKey, inGroup } from "@shared/guide";
import type { CandidatePlace } from "@shared/schema";

// A category without its own photo shows a plain tile rather than another cuisine's dish.
export const guidePhotos: Partial<Record<string, number>> = {
  japanese: require("../../assets/guide/japanese.jpg"),
  chinese: require("../../assets/guide/chinese.jpg"),
  thai: require("../../assets/guide/thai.jpg"),
  mexican: require("../../assets/guide/mexican.jpg"),
  italian: require("../../assets/guide/italian.jpg"),
  western: require("../../assets/guide/western.jpg"),
  indian: require("../../assets/guide/indian.jpg"),
  brunch: require("../../assets/guide/brunch.jpg"),
  sweet: require("../../assets/guide/sweet.jpg"),
  games: require("../../assets/guide/games.jpg"),
  shows: require("../../assets/guide/shows.jpg"),
  culture: require("../../assets/guide/culture.jpg"),
  sights: require("../../assets/guide/sights.jpg"),
  attractions: require("../../assets/guide/attractions.jpg"),
  outdoors: require("../../assets/guide/outdoors.jpg"),
  shopping: require("../../assets/guide/shopping.jpg"),
  drinks: require("../../assets/guide/drinks.jpg"),
};

/** The category a place mainly belongs to, preferring the one the person was browsing. */
export function kindOf(p: Pick<CandidatePlace, "category" | "types">, chosen?: string) {
  const current = chosen ? groupByKey(chosen) : undefined;
  return current && inGroup(p, current) ? current.key : ([...cuisines, ...activities].find((g) => inGroup(p, g))?.key ?? "sights");
}
