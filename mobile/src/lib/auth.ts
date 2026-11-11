import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Platform } from "react-native";
import { cloudConfigured, SUPABASE_KEY, SUPABASE_URL } from "./config";

/**
 * Supabase is used on device for authentication only (email one-time code).
 * All data access goes through the Whimway API with the user's access token,
 * where Postgres row-level security enforces ownership.
 */
export const supabase: SupabaseClient | null = cloudConfigured
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        storage: AsyncStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: Platform.OS === "web",
      },
    })
  : null;

export async function accessToken() {
  if (!supabase) return undefined;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token;
}
