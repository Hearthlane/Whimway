import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { AppError } from "../errors";
import { meteredFetch } from "./usage";
const clients = new WeakMap<Request, Promise<SupabaseClient>>();
const users = new WeakMap<Request, Promise<User | null>>();
const sessionFetch: typeof fetch = (input, init) => meteredFetch(input, {
  ...init,
  signal: AbortSignal.any([AbortSignal.timeout(15000), ...(init?.signal ? [init.signal] : [])]),
});
function accessToken(request?: Request) {
  const authorization = request?.headers.get("authorization");
  if (!authorization) return undefined;
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  if (!match || match[1].length > 8192)
    throw new AppError("INVALID_AUTH", "Sign in again to continue.", 401);
  return match[1];
}
export async function supabase(request?: Request): Promise<SupabaseClient> {
  if (request) {
    const cached = clients.get(request);
    if (cached) return cached;
    const result = createDatabase(request);
    clients.set(request, result);
    return result;
  }
  return createDatabase();
}
async function createDatabase(request?: Request): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key)
    throw new AppError(
      "PERSISTENCE_DISABLED",
      "Cloud saving and sharing need Supabase configuration. You can still save plans on this device.",
      503,
    );
  const token = accessToken(request);
  if (token || (request && !request.headers.has("origin") && !request.headers.has("cookie")))
    return createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: sessionFetch, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) },
    });
  const jar = await cookies();
  return createServerClient(url, key, {
    global: { fetch: sessionFetch },
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    },
    cookies: {
      getAll() {
        return jar.getAll();
      },
      setAll(items) {
        for (const item of items) jar.set(item.name, item.value, item.options);
      },
    },
  });
}
export async function currentUser(request?: Request): Promise<User | null> {
  if (request) {
    const cached = users.get(request);
    if (cached) return cached;
    const result = verifiedUser(request);
    users.set(request, result);
    return result;
  }
  return verifiedUser();
}
async function verifiedUser(request?: Request): Promise<User | null> {
  const token = accessToken(request);
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ) {
    if (token)
      throw new AppError("PERSISTENCE_DISABLED", "Account services are not configured.", 503);
    return null;
  }
  if (request && !token && !request.headers.has("cookie")) return null;
  try {
    const db = await supabase(request);
    // Validate with Supabase Auth, never decode or trust a caller-provided ID.
    const { data, error } = await db.auth.getUser(token);
    if (token && error && (error.status === 0 || (error.status ?? 500) >= 500))
      throw new AppError("AUTH_UNAVAILABLE", "Could not verify your session. Try again.", 503);
    if (token && (error || !data.user))
      throw new AppError("INVALID_AUTH", "Your session has expired. Sign in again.", 401);
    return data.user;
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (token)
      throw new AppError("AUTH_UNAVAILABLE", "Could not verify your session. Try again.", 503);
    return null;
  }
}
export async function requireUser(request?: Request) {
  const db = await supabase(request);
  const user = await currentUser(request);
  if (!user)
    throw new AppError(
      "SIGN_IN_REQUIRED",
      "Sign in to save or share plans across devices.",
      401,
    );
  return { db, user };
}
