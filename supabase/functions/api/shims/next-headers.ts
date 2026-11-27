// Stand-in for next/headers on Supabase Edge Functions. The app signs in with a bearer token,
// so cookies are read-only here (the cookie-based web pages are not served from this function).
import { currentRequest } from "./request-context";

export async function headers() {
  return currentRequest()?.headers ?? new Headers();
}

export async function cookies() {
  const raw = currentRequest()?.headers.get("cookie") ?? "";
  const all = raw
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const i = part.indexOf("=");
      return { name: decodeURIComponent(part.slice(0, i)), value: decodeURIComponent(part.slice(i + 1)) };
    });
  return {
    getAll: () => all,
    get: (name: string) => all.find((c) => c.name === name),
    set: () => undefined,
  };
}
