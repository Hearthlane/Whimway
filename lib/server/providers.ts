import { Planner } from "../planner";
import { GooglePlaces, GoogleRoutes } from "../providers/google";
import { OpenAIRecommender } from "../providers/ai";
import { FixturePlaces, FixtureRoutes, FixtureAI } from "../providers/fixtures";
import { AppError } from "../errors";
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
        new OpenAIRecommender(),
      );
}
