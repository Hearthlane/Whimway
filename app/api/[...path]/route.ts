import { NextResponse } from "next/server";
import { z } from "zod";
import {
  PlanRequest,
  PlanSpec,
  EditRequest,
  RemixRequest,
  MagicEditRequest,
  Point,
  interests,
  travelModes,
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
import { providerStats } from "@/lib/server/provider-context";
import { eventNames } from "@/lib/analytics";
import { summarize } from "@/lib/metrics";
import { allEvents, logEvent } from "@/lib/server/event-log";
import { doneSummary } from "@/lib/magic-edit";
import { Feedback, TasteProfile } from "@/lib/profile";
import { PollAnswer, SignalBatch, placeKeys, polls } from "@/lib/polls";
import {
  crowdSignals,
  invalidateCrowd,
  pollSignals,
  signalStore,
} from "@/lib/server/signals";
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
    if (path === "admin/metrics") {
      // Founder dashboard data. Needs ADMIN_KEY; open only in non-production demo mode.
      const key = process.env.ADMIN_KEY;
      const given =
        request.headers.get("x-admin-key") ?? url.searchParams.get("key");
      if (key ? given !== key : !demoAllowed())
        throw new AppError(
          "FORBIDDEN",
          "Set ADMIN_KEY and pass it to view metrics.",
          403,
        );
      const store = signalStore();
      const [tallies, pollTallies] = await Promise.all([
        store.tallies().catch(() => ({})),
        store.polls().catch(() => ({})),
      ]);
      return ok({
        summary: summarize(await allEvents()),
        tallies,
        polls: pollTallies,
      });
    }
    if (path === "crowd/places") {
      // Community ratings for specific venues; only keys with 5+ people are ever returned.
      const ids = z
        .string()
        .max(2000)
        .parse(url.searchParams.get("ids") ?? "")
        .split(",")
        .filter(Boolean)
        .slice(0, 12);
      const tallies = await signalStore()
        .tallies()
        .catch(() => ({}) as Record<string, { up: number; down: number }>);
      return ok(
        Object.fromEntries(
          ids.flatMap((id) => {
            const t = tallies[`place:${id.replace(/[^\w-]/g, "")}`];
            return t ? [[id, t]] : [];
          }),
        ),
      );
    }
    if (path === "polls") {
      const tallies = await signalStore()
        .polls()
        .catch(() => ({}));
      return ok({ polls, tallies });
    }
    if (path === "taste") {
      const { db, user } = await requireUser();
      const { data, error } = await db
        .from("profiles")
        .select("preferences")
        .eq("id", user.id)
        .maybeSingle();
      if (error)
        throw new AppError(
          "DATABASE_ERROR",
          "Could not load your taste profile.",
          503,
        );
      const taste = TasteProfile.safeParse(data?.preferences?.taste ?? null);
      return ok(taste.success ? taste.data : null);
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
        : path === "remix" || path === "edit" || path === "magic-edit"
          ? "remix"
          : [
                "events",
                "signals",
                "polls/answer",
                "errors",
                "feedback",
              ].includes(path)
            ? "signal"
            : "write",
      user?.id,
    );
    if (path === "point") return ok(await resolvePoint(Point.parse(input)));
    if (path === "generate") {
      const data = z
        .object({ request: PlanRequest, demo: z.boolean().default(false) })
        .parse(input);
      const started = Date.now();
      const result = await planner(data.request, data.demo)
        .withCrowd(await crowdSignals())
        .generate(data.request);
      // Cost-per-plan analytics: latency, provider attempts and AI tokens. No content.
      const stats = providerStats();
      telemetry("plan_generated", {
        ms: Date.now() - started,
        stops: result.stops.length,
        demo: result.demo,
        attempts: stats?.attempts,
        inputTokens: stats?.inputTokens,
        outputTokens: stats?.outputTokens,
      });
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
      const result = await planner(data.spec.request, data.spec.demo)
        .withCrowd(await crowdSignals())
        .generate(data.spec.request, data.spec, data.action);
      telemetry("plan_remixed");
      return ok(result);
    }
    if (path === "magic-edit") {
      const data = MagicEditRequest.parse(input);
      const started = Date.now();
      const result = await planner(data.spec.request, data.spec.demo)
        .withCrowd(await crowdSignals())
        .magicEdit(data.spec, data.instruction);
      const stats = providerStats();
      telemetry("magic_edit_applied", {
        kind: result.op.kind,
        replaced: result.op.targets.length,
        ms: Date.now() - started,
        attempts: stats?.attempts,
      });
      return ok({
        plan: result.plan,
        changed: result.changed,
        summary: result.op.summary,
        done: doneSummary(result.op.summary),
        kind: result.op.kind,
      });
    }
    if (path === "events") {
      const data = z
        .object({
          name: z.enum(eventNames),
          installId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
          props: z
            .record(
              z.string().max(40),
              z.union([z.string().max(80), z.number(), z.boolean()]),
            )
            .refine((p) => Object.keys(p).length <= 12)
            .default({}),
        })
        .parse(input);
      telemetry(`client_${data.name}`, data.props);
      await logEvent({
        name: data.name,
        installId: data.installId,
        at: new Date().toISOString(),
        props: data.props,
      });
      if (
        process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      ) {
        const db = await supabase();
        // Best effort: analytics must never break the product.
        await db.rpc("track_event", {
          event_name: data.name,
          install: data.installId,
          properties: data.props,
        });
      }
      return ok({ ok: true });
    }
    if (path === "polls/answer") {
      const answer = PollAnswer.parse(input);
      if (!polls.some((p) => p.id === answer.pollId))
        throw new AppError("NOT_FOUND", "That poll has ended.", 404);
      const store = signalStore();
      const tally = await store.answer(
        answer.pollId,
        answer.installId,
        answer.choice,
      );
      await store.record({
        installId: answer.installId,
        source: "poll",
        entries: pollSignals(answer.pollId, answer.choice),
      });
      invalidateCrowd();
      telemetry("poll_answered", {
        poll: answer.pollId,
        choice: answer.choice,
      });
      return ok({ tally });
    }
    if (path === "errors") {
      // Client crash reports: scrubbed to name / first message line / platform only.
      const report = z
        .object({
          name: z.string().max(60),
          message: z.string().max(200),
          platform: z.enum(["ios", "android", "web", "windows", "macos"]),
        })
        .parse(input);
      console.error(
        JSON.stringify({
          event: "client_error",
          ...report,
          at: new Date().toISOString(),
        }),
      );
      return ok({ logged: true });
    }
    if (path === "signals") {
      const batch = SignalBatch.parse(input);
      await signalStore().record(batch);
      invalidateCrowd();
      telemetry("signals_recorded", {
        source: batch.source,
        n: batch.entries.length,
        reason: batch.reason ?? null,
      });
      return ok({ recorded: batch.entries.length });
    }
    if (path === "feedback") {
      const feedback = Feedback.parse(input);
      telemetry("feedback_submitted", {
        went: feedback.went,
        rating: feedback.rating ?? null,
      });
      // Post-outing reactions are the strongest community signal: did people love it in real life?
      const installId = z
        .string()
        .regex(/^[A-Za-z0-9-]{8,64}$/)
        .safeParse(input.installId);
      if (installId.success && feedback.went !== "no" && feedback.stops.length)
        await signalStore()
          .record({
            installId: installId.data,
            source: "feedback",
            entries: feedback.stops
              .flatMap((st) =>
                placeKeys({
                  id: st.placeId,
                  category: st.category,
                  types: [],
                }).map((key) => ({ key, value: st.reaction })),
              )
              .slice(0, 16),
          })
          .then(invalidateCrowd)
          .catch(() => undefined);
      if (!user) return ok({ stored: "device" });
      const { db } = await requireUser();
      const { error } = await db.from("feedback").upsert(
        {
          user_id: user.id,
          plan_id: feedback.planId,
          went: feedback.went,
          rating: feedback.rating ?? null,
          stops: feedback.stops,
          note: feedback.note,
        },
        { onConflict: "user_id,plan_id" },
      );
      if (error)
        throw new AppError(
          "SAVE_FAILED",
          "Could not save feedback to your account. It is kept on this device.",
          503,
        );
      return ok({ stored: "account" });
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
        await planner(data.request, data.demo)
          .withCrowd(await crowdSignals())
          .explore(data.request, data.query),
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
    if (path === "taste") {
      const taste = TasteProfile.parse(input);
      const { db, user } = await requireUser();
      const { data } = await db
        .from("profiles")
        .select("preferences")
        .eq("id", user.id)
        .maybeSingle();
      const { error } = await db.from("profiles").upsert({
        id: user.id,
        preferences: { ...(data?.preferences ?? {}), taste },
      });
      if (error)
        throw new AppError(
          "SAVE_FAILED",
          "Could not sync your taste profile.",
          503,
        );
      return ok({ saved: true });
    }
    if (path === "profile") {
      const preferences = z
        .object({
          enabled: z.boolean(),
          interests: z.array(z.enum(interests)).max(10),
          dietary: z.string().max(300),
          accessibility: z.string().max(300),
          mode: z.enum(travelModes),
          budget: z.number().min(0).max(1000000),
          cuisines: z.string().max(200),
          atmosphere: z.string().max(200),
          disliked: z.array(z.string().max(250)).max(100),
        })
        .parse(input);
      const { db, user } = await requireUser();
      const { data: existing } = await db
        .from("profiles")
        .select("preferences")
        .eq("id", user.id)
        .maybeSingle();
      const { error } = await db.from("profiles").upsert({
        id: user.id,
        // Keep the app's taste profile when the web preferences form saves.
        preferences: existing?.preferences?.taste
          ? { ...preferences, taste: existing.preferences.taste }
          : preferences,
      });
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
