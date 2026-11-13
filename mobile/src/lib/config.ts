import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * Where the Whimway API (the Next.js server in the repo root) lives.
 * - EXPO_PUBLIC_API_URL wins when set (staging/production).
 * - Web builds served behind the same origin use relative URLs.
 * - In development on a device, reuse the Metro host's LAN address on port 3000.
 */
function devHost() {
  const hostUri = Constants.expoConfig?.hostUri ?? "";
  const host = hostUri.split(":")[0];
  return host ? `http://${host}:3000` : "http://localhost:3000";
}
export const API_URL = (
  process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === "web" ? "" : devHost())
).replace(/\/$/, "");
/** Public web origin used in share links (recipients open plans without installing). */
export const SHARE_ORIGIN = (
  process.env.EXPO_PUBLIC_SHARE_ORIGIN ??
  (API_URL || (typeof window !== "undefined" ? window.location.origin : "https://whimway.app"))
).replace(/\/$/, "");
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
export const cloudConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);
