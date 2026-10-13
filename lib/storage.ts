import { PlanSpec, type Itinerary } from "./schema";
export function persistSpec(input: PlanSpec): PlanSpec {
  const spec = PlanSpec.parse(input);
  if (spec.areaSource === "shared-stops")
    return {
      ...spec,
      request: {
        ...spec.request,
        location: { ...spec.request.location, center: { lat: 0, lng: 0 } },
        area: { ...spec.request.area, center: { lat: 0, lng: 0 } },
      },
    };
  if (spec.demo || !spec.request.location.placeId) return spec;
  return {
    ...spec,
    areaSource: "place-reference",
    request: {
      ...spec.request,
      location: {
        ...spec.request.location,
        name: "Selected area",
        center: { lat: 0, lng: 0 },
      },
      area: { ...spec.request.area, center: { lat: 0, lng: 0 } },
    },
  };
}
export function publicSpec(input: PlanSpec): PlanSpec {
  return {
    ...PlanSpec.parse(input),
    areaSource: "shared-stops",
    summary: "A shared Whimway outing.",
    request: {
      ...input.request,
      prompt: "",
      excludedPlaceIds: [],
      dietary: "",
      accessibility: "",
      companion: undefined,
      energy: undefined,
      vibes: undefined,
      start: undefined,
      end: undefined,
      location: {
        ...input.request.location,
        name: "Shared exploration area",
        placeId: undefined,
        center: { lat: 0, lng: 0 },
      },
      area: {
        ...input.request.area,
        center: { lat: 0, lng: 0 },
        locked: false,
      },
    },
    stops: input.stops.map((s) => ({
      ...s,
      reason: "Part of this shared outing.",
    })),
  };
}
export function saveLocal(plan: Itinerary) {
  const spec = persistSpec(PlanSpec.parse(plan)); // Store references and user choices; hydrate provider-derived area data later.
  const all = getLocal();
  all[spec.id] = spec;
  try {
    localStorage.setItem("whimway:plans", JSON.stringify(all));
  } catch {
    throw new Error("Device storage is full or unavailable. Try cloud saving.");
  }
}
export function getLocal(): Record<string, PlanSpec> {
  if (typeof window === "undefined") return {};
  try {
    const value = JSON.parse(localStorage.getItem("whimway:plans") ?? "{}");
    const result: Record<string, PlanSpec> = {};
    for (const [id, s] of Object.entries(value)) {
      const parsed = PlanSpec.safeParse(s);
      if (parsed.success) result[id] = parsed.data;
    }
    return result;
  } catch {
    return {};
  }
}
export function removeLocal(id: string) {
  const all = getLocal();
  delete all[id];
  localStorage.setItem("whimway:plans", JSON.stringify(all));
}
