import "react-native-url-polyfill/auto";
import {
  createClient,
  processLock,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";
import { secureSessionStorage } from "./secure-storage";

let client: SupabaseClient | null | undefined;
export const authRedirectUrl = "whimway://auth/callback";

export function getAuthClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL,
    key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return (client = null);
  client = createClient(url, key, {
    auth: {
      storage: secureSessionStorage,
      autoRefreshToken: true,
      persistSession: Platform.OS !== "web",
      detectSessionInUrl: false,
      flowType: "pkce",
      lock: processLock,
    },
  });
  return client;
}
export async function getAccessToken(): Promise<string | undefined> {
  const auth = getAuthClient();
  if (!auth) return undefined;
  const { data, error } = await auth.auth.getSession();
  if (error)
    throw new Error(
      "Your account session could not be restored. Sign in again or continue as a guest.",
    );
  return data.session?.access_token;
}
export async function requestSignIn(email: string): Promise<void> {
  const auth = getAuthClient();
  if (!auth)
    throw new Error(
      "Cloud accounts are not configured. You can still plan and save on this device.",
    );
  const { error } = await auth.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: authRedirectUrl },
  });
  if (error)
    throw new Error(
      "Could not send a sign-in link. Check your email and try again.",
    );
}
export async function completeAuthCallback(value: string): Promise<void> {
  const auth = getAuthClient();
  if (!auth) throw new Error("Cloud accounts are not configured.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("This sign-in link is invalid.");
  }
  if (
    url.protocol !== "whimway:" ||
    url.hostname !== "auth" ||
    url.pathname !== "/callback"
  )
    throw new Error("This sign-in link is invalid.");
  if (url.searchParams.has("error"))
    throw new Error(
      "This sign-in link has expired or was declined. Request another link.",
    );
  const code = url.searchParams.get("code");
  if (!code || code.length > 2048)
    throw new Error("This sign-in link is missing its authorization code.");
  const flowId = url.searchParams.get("sb_flow_id");
  if (flowId && flowId.length > 200)
    throw new Error("This sign-in link is invalid.");
  const { error } = await auth.auth.exchangeCodeForSession(
    code,
    flowId ? { flowId } : undefined,
  );
  if (error)
    throw new Error(
      "This link could not sign you in. Open a fresh link on the device that requested it.",
    );
}
export async function signOut(): Promise<void> {
  const auth = getAuthClient();
  if (!auth) return;
  const { error } = await auth.auth.signOut();
  if (error) throw new Error("Could not sign out. Please try again.");
}
export function startAuthLifecycle(): () => void {
  const auth = getAuthClient();
  if (!auth || Platform.OS === "web") return () => undefined;
  if (AppState.currentState === "active") auth.auth.startAutoRefresh();
  const listener = AppState.addEventListener("change", (state) => {
    if (state === "active") auth.auth.startAutoRefresh();
    else auth.auth.stopAutoRefresh();
  });
  return () => {
    listener.remove();
    auth.auth.stopAutoRefresh();
  };
}
