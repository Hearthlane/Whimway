import type { PlanRequest } from "@shared/schema";

/**
 * What the home screen already knows when someone types their idea and taps Next: the
 * request it understood (who, when, budget, area) and their words. The guided planner
 * starts from this and asks only what is still open.
 */
export type GuideSeed = { request: PlanRequest; text: string };
let seed: GuideSeed | null = null;
export function setGuideSeed(next: GuideSeed | null) {
  seed = next;
}
export function guideSeed() {
  return seed;
}
