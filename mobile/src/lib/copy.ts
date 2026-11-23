import type { interests, PlanRequest, Vibe } from "@shared/schema";
import type { IconName } from "@/ui/kit";

export const companionCopy: Record<NonNullable<PlanRequest["companions"]>, { label: string; hint: string; icon: IconName }> = {
  partner: { label: "Someone special", hint: "A partner, or a date", icon: "heart" },
  friends: { label: "Friends", hint: "Hangouts with the crew", icon: "users" },
  solo: { label: "Just me", hint: "Solo adventures", icon: "user" },
  family: { label: "Family", hint: "Something for everyone", icon: "home" },
};
export const vibeCopy: Record<Vibe, { label: string; hint: string; icon: IconName }> = {
  romantic: { label: "Romantic", hint: "Candlelight, views", icon: "heart" },
  adventurous: { label: "Adventurous", hint: "Say yes to new", icon: "compass" },
  cozy: { label: "Cozy", hint: "Warm, slow, snug", icon: "moon" },
  cinematic: { label: "Cinematic", hint: "Movies, views, great photos", icon: "film" },
  chill: { label: "Chill", hint: "Low-key and easy", icon: "sunset" },
  lively: { label: "Lively", hint: "Buzz and music", icon: "zap" },
  artsy: { label: "Artsy", hint: "Galleries, culture", icon: "aperture" },
  foodie: { label: "Foodie", hint: "Eat your way around", icon: "coffee" },
  outdoorsy: { label: "Outdoorsy", hint: "Parks & fresh air", icon: "sun" },
  playful: { label: "Playful", hint: "Games, friendly rivalry", icon: "smile" },
};
export const interestCopy: Record<(typeof interests)[number], IconName> = {
  "Food & drinks": "coffee",
  Shopping: "shopping-bag",
  "Interactive fun": "target",
  Outdoors: "sun",
  "Arts & culture": "aperture",
  Relaxation: "feather",
  Nightlife: "moon",
  Family: "users",
  "Hidden gems": "key",
  "Surprise me": "gift",
};
export const modeCopy: Record<PlanRequest["mode"], { label: string; icon: IconName; verb: string }> = {
  WALK: { label: "Walking", icon: "navigation", verb: "walk" },
  TRANSIT: { label: "Transit", icon: "git-commit", verb: "transit" },
  DRIVE: { label: "Driving", icon: "truck", verb: "drive" },
};
export const examplePrompts = [
  { title: "Cinematic & romantic", prompt: "Something cinematic and romantic tonight for the two of us", icon: "film" as IconName },
  { title: "Squad Saturday", prompt: "An adventurous Saturday with three friends under $40 each", icon: "users" as IconName },
  { title: "Rainy day hideaway", prompt: "Plan a cozy rainy afternoon with cafés and hidden gems", icon: "umbrella" as IconName },
  { title: "Family day out", prompt: "A full Saturday with the kids, 10am to 5pm, lunch included", icon: "sun" as IconName },
  { title: "Sober first date", prompt: "First date, no alcohol, somewhere quiet where we can talk", icon: "coffee" as IconName },
  { title: "Birthday surprise", prompt: "Surprise me with a memorable birthday experience for my partner", icon: "gift" as IconName },
];
export function money(n: number, currency = "CAD") {
  const rounded = Math.round(n);
  return `${currency === "CAD" || currency === "USD" ? "$" : ""}${rounded}${currency === "CAD" || currency === "USD" ? "" : ` ${currency}`}`;
}
