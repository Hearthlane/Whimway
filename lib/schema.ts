import { z } from "zod";
export const Point = z.object({
  lat: z.number().min(-85).max(85),
  lng: z.number().min(-180).max(180),
});
export const AreaBoundary = z.object({
  center: Point,
  radius: z.number().min(100).max(20000),
  locked: z.boolean(),
});
export const Location = z.object({
  name: z.string().min(1).max(200),
  placeId: z.string().max(250).optional(),
  center: Point,
  timezone: z.string().min(1).max(80),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
export const interests = [
  "Food & drinks",
  "Shopping",
  "Interactive fun",
  "Outdoors",
  "Arts & culture",
  "Relaxation",
  "Nightlife",
  "Family",
  "Hidden gems",
  "Surprise me",
] as const;
export const PlanRequest = z.object({
  location: Location,
  area: AreaBoundary,
  prompt: z.string().max(1500).default(""),
  interests: z.array(z.enum(interests)).max(10).default(["Surprise me"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  duration: z.number().int().min(60).max(720),
  budget: z.number().min(0).max(1000000),
  hardBudget: z.boolean().default(false),
  participants: z.number().int().min(1).max(20),
  mode: z.enum(["WALK", "DRIVE"]),
  excludedPlaceIds: z.array(z.string().max(250)).max(100).default([]),
  dietary: z.string().max(300).default(""),
  accessibility: z.string().max(300).default(""),
  start: Point.optional(),
  end: Point.optional(),
});
export type PlanRequest = z.infer<typeof PlanRequest>;
export type Point = z.infer<typeof Point>;
export type Location = z.infer<typeof Location>;
export const PlacePhoto = z.object({
  name: z.string(),
  authors: z.array(z.object({ name: z.string(), uri: z.string().optional() })),
});
export const PriceEstimate = z.object({
  low: z.number().nonnegative().nullable(),
  high: z.number().nonnegative().nullable(),
  currency: z.string(),
  source: z.enum(["provider-range", "free-browse", "unknown"]),
  confidence: z.enum(["published-range", "category-estimate", "unknown"]),
  optional: z.boolean(),
});
export type PriceEstimate = z.infer<typeof PriceEstimate>;
export const HoursConfidence = z.enum(["applicable", "typical", "unknown"]);
export const OpeningPoint = z.object({
  day: z.number().int().min(0).max(6),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  truncated: z.boolean().optional(),
});
export const OpeningPeriod = z.object({
  open: OpeningPoint,
  close: OpeningPoint.optional(),
});
export type OpeningPeriod = z.infer<typeof OpeningPeriod>;
export const CandidatePlace = z.object({
  id: z.string(),
  name: z.string(),
  point: Point,
  address: z.string(),
  category: z.string(),
  types: z.array(z.string()),
  mapsUrl: z.string(),
  website: z.string().optional(),
  rating: z.number().optional(),
  reviews: z.number().optional(),
  businessStatus: z.string().optional(),
  photos: z.array(PlacePhoto),
  price: PriceEstimate,
  hours: z.array(z.string()),
  periods: z.array(OpeningPeriod),
  regularPeriods: z.array(OpeningPeriod).default([]),
  hoursWindow: z.object({ from: z.string(), to: z.string() }).optional(),
  timezone: z.string().optional(),
  hoursSource: z.enum(["applicable", "typical", "unknown"]),
  hoursDate: z.string().optional(),
  hoursDates: z.array(z.string()).optional(),
  wheelchairAccessible: z.boolean().optional(),
});
export type CandidatePlace = z.infer<typeof CandidatePlace>;
export const TravelLeg = z.object({
  from: z.string(),
  to: z.string(),
  minutes: z.number(),
  meters: z.number(),
  polyline: z.string(),
  verified: z.boolean(),
});
export type TravelLeg = z.infer<typeof TravelLeg>;
export const StopRef = z.object({
  placeId: z.string().min(1).max(250),
  minutes: z.number().int().min(15).max(240),
  locked: z.boolean(),
  reason: z.string().max(240),
});
export const ItineraryStop = StopRef.extend({
  place: CandidatePlace,
  arrival: z.string(),
  departure: z.string(),
  travel: z.number(),
  hoursStatus: z.string(),
  hoursConfidence: HoursConfidence.default("unknown"),
});
export type ItineraryStop = z.infer<typeof ItineraryStop>;
export const ValidationIssue = z.object({
  code: z.string(),
  message: z.string(),
  severity: z.enum(["warning", "error"]),
});
export type ValidationIssue = z.infer<typeof ValidationIssue>;
export const PlanSpec = z.object({
  id: z.string().uuid(),
  title: z.string().max(120),
  summary: z.string().max(350),
  request: PlanRequest,
  stops: z.array(StopRef).max(8),
  demo: z.boolean(),
  areaSource: z
    .enum(["user", "place-reference", "shared-stops"])
    .default("user"),
  revision: z.number().int().nonnegative(),
});
export type PlanSpec = z.infer<typeof PlanSpec>;
export const Itinerary = PlanSpec.extend({
  stops: z.array(ItineraryStop),
  legs: z.array(TravelLeg),
  issues: z.array(ValidationIssue),
  totalMinutes: z.number(),
  totalMeters: z.number(),
  cost: z.object({
    low: z.number(),
    high: z.number(),
    unknown: z.number(),
    currency: z.string(),
  }),
  createdAt: z.string(),
});
export type Itinerary = z.infer<typeof Itinerary>;
export const remixActions = [
  "Make it cheaper",
  "Less walking",
  "More exciting",
  "More relaxing",
  "More food",
  "More hidden gems",
  "Make it shorter",
  "Surprise me",
] as const;
export const RemixRequest = z.object({
  spec: PlanSpec,
  action: z.enum(remixActions),
});
export const EditRequest = z.object({
  spec: PlanSpec,
  stops: z.array(StopRef).min(1).max(8),
  request: PlanRequest.optional(),
});
export const Selection = z.object({
  title: z.string().max(120),
  summary: z.string().max(350),
  stops: z
    .array(
      z.object({
        placeId: z.string(),
        minutes: z.number().int().min(15).max(180),
        reason: z.string().max(240),
      }),
    )
    .min(1)
    .max(8),
});
export type Selection = z.infer<typeof Selection>;
export function toSpec(plan: Itinerary): PlanSpec {
  return PlanSpec.parse(plan);
}
