import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { useApp } from "./AppState";
import { getSavedPlans } from "../services/storage";
import { api } from "../services/api";
import type { Itinerary, PlanSpec } from "../../../../lib/schema";
export function usePlan(id: string) {
  const { plan, setPlan } = useApp();
  const [loading, setLoading] = useState(!plan || plan.id !== id);
  const [error, setError] = useState("");
  const current = useRef(plan),
    commit = useRef(setPlan);
  const active = useRef<AbortController | null>(null),
    focused = useRef(false);
  useEffect(() => {
    current.current = plan;
    commit.current = setPlan;
  }, [plan, setPlan]);
  const load = useCallback(async () => {
    if (!focused.current) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    setError("");
    try {
      const local = (await getSavedPlans()).find((p) => p.id === id);
      if (controller.signal.aborted) return;
      const spec =
        local ??
        (await api<PlanSpec>("plans/" + id, undefined, {
          signal: controller.signal,
        }));
      let next = await api<Itinerary>("hydrate", spec, {
        signal: controller.signal,
      });
      if (controller.signal.aborted || !focused.current) return;
      if (next.id !== id)
        throw new Error(
          "The backend returned a different outing. Please try opening this plan again.",
        );
      if (
        current.current?.id === id &&
        current.current.revision > next.revision
      )
        return;
      const latest = (await getSavedPlans()).find((p) => p.id === id);
      if (controller.signal.aborted || !focused.current) return;
      if (latest && latest.revision > next.revision)
        next = await api<Itinerary>("hydrate", latest, {
          signal: controller.signal,
        });
      if (
        controller.signal.aborted ||
        !focused.current ||
        (current.current?.id === id && current.current.revision > next.revision)
      )
        return;
      await commit.current(next, { signal: controller.signal, persist: false });
    } catch (e) {
      if (!controller.signal.aborted && focused.current)
        setError((e as Error).message);
    } finally {
      if (
        active.current === controller &&
        !controller.signal.aborted &&
        focused.current
      )
        setLoading(false);
    }
  }, [id]);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      if (!current.current || current.current.id !== id) void load();
      else setLoading(false);
      let wasBackgrounded = AppState.currentState !== "active";
      const listener = AppState.addEventListener("change", (state) => {
        if (state !== "active") {
          wasBackgrounded = true;
          active.current?.abort();
        } else if (wasBackgrounded) {
          wasBackgrounded = false;
          void load();
        }
      });
      return () => {
        focused.current = false;
        active.current?.abort();
        listener.remove();
      };
    }, [id, load]),
  );
  return {
    plan: plan?.id === id ? plan : undefined,
    setPlan,
    loading,
    error,
    setError,
    reload: load,
  };
}
