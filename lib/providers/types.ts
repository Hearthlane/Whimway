import type {
  CandidatePlace,
  Location,
  PlanRequest,
  Point,
  Selection,
  TravelLeg,
  PlanSpec,
} from "../schema";
export interface PlacesProvider {
  search(request: PlanRequest, query?: string): Promise<CandidatePlace[]>;
  details(id: string, currency: string): Promise<CandidatePlace>;
  location(id: string, session?: string): Promise<Location>;
}
export interface RouteProvider {
  leg(
    from: Point,
    to: Point,
    mode: PlanRequest["mode"],
    fromId: string,
    toId: string,
  ): Promise<TravelLeg>;
}
export interface RecommendationProvider {
  select(
    request: PlanRequest,
    candidates: CandidatePlace[],
    locked: { placeId: string; minutes: number; reason: string }[],
    action?: string,
    previousStops?: PlanSpec["stops"],
  ): Promise<Selection>;
}
