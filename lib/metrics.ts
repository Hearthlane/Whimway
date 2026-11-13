/** Product metrics computed from the anonymous event log. Pure, so it is easy to test. */
export type LoggedEvent = {
  name: string;
  installId: string;
  at: string;
  props?: Record<string, string | number | boolean>;
};

const funnelSteps = [
  "app_opened",
  "onboarding_completed",
  "plan_generated",
  "plan_saved",
  "plan_shared",
  "navigation_opened",
  "feedback_submitted",
] as const;
const dayOf = (iso: string) => iso.slice(0, 10);
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

export function summarize(events: LoggedEvent[], now = new Date(), days = 14) {
  const installs = (name: string) =>
    new Set(events.filter((e) => e.name === name).map((e) => e.installId)).size;
  const count = (name: string) => events.filter((e) => e.name === name).length;

  // Daily history for the headline events.
  const series = Array.from({ length: days }, (_, i) => {
    const d = new Date(now.getTime() - (days - 1 - i) * 86400000)
      .toISOString()
      .slice(0, 10);
    const on = events.filter((e) => dayOf(e.at) === d);
    return {
      day: d,
      active: new Set(on.map((e) => e.installId)).size,
      plans: on.filter((e) => e.name === "plan_generated").length,
      saves: on.filter((e) => e.name === "plan_saved").length,
      shares: on.filter((e) => e.name === "plan_shared").length,
    };
  });

  // Repeat planning: installs whose plans span more than 12 hours, within 7 and 30 days of their first.
  const firstPlan = new Map<string, number>();
  const later = new Map<string, number[]>();
  for (const e of events
    .filter((x) => x.name === "plan_generated")
    .sort((a, b) => a.at.localeCompare(b.at))) {
    const t = Date.parse(e.at);
    if (!firstPlan.has(e.installId)) firstPlan.set(e.installId, t);
    else later.set(e.installId, [...(later.get(e.installId) ?? []), t]);
  }
  const repeatWithin = (d: number) =>
    [...firstPlan].filter(([id, t0]) =>
      (later.get(id) ?? []).some(
        (t) => t - t0 > 12 * 3600000 && t - t0 <= d * 86400000,
      ),
    ).length;

  const feedback = events.filter((e) => e.name === "feedback_submitted");
  const went = feedback.filter(
    (e) => e.props?.went === "yes" || e.props?.went === "partly",
  ).length;
  const reasons: Record<string, number> = {};
  for (const e of events.filter(
    (x) => x.name === "plan_pulse" && x.props?.value === -1,
  )) {
    const r = String(e.props?.reason ?? "none");
    reasons[r] = (reasons[r] ?? 0) + 1;
  }
  const booking: Record<string, number> = {};
  for (const e of events.filter(
    (x) => x.name === "booking_link_opened" || x.name === "navigation_opened",
  )) {
    const k = String(e.props?.kind ?? e.props?.scope ?? e.name);
    booking[k] = (booking[k] ?? 0) + 1;
  }

  return {
    generatedAt: now.toISOString(),
    totals: {
      installs: new Set(events.map((e) => e.installId)).size,
      events: events.length,
      plans: count("plan_generated"),
      saves: count("plan_saved"),
      shares: count("plan_shared"),
      shareOpens: count("shared_plan_opened"),
      magicEdits: count("magic_edit_applied"),
      pollAnswers: count("poll_answered"),
      paywallViews: count("paywall_viewed"),
      plusStarts: count("plus_started"),
    },
    funnel: funnelSteps.map((name) => ({ name, installs: installs(name) })),
    series,
    timeToPlanMs: median(
      events
        .filter(
          (e) => e.name === "plan_generated" && typeof e.props?.ms === "number",
        )
        .map((e) => e.props!.ms as number),
    ),
    wentRate: feedback.length ? went / feedback.length : null,
    feedbackCount: feedback.length,
    repeat: {
      cohort: firstPlan.size,
      within7d: repeatWithin(7),
      within30d: repeatWithin(30),
    },
    paywallConversion: count("paywall_viewed")
      ? count("plus_started") / count("paywall_viewed")
      : null,
    pulseReasons: reasons,
    booking,
  };
}
export type MetricsSummary = ReturnType<typeof summarize>;
