import { Planner } from "../planner";
import { GooglePlaces, GoogleRoutes } from "../providers/google";
import { OpenAIRecommender } from "../providers/ai";
import { FixturePlaces, FixtureRoutes, FixtureAI } from "../providers/fixtures";
import { AppError } from "../errors";
import { demoSelect } from "../providers/gta-demo";
import type { RecommendationProvider } from "../providers/types";
import type { PlanRequest } from "../schema";
export function demoAllowed() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.WHIMWAY_DEMO_MODE === "true"
  );
}
export function planner(request: PlanRequest, demo = false) {
  if (demo && !demoAllowed())
    throw new AppError(
      "DEMO_DISABLED",
      "Test fixtures are disabled in this environment.",
      403,
    );
  return demo
    ? new Planner(
        new FixturePlaces(request),
        new FixtureRoutes(),
        new FixtureAI(),
        true,
      )
    : new Planner(
        new GooglePlaces(),
        new GoogleRoutes(),
        aiConfigured() ? new OpenAIRecommender() : new BuiltInRecommender(),
      );
}
export function aiConfigured() {
  return Boolean(
    (process.env.WHIMWAY_OPENAI_KEY || process.env.OPENAI_API_KEY) &&
    (process.env.WHIMWAY_OPENAI_MODEL || process.env.OPENAI_MODEL),
  );
}
/**
 * Real places with no AI key yet: the deterministic planner picks and orders the stops
 * (one meal, budget, opening hours, a natural arc). Copy is plainer than the AI's.
 */
class BuiltInRecommender implements RecommendationProvider {
  async select(...args: Parameters<RecommendationProvider["select"]>) {
    return demoSelect(...args);
  }
}
