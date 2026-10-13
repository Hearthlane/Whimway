import { NextResponse } from "next/server";
import { z } from "zod";
import {
  PlanRequest,
  PlanSpec,
  EditRequest,
  RemixRequest,
  Point,
  interests,
} from "@/lib/schema";
import { planner, demoAllowed } from "@/lib/server/providers";
import {
  GooglePlaces,
  autocomplete,
  resolvePoint,
  photoUrl,
} from "@/lib/providers/google";
import { fixtureLocations } from "@/lib/providers/fixtures";
import { currentUser, requireUser, supabase } from "@/lib/server/supabase";
import {
  body,
  rateLimit,
  telemetry,
  sameOrigin,
  requestOrigin,
} from "@/lib/server/security";
import { AppError } from "@/lib/errors";
import { withProviderContext } from "@/lib/server/provider-context";
import { publicSpec, persistSpec } from "@/lib/storage";
export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
const ok = (data: unknown) =>
  NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
function failure(e: unknown) {
  if (e instanceof z.ZodError)
    return NextResponse.json(
      {
        error:
          "Some inputs are invalid. Check the location, date, time and constraints.",
        code: "INVALID_INPUT",
      },
      { status: 400 },
    );
  if (e instanceof AppError)
    return NextResponse.json(
      { error: e.message, code: e.code },
      { status: e.status },
    );
  telemetry("request_failed");
  return NextResponse.json(
    {
      error: "Something went wrong. Please try again.",
      code: "INTERNAL_ERROR",
    },
    { status: 500 },
  );
}
export async function GET(request: Request, ctx: Context) {
  return withProviderContext(request.signal, () => handleGET(request, ctx));
}
async function handleGET(request: Request, ctx: Context) {
  try {
    const path = (await ctx.params).path.join("/");
    const url = new URL(request.url);
    if (path === "status") {
      const user = await currentUser();
      return ok({
        places: Boolean(process.env.GOOGLE_MAPS_SERVER_KEY),
        maps: Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY),
        ai: Boolean(
          (process.env.WHIMWAY_OPENAI_KEY || process.env.OPENAI_API_KEY) &&
          (process.env.WHIMWAY_OPENAI_MODEL || process.env.OPENAI_MODEL),
        ),
        cloud: Boolean(
          process.env.NEXT_PUBLIC_SUPABASE_URL &&
          process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        ),
        demo: demoAllowed(),
        user: user ? { id: user.id, email: user.email } : null,
      });
    }
    if (path === "auth/signout") {
      throw new AppError("METHOD", "Use the sign-out button.", 405);
    }
    await rateLimit(request, "read", (await currentUser())?.id);
    if (path === "autocomplete") {
      const input = z.string().min(2).max(150).parse(url.searchParams.get("q"));
      const session = z.string().uuid().parse(url.searchParams.get("session"));
      if (url.searchParams.get("demo") === "true" && demoAllowed())
        return ok(
          fixtureLocations
            .filter((l) => l.name.toLowerCase().includes(input.toLowerCase()))
            .map((l) => ({ id: l.placeId, text: l.name })),
        );
      return ok(await autocomplete(input, session));
    }
    if (path === "location") {
      const id = z.string().min(1).max(250).parse(url.searchParams.get("id"));
      if (url.searchParams.get("demo") === "true" && demoAllowed()) {
        const place = fixtureLocations.find((l) => l.placeId === id);
        if (!place)
          throw new AppError("NOT_FOUND", "Fixture location not found.", 404);
        return ok(place);
      }
      const session = url.searchParams.get("session");
      if (session) z.string().uuid().parse(session);
      return ok(await new GooglePlaces().location(id, session ?? undefined));
    }
    if (path === "photo")
      return NextResponse.redirect(
        await photoUrl(
          z.string().max(1500).parse(url.searchParams.get("name")),
        ),
        { headers: { "Cache-Control": "no-store" } },
      );
    if (path === "plans") {
      const { db } = await requireUser();
      const { data, error } = await db
        .from("plans")
        .select("id,spec,updated_at")
        .order("updated_at", { ascending: false })
        .limit(100);
      if (error)
        throw new AppError(
          "DATABASE_ERROR",
          "Could not load saved plans. Check the Supabase migration.",
          503,
        );
      return ok(data);
    }
    if (path.startsWith("plans/")) {
      const id = z.string().uuid().parse(path.slice(6));
      const { db } = await requireUser();
      const { data, error } = await db
        .from("plans")
        .select("spec")
        .eq("id", id)
        .single();
      if (error)
        throw new AppError(
          "NOT_FOUND",
          "This plan is missing or belongs to another account.",
          404,
        );
      return ok(data.spec);
    }
    if (path.startsWith("shared/")) {
      const id = z.string().uuid().parse(path.slice(7));
      const db = await supabase();
      const { data, error } = await db.rpc("read_shared_plan", { token: id });
      if (error || !data)
        throw new AppError(
          "SHARE_NOT_FOUND",
          "This shared plan is unavailable or was unshared.",
          404,
        );
      return ok(data);
    }
    if (path === "profile") {
      const { db, user } = await requireUser();
      const { data, error } = await db
        .from("profiles")
        .select("preferences")
        .eq("id", user.id)
        .maybeSingle();
      if (error)
        throw new AppError(
          "DATABASE_ERROR",
          "Could not load preferences.",
          503,
        );
      return ok(data?.preferences ?? {});
    }
    throw new AppError("NOT_FOUND", "Not found.", 404);
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request, ctx: Context) {
  return withProviderContext(request.signal, () => handlePOST(request, ctx));
}
async function handlePOST(request: Request, ctx: Context) {
  try {
    const path = (await ctx.params).path.join("/");
    const input = await body(request);
    const user = await currentUser();
    await rateLimit(
      request,
      path === "generate"
        ? "generate"
        : path === "remix" || path === "edit"
          ? "remix"
          : "write",
      user?.id,
    );
    if (path === "point") return ok(await resolvePoint(Point.parse(input)));
    if (path === "generate") {
      const data = z
        .object({ request: PlanRequest, demo: z.boolean().default(false) })
        .parse(input);
      const result = await planner(data.request, data.demo).generate(
        data.request,
      );
      telemetry("plan_generated");
      return ok(result);
    }
    if (path === "hydrate") {
      const spec = PlanSpec.parse(input);
      return ok(await planner(spec.request, spec.demo).hydrate(spec));
    }
    if (path === "edit") {
      const data = EditRequest.parse(input);
      for (const lock of data.spec.stops.filter((s) => s.locked)) {
        const updated = data.stops.find((s) => s.placeId === lock.placeId);
        if (
          !updated ||
          updated.minutes !== lock.minutes ||
          updated.reason !== lock.reason
        )
          throw new AppError(
            "LOCK_CONFLICT",
            "Unlock this stop before changing or removing it.",
            422,
          );
      }
      const spec = {
        ...data.spec,
        request: data.request ?? data.spec.request,
        areaSource: data.request ? ("user" as const) : data.spec.areaSource,
        stops: data.stops,
      };
      const result = await planner(spec.request, spec.demo).edit(spec);
      telemetry("plan_edited");
      return ok(result);
    }
    if (path === "remix") {
      const data = RemixRequest.parse(input);
      const result = await planner(data.spec.request, data.spec.demo).generate(
        data.spec.request,
        data.spec,
        data.action,
      );
      telemetry("plan_remixed");
      return ok(result);
    }
    if (path === "explore") {
      const data = z
        .object({
          request: PlanRequest,
          query: z.string().max(150).optional(),
          demo: z.boolean().default(false),
        })
        .parse(input);
      return ok(
        await planner(data.request, data.demo).explore(
          data.request,
          data.query,
        ),
      );
    }
    if (path === "place") {
      const data = z
        .object({
          id: z.string().max(250),
          currency: z.string().length(3),
          request: PlanRequest,
          demo: z.boolean(),
        })
        .parse(input);
      if (data.demo) {
        const { FixturePlaces } = await import("@/lib/providers/fixtures");
        if (!demoAllowed())
          throw new AppError("DEMO_DISABLED", "Fixtures are disabled.", 403);
        return ok(await new FixturePlaces(data.request).details(data.id));
      }
      return ok(await new GooglePlaces().details(data.id, data.currency));
    }
    if (path === "plans") {
      const spec = PlanSpec.parse(input);
      if (spec.demo)
        throw new AppError(
          "FIXTURE_ONLY",
          "Fixture plans can be saved locally, but not published to cloud storage.",
        );
      const { db, user } = await requireUser();
      const { error } = await db.from("plans").upsert({
        id: spec.id,
        user_id: user.id,
        spec: persistSpec(spec),
        updated_at: new Date().toISOString(),
      });
      if (error)
        throw new AppError(
          "SAVE_FAILED",
          "Cloud saving failed. Your device copy is still available.",
          503,
        );
      telemetry("plan_saved");
      return ok({ id: spec.id });
    }
    if (path === "share") {
      const id = z.string().uuid().parse(input.id);
      const { db, user } = await requireUser();
      const { data, error } = await db
        .from("plans")
        .select("spec")
        .eq("id", id)
        .single();
      if (error || !data)
        throw new AppError(
          "SAVE_FIRST",
          "Save this plan to your account before sharing.",
          404,
        );
      const { data: share, error: err } = await db
        .from("shares")
        .insert({
          plan_id: id,
          user_id: user.id,
          spec: publicSpec(PlanSpec.parse(data.spec)),
        })
        .select("id")
        .single();
      if (err)
        throw new AppError(
          "SHARE_FAILED",
          "Sharing failed. Check your Supabase setup.",
          503,
        );
      telemetry("plan_shared");
      return ok({ shareId: share.id });
    }
    if (path === "auth/signin") {
      const email = z.string().email().max(254).parse(input.email);
      const db = await supabase();
      const { error } = await db.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${requestOrigin(request)}/auth/callback`,
        },
      });
      if (error)
        throw new AppError(
          "AUTH_FAILED",
          "Could not send your sign-in email. Check authentication settings.",
          502,
        );
      return ok({ sent: true });
    }
    if (path === "auth/signout") {
      const db = await supabase();
      const { error } = await db.auth.signOut();
      if (error) throw new AppError("AUTH_FAILED", "Could not sign out.", 502);
      return ok({ signedOut: true });
    }
    if (path === "profile") {
      const preferences = z
        .object({
          enabled: z.boolean(),
          interests: z.array(z.enum(interests)).max(10),
          dietary: z.string().max(300),
          accessibility: z.string().max(300),
          mode: z.enum(["WALK", "DRIVE"]),
          budget: z.number().min(0).max(1000000),
          cuisines: z.string().max(200),
          atmosphere: z.string().max(200),
          disliked: z.array(z.string().max(250)).max(100),
        })
        .parse(input);
      const { db, user } = await requireUser();
      const { error } = await db
        .from("profiles")
        .upsert({ id: user.id, preferences });
      if (error)
        throw new AppError("SAVE_FAILED", "Could not save preferences.", 503);
      return ok({ saved: true });
    }
    throw new AppError("NOT_FOUND", "Not found.", 404);
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(request: Request, ctx: Context) {
  try {
    sameOrigin(request);
    const path = (await ctx.params).path.join("/");
    const { db, user } = await requireUser();
    await rateLimit(request, "write", user.id);
    if (path.startsWith("plans/")) {
      const id = z.string().uuid().parse(path.slice(6));
      const { error } = await db.from("plans").delete().eq("id", id);
      if (error)
        throw new AppError("DELETE_FAILED", "Could not delete this plan.", 503);
      return ok({ deleted: true });
    }
    if (path.startsWith("shares/")) {
      const id = z.string().uuid().parse(path.slice(7));
      const { error } = await db.from("shares").delete().eq("id", id);
      if (error)
        throw new AppError("DELETE_FAILED", "Could not revoke sharing.", 503);
      return ok({ deleted: true });
    }
    if (path === "profile") {
      const { error } = await db.from("profiles").delete().eq("id", user.id);
      if (error)
        throw new AppError(
          "DELETE_FAILED",
          "Could not delete preferences.",
          503,
        );
      return ok({ deleted: true });
    }
    if (path === "account") {
      const { error } = await db.rpc("delete_own_account");
      if (error)
        throw new AppError(
          "DELETE_FAILED",
          "Could not delete your account.",
          503,
        );
      await db.auth.signOut();
      return ok({ deleted: true });
    }
    throw new AppError("NOT_FOUND", "Not found.", 404);
  } catch (e) {
    return failure(e);
  }
}
