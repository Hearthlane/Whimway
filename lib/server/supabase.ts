import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { AppError } from "../errors";
export async function supabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key)
    throw new AppError(
      "PERSISTENCE_DISABLED",
      "Cloud saving and sharing need Supabase configuration. You can still save plans on this device.",
      503,
    );
  const jar = await cookies();
  return createServerClient(url, key, {
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
export async function currentUser() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  )
    return null;
  try {
    const db = await supabase();
    const { data } = await db.auth.getUser();
    return data.user;
  } catch {
    return null;
  }
}
export async function requireUser() {
  const db = await supabase();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user)
    throw new AppError(
      "SIGN_IN_REQUIRED",
      "Sign in to save or share plans across devices.",
      401,
    );
  return { db, user: data.user };
}
