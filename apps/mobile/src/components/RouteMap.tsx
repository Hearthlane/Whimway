// TypeScript's ordinary resolver needs a platform-neutral entry point. Metro
// selects RouteMap.native.tsx or RouteMap.web.tsx before this fallback.
export { default, RouteMap } from "./RouteMap.web";
export type { RouteMapProps } from "./RouteMap.types";
