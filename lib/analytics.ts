/** Allow-listed product events (mirrors the database check constraint). */
export const eventNames = [
  "onboarding_started",
  "onboarding_completed",
  "onboarding_skipped",
  "plan_requested",
  "plan_generated",
  "plan_failed",
  "plan_viewed",
  "magic_edit_applied",
  "stop_locked",
  "plan_saved",
  "plan_shared",
  "shared_plan_opened",
  "shared_plan_copied",
  "navigation_opened",
  "booking_link_opened",
  "feedback_submitted",
  "app_opened",
  "poll_answered",
  "plan_pulse",
  "stop_reacted",
] as const;
export type EventName = (typeof eventNames)[number];
