import { PlanSpec } from "./schema";
import { publicSpec } from "./storage";

/**
 * Account-free share links. The redacted public spec (place IDs, times, title —
 * never prompts, dietary/accessibility needs, taste profile or route anchors) is
 * encoded in the URL *fragment*, which browsers never send to the server. The
 * recipient's page hydrates live venue data from the IDs.
 */
const toBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};
const fromBase64Url = (value: string) => {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};

export function encodeShare(spec: PlanSpec) {
  const pub = publicSpec(PlanSpec.parse(spec));
  return toBase64Url(new TextEncoder().encode(JSON.stringify(pub)));
}

export function decodeShare(fragment: string): PlanSpec {
  if (fragment.length > 12000)
    throw new Error("This link is too long to be a Whimway plan.");
  const json = new TextDecoder().decode(
    fromBase64Url(fragment.replace(/^#/, "")),
  );
  return PlanSpec.parse({ ...JSON.parse(json), areaSource: "shared-stops" });
}

export function shareUrl(origin: string, spec: PlanSpec) {
  return `${origin.replace(/\/$/, "")}/p#${encodeShare(spec)}`;
}
