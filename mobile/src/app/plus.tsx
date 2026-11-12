import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import Animated, { FadeInDown, ZoomIn } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { FREE, isPlus, plusBenefits, PRICES, TRIAL_DAYS, yearlySaving, type PlusPlan } from "@shared/plus";
import * as WebBrowser from "expo-web-browser";
import { SHARE_ORIGIN } from "@/lib/config";
import { useStore } from "@/lib/store";
import { Badge, Button, Icon, IconButton, Notice, Press, Spark, T, tap, type IconName } from "@/ui/kit";
import { color, motion, radius, shadow, space } from "@/ui/theme";

const headlines: Record<string, { title: string; body: string }> = {
  limit: { title: "You’ve used this month’s free plans", body: `Free includes ${FREE.plansPerMonth} plans a month. Go unlimited, or come back when it resets.` },
  edits: { title: "That’s the free edits for this plan", body: `Free includes ${FREE.magicEditsPerPlan} Magic Edits per plan. Plus has no limit.` },
  favourite: { title: "Plan a night around a favourite", body: "Building around a saved place is part of Plus." },
  tune: { title: "Fine-tune every night", body: "Pace and alcohol-free planning are part of Plus." },
  surprise: { title: "Let us surprise you", body: "One-tap surprise plans are part of Plus." },
  onboarding: { title: "Make every night out easy", body: "Start free, or unlock everything with Plus." },
  default: { title: "Whimway Plus", body: "Unlimited plans, built around the places you love." },
};

/**
 * Paywall. In this beta the purchase is a demo entitlement stored on the device and no
 * payment is taken; the production build swaps `start()` for the App Store / Play billing
 * flow and verifies receipts on the server.
 */
export default function Plus() {
  const { reason, starter } = useLocalSearchParams<{ reason?: string; starter?: string }>();
  const { profile, setProfile, track, demo, syncEntitlement, session } = useStore();
  const [note, setNote] = useState("");
  const [plan, setPlan] = useState<PlusPlan>("yearly");
  const active = isPlus(profile);
  const copy = headlines[reason ?? "default"] ?? headlines.default;
  const fromOnboarding = reason === "onboarding";

  useEffect(() => {
    track("paywall_viewed", { reason: reason ?? "default" });
  }, [track, reason]);

  const leave = () => {
    if (fromOnboarding) router.replace(starter ? { pathname: "/", params: { starter } } : "/");
    else if (router.canGoBack()) router.back();
    else router.replace("/");
  };
  const start = () => {
    tap("success");
    setProfile({ ...profile, plus: { active: true, plan, since: new Date().toISOString(), demo: true } });
    track("plus_started", { plan, reason: reason ?? "default" });
    leave();
  };
  const price = PRICES[plan];
  const perMonth = plan === "yearly" ? (PRICES.yearly.amount / 12).toFixed(2) : PRICES.monthly.amount.toFixed(2);

  return (
    <SafeAreaView style={s.page}>
      <View style={s.top}>
        <IconButton icon="x" label="Close" onPress={leave} />
      </View>
      <ScrollView contentContainerStyle={s.body}>
        <Animated.View entering={ZoomIn.springify().damping(12)} style={s.mark}>
          <Spark size={54} />
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(120).duration(motion.slow)} style={{ gap: space.sm, alignItems: "center" }}>
          <T v="title" style={{ textAlign: "center" }} accessibilityRole="header">
            {active ? "You’re on Whimway Plus" : copy.title}
          </T>
          <T v="body" tone={color.muted} style={{ textAlign: "center", maxWidth: 320 }}>
            {active ? "Unlimited plans and edits, favourites, fine-tuning and surprise mode are all on." : copy.body}
          </T>
        </Animated.View>

        <View style={s.benefits}>
          {plusBenefits.map((b, i) => (
            <Animated.View key={b.title} entering={FadeInDown.delay(220 + i * 70).duration(motion.slow)} style={s.benefit}>
              <View style={s.benefitIcon}>
                <Icon name={b.icon as IconName} size={16} />
              </View>
              <View style={{ flex: 1 }}>
                <T v="bodyStrong">{b.title}</T>
                <T v="small" tone={color.muted}>
                  {b.detail}
                </T>
              </View>
            </Animated.View>
          ))}
        </View>

        {active ? null : (
          <View style={s.plans} accessibilityRole="radiogroup">
            {(Object.keys(PRICES) as PlusPlan[]).reverse().map((key) => {
              const p = PRICES[key];
              const on = plan === key;
              return (
                <Press
                  key={key}
                  testID={`plus-${key}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`${p.label}, $${p.amount} per ${p.per}`}
                  onPress={() => {
                    tap("select");
                    setPlan(key);
                  }}
                  style={[s.plan, on && s.planOn]}
                >
                  <View style={[s.radio, on && { borderColor: color.ink }]}>{on ? <View style={s.radioDot} /> : null}</View>
                  <View style={{ flex: 1 }}>
                    <T v="bodyStrong">{p.label}</T>
                    <T v="small" tone={color.muted}>
                      ${p.amount.toFixed(2)} a {p.per}
                      {key === "yearly" ? `, about $${(p.amount / 12).toFixed(2)} a month` : ""}
                    </T>
                  </View>
                  {key === "yearly" ? <Badge tone="mint" label={`Save ${yearlySaving}%`} /> : null}
                </Press>
              );
            })}
          </View>
        )}
        <Notice icon="info">
          {demo
            ? "Demo purchase. No payment is taken in this preview, and prices are still being tested."
            : "Subscriptions open when Whimway launches in the App Store and Google Play. Everything free stays free."}
        </Notice>
        {note ? <Notice tone="mint" icon="check">{note}</Notice> : null}
        <T v="small" tone={color.muted} style={{ textAlign: "center" }}>
          Plus renews automatically until cancelled. Cancel anytime in your App Store or Google Play subscriptions; access continues until the period ends.
        </T>
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: space.sm }}>
          <Button
            testID="plus-restore"
            kind="ghost"
            label="Restore purchases"
            onPress={async () => {
              const active = await syncEntitlement();
              setNote(active ? "Plus is active on this account." : session ? "No active subscription found for this account." : "Sign in under You to restore a subscription.");
            }}
          />
          <Button kind="ghost" label="Terms" onPress={() => void WebBrowser.openBrowserAsync(`${SHARE_ORIGIN}/terms`)} />
          <Button kind="ghost" label="Privacy" onPress={() => void WebBrowser.openBrowserAsync(`${SHARE_ORIGIN}/privacy`)} />
        </View>
      </ScrollView>

      <View style={s.footer}>
        {active ? (
          <>
            <Button size="lg" label="Done" onPress={leave} />
            <Button
              kind="ghost"
              label="Cancel Plus"
              onPress={() => {
                setProfile({ ...profile, plus: undefined });
                track("plus_cancelled");
                leave();
              }}
            />
          </>
        ) : (
          <>
            <Button testID="plus-start" size="lg" label={`Try ${TRIAL_DAYS} days free`} icon="star" onPress={start} disabled={!demo} />
            <T v="small" tone={color.muted} style={{ textAlign: "center" }}>
              Then ${price.amount.toFixed(2)} {price.currency} a {price.per} (${perMonth} a month). Cancel anytime.
            </T>
            <Button testID="plus-skip" kind="ghost" label={fromOnboarding ? "Continue with free" : "Not now"} onPress={leave} />
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.canvas },
  top: { paddingHorizontal: space.lg, paddingTop: space.sm, alignItems: "flex-end" },
  body: { padding: space.xl, paddingTop: space.sm, gap: space.lg, alignItems: "center", maxWidth: 520, width: "100%", alignSelf: "center" },
  mark: { width: 80, height: 80, borderRadius: 26, backgroundColor: color.coral, alignItems: "center", justifyContent: "center", ...shadow.lift },
  benefits: { alignSelf: "stretch", gap: space.md },
  benefit: { flexDirection: "row", gap: space.md, alignItems: "flex-start" },
  benefitIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: color.mintTint, alignItems: "center", justifyContent: "center" },
  plans: { alignSelf: "stretch", gap: space.sm },
  plan: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.lg, borderRadius: radius.lg, borderWidth: 1.5, borderColor: color.line, backgroundColor: color.paper },
  planOn: { borderColor: color.ink },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: color.line, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: color.ink },
  footer: { padding: space.lg, gap: space.sm, borderTopWidth: 1, borderTopColor: color.line, maxWidth: 520, width: "100%", alignSelf: "center" },
});
