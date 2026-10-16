import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Text,
  View,
  TextInput,
  Switch,
  Linking,
  Platform,
  type ScrollView,
} from "react-native";
import { useFocusEffect, router } from "expo-router";
import { UserRound, Bell, Heart } from "lucide-react-native";
import {
  Screen,
  styles,
  Button,
  Chip,
  Notice,
  Sheet,
} from "../../src/components/ui";
import {
  getPreferences,
  savePreferences,
  adoptAccountPreferences,
  getFavoritePlaces,
  PreferencesSchema,
  defaultPreferences,
  type Preferences,
} from "../../src/services/storage";
import { preferenceSyncDecision } from "../../src/services/storage-core";
import { getAuthClient, requestSignIn, signOut } from "../../src/services/auth";
import {
  getAllReminderSettings,
  cancelAllPlanReminders,
} from "../../src/services/notifications";
import { api } from "../../src/services/api";
import { useApp } from "../../src/state/AppState";
import { interests } from "../../../../lib/schema";
import { colors as c } from "../../src/design/theme";
import {
  clearDiagnostics,
  getDiagnosticReport,
  shareDiagnosticReport,
} from "../../src/services/diagnostics";

export default function Profile() {
  const [prefs, setPrefs] = useState<Preferences>(defaultPreferences),
    [budget, setBudget] = useState(String(defaultPreferences.budget));
  const [currency, setCurrency] = useState("");
  const [budgetError, setBudgetError] = useState(""),
    [currencyError, setCurrencyError] = useState("");
  const [saveError, setSaveError] = useState(""),
    [saveMessage, setSaveMessage] = useState("");
  const [accountPrefs, setAccountPrefs] = useState<Preferences>();
  const [email, setEmail] = useState(""),
    [signedIn, setSignedIn] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [count, setCount] = useState(0),
    [favorites, setFavorites] = useState(0),
    [deleting, setDeleting] = useState(false);
  const dirty = useRef(false);
  const scrollRef = useRef<ScrollView>(null),
    saveFeedbackRef = useRef<View>(null),
    feedbackVersion = useRef(0),
    focused = useRef(false),
    feedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
      undefined,
    );
  const [advanced, setAdvanced] = useState(false),
    [diagnosticReport, setDiagnosticReport] = useState<string>();
  const { refreshPreferences } = useApp();
  const auth = getAuthClient();
  const clearSaveFeedback = useCallback(() => {
    feedbackVersion.current++;
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    setSaveError("");
    setSaveMessage("");
  }, []);
  const revealSaveFeedback = useCallback(() => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    if (!focused.current || advanced || !(saveError || saveMessage)) return;
    const version = feedbackVersion.current;
    feedbackTimer.current = setTimeout(() => {
      const scroll = scrollRef.current,
        feedback = saveFeedbackRef.current;
      if (
        !focused.current ||
        version !== feedbackVersion.current ||
        !scroll ||
        !feedback
      )
        return;
      // Fabric measures relative to a host ref, not the numeric legacy handle.
      const content = (
        scroll as ScrollView & { getInnerViewRef(): View | null }
      ).getInnerViewRef();
      if (!content) return;
      feedback.measureLayout(
        content,
        (_x, y) => {
          if (focused.current && version === feedbackVersion.current)
            scroll.scrollTo({ y: Math.max(0, y - 12), animated: false });
        },
        () => {},
      );
    }, 0);
  }, [advanced, saveError, saveMessage]);
  useEffect(() => {
    revealSaveFeedback();
    return () => {
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    };
  }, [revealSaveFeedback]);
  function apply(value: Preferences) {
    setPrefs(value);
    setBudget(String(value.budget));
    setCurrency(value.budgetCurrency ?? "");
    setBudgetError("");
    setCurrencyError("");
  }
  function change(value: Partial<Preferences>) {
    dirty.current = true;
    clearSaveFeedback();
    setPrefs((previous) => ({ ...previous, ...value }));
  }
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      let active = true,
        generation = 0;
      let controller: AbortController | undefined;
      let callbackTimer: ReturnType<typeof setTimeout> | undefined;
      setError("");
      clearSaveFeedback();
      void Promise.all([getAllReminderSettings(), getFavoritePlaces()])
        .then(([rows, refs]) => {
          if (active) {
            setCount(
              rows.filter((r) => r.enabled && r.notificationIds.length > 0)
                .length,
            );
            setFavorites(refs.length);
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
      async function sync(userId?: string, userEmail?: string) {
        const version = ++generation;
        controller?.abort();
        const request = new AbortController();
        controller = request;
        setSignedIn(!!userId);
        setAccountPrefs(undefined);
        if (userEmail) setEmail(userEmail);
        try {
          const local = await getPreferences();
          if (!active || version !== generation) return;
          if (!dirty.current) apply(local);
          if (!userId) return;
          const cloud = await api<Preferences>("profile", undefined, {
            signal: request.signal,
          });
          if (!active || request.signal.aborted || version !== generation)
            return;
          const latest = await getPreferences();
          if (!active || version !== generation) return;
          const decision = preferenceSyncDecision(latest, cloud, dirty.current);
          if (decision === "unchanged") return;
          if (
            decision === "adopt-account" &&
            (await adoptAccountPreferences(cloud))
          ) {
            if (!active || version !== generation) return;
            if (dirty.current) {
              setAccountPrefs(cloud);
              return;
            }
            apply(cloud);
            await refreshPreferences();
            setMessage("Your account preferences are ready on this device.");
          } else setAccountPrefs(cloud);
        } catch (e) {
          if (active && !request.signal.aborted && version === generation)
            setError((e as Error).message);
        }
      }
      const subscription = auth?.auth.onAuthStateChange((_event, session) => {
        // Supabase holds an auth lock in this callback. Start API work on a later
        // task to avoid deadlocking getSession or a token refresh.
        if (callbackTimer) clearTimeout(callbackTimer);
        callbackTimer = setTimeout(() => {
          if (active) void sync(session?.user.id, session?.user.email);
        }, 0);
      });
      if (!auth) void sync();
      return () => {
        focused.current = false;
        feedbackVersion.current++;
        if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
        active = false;
        generation++;
        controller?.abort();
        if (callbackTimer) clearTimeout(callbackTimer);
        subscription?.data.subscription.unsubscribe();
      };
    }, [auth, refreshPreferences, clearSaveFeedback]),
  );
  async function run(
    work: () => Promise<unknown>,
    result: string,
    scope: "general" | "preferences" = "general",
  ) {
    if (busy) return false;
    setBusy(true);
    setError("");
    setMessage("");
    clearSaveFeedback();
    const version = feedbackVersion.current;
    try {
      await work();
      await refreshPreferences();
      if (scope === "preferences") {
        if (!focused.current || version !== feedbackVersion.current)
          return false;
        setSaveMessage(result);
      } else setMessage(result);
      return true;
    } catch (e) {
      if (scope === "preferences") {
        if (focused.current && version === feedbackVersion.current)
          setSaveError((e as Error).message);
      } else setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    const invalidBudget =
      !budget.trim() ||
      !Number.isFinite(Number(budget)) ||
      Number(budget) < 0 ||
      Number(budget) > 1000000;
    const invalidCurrency =
      !!currency.trim() && !/^[A-Z]{3}$/.test(currency.trim().toUpperCase());
    const budgetProblem = invalidBudget
      ? "Enter a usual budget from 0 to 1,000,000 per person."
      : "";
    const currencyProblem = invalidCurrency
      ? "Use a three-letter budget currency, such as CAD, USD or JPY."
      : "";
    setBudgetError(budgetProblem);
    setCurrencyError(currencyProblem);
    if (budgetProblem || currencyProblem)
      throw new Error(budgetProblem || currencyProblem);
    const selected = PreferencesSchema.parse({
      ...prefs,
      budget: Number(budget),
      budgetCurrency: currency.trim().toUpperCase() || undefined,
    });
    const version = feedbackVersion.current;
    await savePreferences(selected);
    if (version === feedbackVersion.current) {
      dirty.current = false;
      apply(selected);
    }
    await refreshPreferences();
    if (signedIn) {
      try {
        await api("profile", selected);
        setAccountPrefs(undefined);
      } catch (e) {
        throw new Error(
          "Saved on this device. Account sync failed: " + (e as Error).message,
        );
      }
    }
  }
  return (
    <Screen scrollRef={scrollRef}>
      <Text style={styles.eyebrow}>MORE YOU. MORE YOUR KIND OF DAY.</Text>
      <Text
        maxFontSizeMultiplier={2}
        style={[styles.title, { marginVertical: 20 }]}
      >
        Come as{"\n"}you are.
      </Text>
      <View
        style={{
          width: 70,
          height: 70,
          backgroundColor: c.lavender,
          borderRadius: 28,
          justifyContent: "center",
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <UserRound size={30} color={c.ink} />
      </View>
      <Notice
        message={
          advanced || deleting || diagnosticReport !== undefined
            ? undefined
            : error
        }
        error
      />
      <Notice message={message} />
      <View style={styles.section}>
        <Text style={styles.heading}>
          {signedIn ? "Your account" : "Guest, with all the good stuff."}
        </Text>
        <Text style={styles.body}>
          {signedIn
            ? email
            : "An account keeps the plans you choose to sync across devices."}
        </Text>
        {signedIn ? (
          <>
            <Button
              secondary
              title="Sign out"
              busy={busy}
              onPress={() =>
                void run(async () => {
                  await signOut();
                  setSignedIn(false);
                  setAccountPrefs(undefined);
                }, "Signed out. Your device plans remain available.")
              }
            />
            <Button
              secondary
              title="Delete account"
              disabled={busy}
              onPress={() => setDeleting(true)}
            />
          </>
        ) : auth && Platform.OS !== "web" ? (
          <>
            <TextInput
              accessibilityLabel="Email address"
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="you@example.com"
            />
            <Button
              title="Email me a sign-in link"
              busy={busy}
              onPress={() =>
                void run(
                  () => requestSignIn(email),
                  "Check your email. Open the link on this device.",
                )
              }
            />
          </>
        ) : (
          <Text style={styles.body}>
            {Platform.OS === "web"
              ? "Account sign-in is available in the native iOS and Android app. Device preferences work in this browser preview."
              : "Account sync is unavailable until the service is configured. Device saves work now."}
          </Text>
        )}
      </View>
      <View style={styles.divider} />
      <View style={styles.section}>
        <Text style={styles.heading}>Your kind of good</Text>
        {accountPrefs ? (
          <>
            <Notice message="Your account has another set of preferences. Your device choices stay here until you choose to switch." />
            <Button
              secondary
              title="Use my account preferences"
              busy={busy}
              onPress={() =>
                void run(async () => {
                  await savePreferences(accountPrefs);
                  apply(accountPrefs);
                  dirty.current = false;
                  setAccountPrefs(undefined);
                }, "Account preferences saved on this device.")
              }
            />
          </>
        ) : null}
        <View style={[styles.row, { justifyContent: "space-between" }]}>
          <Text style={[styles.label, { flex: 1 }]}>
            Use my saved preferences
          </Text>
          <Switch
            accessibilityLabel="Use saved preferences when planning"
            value={prefs.enabled}
            onValueChange={(enabled) => change({ enabled })}
          />
        </View>
        <View style={[styles.row, { flexWrap: "wrap" }]}>
          {interests.map((interest) => (
            <Chip
              key={interest}
              label={interest}
              selected={prefs.interests.includes(interest)}
              onPress={() =>
                change({
                  interests: prefs.interests.includes(interest)
                    ? prefs.interests.filter((i) => i !== interest)
                    : [...prefs.interests, interest],
                })
              }
            />
          ))}
        </View>
        <Text style={styles.label}>Usual budget / person</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            accessibilityLabel="Usual budget"
            accessibilityHint={
              budgetError || "Amount per person, from zero to one million."
            }
            {...(Platform.OS === "web"
              ? {
                  "aria-invalid": !!budgetError,
                  "aria-describedby": budgetError
                    ? "profile-budget-error"
                    : undefined,
                }
              : {})}
            keyboardType="decimal-pad"
            value={budget}
            onChangeText={(value) => {
              dirty.current = true;
              setBudget(value);
              setBudgetError("");
              clearSaveFeedback();
            }}
          />
          <TextInput
            style={[styles.input, { width: 100 }]}
            accessibilityLabel="Budget currency code"
            accessibilityHint={
              currencyError || "Optional three-letter currency code."
            }
            {...(Platform.OS === "web"
              ? {
                  "aria-invalid": !!currencyError,
                  "aria-describedby": currencyError
                    ? "profile-currency-error"
                    : undefined,
                }
              : {})}
            placeholder="CAD"
            maxLength={3}
            autoCapitalize="characters"
            autoCorrect={false}
            value={currency}
            onChangeText={(value) => {
              dirty.current = true;
              setCurrency(value.toUpperCase());
              setCurrencyError("");
              clearSaveFeedback();
            }}
          />
        </View>
        {budgetError ? (
          <Text
            nativeID="profile-budget-error"
            style={[styles.body, { color: c.error, fontSize: 13 }]}
          >
            {budgetError}
          </Text>
        ) : null}
        {currencyError ? (
          <Text
            nativeID="profile-currency-error"
            style={[styles.body, { color: c.error, fontSize: 13 }]}
          >
            {currencyError}
          </Text>
        ) : null}
        <Text style={[styles.body, { fontSize: 13 }]}>
          Used only for destinations with this currency. Leave the currency
          blank to choose a budget each time.
        </Text>
        <View style={styles.row}>
          {(["WALK", "DRIVE"] as const).map((mode) => (
            <Chip
              key={mode}
              label={mode === "WALK" ? "Walking" : "Driving"}
              selected={prefs.mode === mode}
              onPress={() => change({ mode })}
            />
          ))}
        </View>
        <TextInput
          style={styles.input}
          accessibilityLabel="Dietary preferences"
          maxLength={300}
          placeholder="Dietary needs (optional)"
          value={prefs.dietary}
          onChangeText={(dietary) => change({ dietary })}
        />
        <TextInput
          style={styles.input}
          accessibilityLabel="Access preferences"
          maxLength={300}
          placeholder="Accessibility needs (optional)"
          value={prefs.accessibility}
          onChangeText={(accessibility) => change({ accessibility })}
        />
        <View
          ref={saveFeedbackRef}
          collapsable={false}
          onLayout={revealSaveFeedback}
          testID="preference-save-feedback"
        >
          <Notice message={advanced ? undefined : saveError} error />
          <Notice message={saveMessage} />
          <Button
            title="Save my preferences"
            busy={busy}
            onPress={() =>
              void run(
                save,
                signedIn
                  ? "Preferences saved on this device and account."
                  : "Preferences saved on this device.",
                "preferences",
              )
            }
          />
        </View>
        <Button
          secondary
          title="More personal preferences"
          onPress={() => {
            setError("");
            clearSaveFeedback();
            setAdvanced(true);
          }}
        />
        <Button
          secondary
          title="Reset preferences"
          busy={busy}
          onPress={() =>
            void run(async () => {
              if (signedIn)
                await api("profile", undefined, { method: "DELETE" });
              await savePreferences(defaultPreferences);
              dirty.current = false;
              apply(defaultPreferences);
              setAccountPrefs(undefined);
            }, "Preferences reset.")
          }
        />
      </View>
      <View style={styles.divider} />
      <View style={styles.section}>
        <Text style={styles.heading}>Need a hand?</Text>
        <Text style={styles.body}>
          A diagnostic report includes this app’s version, platform and recent
          error codes. It leaves out your plans, account details and precise
          location.
        </Text>
        <Button
          secondary
          title="Open diagnostic report"
          onPress={() =>
            void getDiagnosticReport()
              .then(setDiagnosticReport)
              .catch(() =>
                setError(
                  "The diagnostic report could not open. Please try again.",
                ),
              )
          }
        />
        <Button
          secondary
          title="Clear local diagnostics"
          onPress={() =>
            void run(
              () => clearDiagnostics(),
              "Local diagnostic history cleared.",
            )
          }
        />
      </View>
      <View style={styles.divider} />
      <View style={styles.section}>
        <View style={styles.row}>
          <Heart color={c.ink} size={22} />
          <Text style={styles.heading}>Places worth keeping</Text>
        </View>
        <Text style={styles.body}>
          {favorites} favorite place{favorites === 1 ? "" : "s"} on this device.
          Save one from a stop’s menu.
        </Text>
        <Button
          secondary
          title="Open my collection"
          onPress={() => router.push("/saved")}
        />
      </View>
      <View style={styles.divider} />
      <View style={styles.section}>
        <View style={styles.row}>
          <Bell color={c.ink} size={22} />
          <Text style={styles.heading}>A useful little nudge</Text>
        </View>
        <Text style={styles.body}>
          {count} outing{count === 1 ? "" : "s"} with upcoming reminders. Choose
          reminders from a plan after you’ve seen your day.
        </Text>
        {Platform.OS !== "web" ? (
          <Button
            secondary
            title="Device notification settings"
            onPress={() =>
              void Linking.openSettings().catch((e) => setError(e.message))
            }
          />
        ) : null}
        <Button
          secondary
          title="Cancel all outing reminders"
          busy={busy}
          onPress={() =>
            void run(async () => {
              await cancelAllPlanReminders();
              setCount(0);
            }, "All outing reminders cancelled.")
          }
        />
      </View>
      <Text style={[styles.body, { fontSize: 12 }]}>
        Location is used only when you choose it. No background tracking.
        Personal preferences stay out of public share links. Favorite places
        stay on this device.
      </Text>
      <Sheet
        visible={deleting}
        error={error}
        title="Delete your account?"
        onClose={() => setDeleting(false)}
      >
        <Text style={styles.body}>
          This permanently deletes your account, cloud plans, preferences and
          share links. Device plans and favorite places remain.
        </Text>
        <Button
          title="Delete my account"
          busy={busy}
          onPress={() =>
            void run(async () => {
              await api("account", undefined, { method: "DELETE" });
              await signOut();
              setSignedIn(false);
              setAccountPrefs(undefined);
              setDeleting(false);
            }, "Account deleted.")
          }
        />
        <Button
          secondary
          title="Keep my account"
          disabled={busy}
          onPress={() => setDeleting(false)}
        />
      </Sheet>
      <Sheet
        visible={advanced}
        error={saveError || error}
        title="A little more you"
        onClose={() => setAdvanced(false)}
      >
        <TextInput
          accessibilityLabel="Favourite cuisines"
          style={styles.input}
          maxLength={200}
          value={prefs.cuisines}
          placeholder="Favourite cuisines (optional)"
          onChangeText={(cuisines) => change({ cuisines })}
        />
        <TextInput
          accessibilityLabel="Preferred atmosphere"
          style={styles.input}
          maxLength={200}
          value={prefs.atmosphere}
          placeholder="Quiet, lively, cosy… (optional)"
          onChangeText={(atmosphere) => change({ atmosphere })}
        />
        <Text style={styles.body}>
          {prefs.disliked.length} place{prefs.disliked.length === 1 ? "" : "s"}{" "}
          avoided in future plans. Remember a place from its stop menu.
        </Text>
        {prefs.disliked.length ? (
          <Button
            secondary
            title="Forget avoided places"
            onPress={() => change({ disliked: [] })}
          />
        ) : null}
        <Text style={[styles.body, { fontSize: 13 }]}>
          Cuisine and atmosphere preferences apply when Use my saved preferences
          is on. Places you choose to avoid stay excluded until you clear this
          list.
        </Text>
        <Button
          title="Save my preferences"
          busy={busy}
          onPress={() =>
            void run(
              save,
              signedIn
                ? "Preferences saved on this device and account."
                : "Preferences saved on this device.",
              "preferences",
            ).then((saved) => {
              if (saved) setAdvanced(false);
            })
          }
        />
      </Sheet>
      <Sheet
        visible={diagnosticReport !== undefined}
        error={error}
        title="Your diagnostic report"
        onClose={() => setDiagnosticReport(undefined)}
      >
        <Text
          selectable
          style={[
            styles.body,
            {
              fontSize: 13,
              lineHeight: 20,
              fontFamily: "monospace",
              color: c.ink,
            },
          ]}
        >
          {diagnosticReport}
        </Text>
        {Platform.OS !== "web" ? (
          <Button
            title="Share this report"
            onPress={() =>
              void shareDiagnosticReport().catch(() =>
                setError(
                  "Your phone could not open the share menu. You can select and copy the report text.",
                ),
              )
            }
          />
        ) : (
          <Text style={styles.body}>
            Select and copy this report if you want to send it to support.
          </Text>
        )}
      </Sheet>
    </Screen>
  );
}
