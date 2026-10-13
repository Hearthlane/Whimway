import { NextResponse } from "next/server";
import { requestOrigin } from "@/lib/server/security";
import { supabase } from "@/lib/server/supabase";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    try {
      const db = await supabase();
      const { error } = await db.auth.exchangeCodeForSession(code);
      if (!error)
        return NextResponse.redirect(
          new URL("/profile", requestOrigin(request)),
        );
    } catch {}
  }
  return NextResponse.redirect(
    new URL("/profile?authError=1", requestOrigin(request)),
  );
}
