import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import type { Itinerary } from "../../../../lib/schema";
import type { Draft } from "../core/planning";
import {
  getPreferences,
  type Preferences,
  savePlan,
} from "../services/storage";
import { startAuthLifecycle } from "../services/auth";
import { updatePlanReminders } from "../services/notifications";
import { commitPlan, type PlanCommitOptions } from "../core/plan-commit";
type Store = {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  plan?: Itinerary;
  setPlan: (plan: Itinerary, options?: PlanCommitOptions) => Promise<void>;
  preferences?: Preferences;
  refreshPreferences: () => Promise<void>;
  reminderError: string;
};
const Context = createContext<Store | null>(null);
export function AppProvider({ children }: { children: React.ReactNode }) {
  const [draft, setDraft] = useState<Draft>({
    prompt: "",
    known: [],
    demo: false,
  });
  const [plan, setCurrentPlan] = useState<Itinerary>();
  const [preferences, setPreferences] = useState<Preferences>();
  const [reminderError, setReminderError] = useState("");
  const refreshPreferences = useCallback(
    async () => setPreferences(await getPreferences()),
    [],
  );
  useEffect(() => {
    void refreshPreferences().catch(() => {});
    return startAuthLifecycle();
  }, [refreshPreferences]);
  const setPlan = useCallback(async (next: Itinerary, options: PlanCommitOptions = {}) => {
    await commitPlan(next, {
      persist: savePlan,
      commit: setCurrentPlan,
      refreshReminders: async (plan) => {
        setReminderError("");
        await updatePlanReminders(plan).catch(() => setReminderError("Your plan is ready. Reminders could not refresh; open this plan’s reminders to retry."));
      },
    }, options);
  }, []);
  return (
    <Context.Provider
      value={{
        draft,
        setDraft,
        plan,
        setPlan,
        preferences,
        refreshPreferences,
        reminderError,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useApp() {
  const value = useContext(Context);
  if (!value) throw new Error("Whimway context missing");
  return value;
}
