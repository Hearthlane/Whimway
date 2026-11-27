import Constants from "expo-constants";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState, type ReactNode } from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { areaByKey } from "@shared/areas";
import { TasteProfile } from "@shared/profile";
import { FREE, isPlus, plansLeft } from "@shared/plus";
import { SignIn } from "@/account/SignIn";
import { api } from "@/lib/api";
import { supabase } from "@/lib/auth";
import { cloudConfigured, SHARE_ORIGIN } from "@/lib/config";
import { companionCopy, modeCopy } from "@/lib/copy";
import { useStore } from "@/lib/store";
import { saveFile } from "@/lib/files";
import { Button, Icon, IconButton, Notice, Press, Sheet, T, type IconName } from "@/ui/kit";
import { color, radius, space, touch } from "@/ui/theme";

/**
 * Settings: one grouped list, the way people expect settings to look. Every row is at least
 * 44pt tall, toggles flip from anywhere on the row, and destructive actions confirm by name.
 */
export default function Settings() {
  const store = useStore();
  const { profile, session, setProfile, history } = store;
  const [message, setMessage] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [confirm, setConfirm] = useState<"device" | "account" | "history" | null>(null);
  const plus = isPlus(profile);
  const open = store.unlocked;
  const loved = Object.entries(profile.affinity).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const tune = (patch: Partial<TasteProfile>) => (open ? setProfile({ ...profile, ...patch }) : router.push({ pathname: "/plus", params: { reason: "tune" } }));
  const retune = () => {
    setProfile({ ...profile, onboarded: false });
    router.replace("/onboarding");
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.canvas }}>
      <View style={s.top}>
        <IconButton icon="arrow-left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/profile"))} />
        <T v="title" accessibilityRole="header" aria-level={1}>
          Settings
        </T>
      </View>
      <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
        <Group title="Account">
          {!cloudConfigured ? (
            <Row icon="cloud-off" label="Saved on this device" detail="Accounts aren’t switched on in this build." />
          ) : session ? (
            <>
              <Row icon="user" label={session.user.email ?? "Signed in"} detail="Taste, people and saved plans sync" />
              <Row icon="log-out" label="Sign out" detail="Everything stays on this device" onPress={() => (setMessage(""), void supabase?.auth.signOut())} />
            </>
          ) : (
            <Row testID="settings-signin" icon="log-in" label="Sign in or create an account" detail="Keep your plans on every device. No password." onPress={() => setSigningIn(true)} chevron />
          )}
          {store.limits ? (
            <Row testID="plus-open" icon="zap" label={plus ? "Whimway Plus" : "Free plan"} detail={plus ? "Unlimited plans and edits" : `${Math.min(FREE.plansPerMonth, plansLeft(profile))} of ${FREE.plansPerMonth} free plans left this month`} onPress={() => router.push("/plus")} chevron />
          ) : null}
        </Group>
        {message ? <Notice icon="check-circle">{message}</Notice> : null}

        <Group title="Preferences">
          <Row icon="edit-2" label="Edit profile" detail={`${companionCopy[profile.companions].label} · ${areaByKey(profile.homeArea)?.name ?? "GTA"} · ${modeCopy[profile.mode].label} · ~$${profile.budget}`} onPress={() => router.push({ pathname: "/profile", params: { edit: "1" } })} chevron />
          <View style={s.inline}>
            <T v="bodyStrong">Pace</T>
            <Segment
              testID="pace"
              value={profile.pace}
              options={[
                { key: "relaxed", label: "Relaxed" },
                { key: "balanced", label: "Balanced" },
                { key: "packed", label: "Packed" },
              ]}
              onChange={(pace) => tune({ pace: pace as TasteProfile["pace"] })}
            />
          </View>
          <Toggle icon="slash" label="Skip bars and drinking spots" detail="Restaurants still count" value={profile.alcoholFree} onChange={(alcoholFree) => tune({ alcoholFree })} testID="settings-alcohol-free" />
          <Row icon="sliders" label="Retune your taste" detail={loved.length ? `Learned: you love ${loved.map(([k]) => k).join(", ")}` : "Answer the questions again"} onPress={retune} chevron />
          {profile.disliked.length ? (
            <Row icon="rotate-ccw" label={`Stop skipping ${profile.disliked.length} place${profile.disliked.length > 1 ? "s" : ""}`} detail="Places you said you didn’t enjoy" onPress={() => setProfile({ ...profile, disliked: [], affinity: {} })} />
          ) : null}
        </Group>

        <Group title="Accessibility">
          <View style={s.inline}>
            <T v="bodyStrong">Text size</T>
            <Segment
              testID="text-size"
              value={profile.textScale}
              options={[
                { key: "default", label: "Default" },
                { key: "large", label: "Large" },
                { key: "largest", label: "Largest" },
              ]}
              onChange={(textScale) => setProfile({ ...profile, textScale: textScale as TasteProfile["textScale"] })}
            />
          </View>
          <Row icon="wind" label="Motion" detail="Follows your device’s reduce-motion setting" />
          <Row icon="heart" label="Access needs" detail={profile.accessibility || "Add step-free access, short walks…"} onPress={() => router.push({ pathname: "/profile", params: { edit: "1" } })} chevron />
        </Group>

        <Group title="Notifications">
          <Toggle icon="bell" label="Before a plan" detail="A reminder two hours before your first stop" value={profile.remindDayOf} onChange={(remindDayOf) => setProfile({ ...profile, remindDayOf })} />
          <Toggle icon="star" label="How was it?" detail="A check-in the morning after" value={profile.remindRate} onChange={(remindRate) => setProfile({ ...profile, remindRate })} />
          {Platform.OS === "web" ? <Row icon="smartphone" label="Reminders arrive in the phone app" detail="The web version shows them in Activity instead" /> : null}
        </Group>

        <Group title="Privacy & data">
          <Toggle icon="bar-chart-2" label="Anonymous usage stats" detail="Events like “plan saved”. Never prompts, places or location." value={profile.analytics} onChange={(analytics) => setProfile(TasteProfile.parse({ ...profile, analytics }))} />
          <Toggle icon="clock" label="Keep history" detail="Recent places and searches, on this device only" value={profile.keepHistory} onChange={(keepHistory) => setProfile({ ...profile, keepHistory })} />
          <Row
            testID="settings-export"
            icon="download"
            label="Download my data"
            detail="Your taste, people, plans and history as a file"
            onPress={() =>
              void saveFile(
                `whimway-data-${new Date().toISOString().slice(0, 10)}.json`,
                "application/json",
                JSON.stringify({ exportedAt: new Date().toISOString(), profile, plans: Object.fromEntries(Object.entries(store.plans).map(([id, e]) => [id, { saved: e.saved, createdAt: e.createdAt, feedback: e.feedback, meta: e.meta, spec: e.spec }])), history }, null, 2),
              ).catch(() => setMessage("Couldn’t create the file. Try again."))
            }
            chevron
          />
          <Row icon="list" label="See history" detail={`${history.places.length} places · ${history.searches.length} searches`} onPress={() => router.push("/history")} chevron />
          {confirm === "history" ? (
            <Confirm text="Clear recent places and searches?" action="Clear history" onCancel={() => setConfirm(null)} onConfirm={() => (store.clearHistory(), setConfirm(null))} />
          ) : (
            <Row icon="x-circle" label="Clear history" onPress={() => setConfirm("history")} />
          )}
          {confirm === "device" ? (
            <Confirm text="Delete all plans, people and your taste profile from this device?" action="Delete device data" onCancel={() => setConfirm(null)} onConfirm={async () => { await store.resetDevice(); setConfirm(null); router.replace("/onboarding"); }} />
          ) : (
            <Row icon="trash-2" label="Delete data on this device" danger onPress={() => setConfirm("device")} />
          )}
        </Group>

        <Group title="About">
          <Row icon="shield" label="Privacy policy" onPress={() => void WebBrowser.openBrowserAsync(`${SHARE_ORIGIN}/privacy`)} chevron />
          <Row icon="file-text" label="Terms" onPress={() => void WebBrowser.openBrowserAsync(`${SHARE_ORIGIN}/terms`)} chevron />
          <Row icon="info" label="Version" detail={`Whimway beta ${Constants.expoConfig?.version ?? ""} · Greater Toronto`} />
        </Group>

        {session ? (
          <Group title="Danger zone">
            {confirm === "account" ? (
              <Confirm
                text="Permanently delete your account, cloud plans, shares and feedback?"
                action="Delete my account"
                onCancel={() => setConfirm(null)}
                onConfirm={async () => {
                  try {
                    await api("account", undefined, { method: "DELETE" });
                    await supabase?.auth.signOut();
                    setConfirm(null);
                  } catch (e) {
                    setMessage((e as Error).message);
                  }
                }}
              />
            ) : (
              <Row icon="user-x" label="Delete my account" danger onPress={() => setConfirm("account")} />
            )}
          </Group>
        ) : null}
      </ScrollView>

      <Sheet open={signingIn} onClose={() => setSigningIn(false)} title="Sign in">
        <View style={{ gap: space.md }}>
          <T v="small" tone={color.muted}>
            Keep your taste, people and saved plans on every device. No password: we email you a 6-digit code.
          </T>
          <SignIn
            onSignedIn={(r) => {
              setSigningIn(false);
              setMessage(r.plans ? `Signed in. ${r.plans} saved plan${r.plans === 1 ? "" : "s"} added from your account.` : "Signed in. Your profile is synced.");
            }}
          />
        </View>
      </Sheet>
    </SafeAreaView>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <T v="eyebrow" tone={color.muted} accessibilityRole="header" style={{ paddingHorizontal: space.sm }}>
        {title}
      </T>
      <View style={s.group}>{children}</View>
    </View>
  );
}

function Row({ icon, label, detail, onPress, chevron, danger, testID }: { icon: IconName; label: string; detail?: string; onPress?: () => void; chevron?: boolean; danger?: boolean; testID?: string }) {
  const body = (
    <>
      <View style={s.rowIcon}>
        <Icon name={icon} size={18} tint={danger ? color.danger : color.ink} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T v="bodyStrong" tone={danger ? color.danger : color.ink} numberOfLines={2}>
          {label}
        </T>
        {detail ? (
          <T v="small" tone={color.muted} numberOfLines={2}>
            {detail}
          </T>
        ) : null}
      </View>
      {chevron ? <Icon name="chevron-right" tint={color.faint} /> : null}
    </>
  );
  return onPress ? (
    <Press testID={testID} accessibilityRole="button" onPress={onPress} style={s.row} scaleTo={0.99}>
      {body}
    </Press>
  ) : (
    <View testID={testID} style={s.row}>
      {body}
    </View>
  );
}

function Toggle({ icon, label, detail, value, onChange, testID }: { icon: IconName; label: string; detail?: string; value: boolean; onChange: (v: boolean) => void; testID?: string }) {
  return (
    <Press testID={testID} accessibilityRole="switch" accessibilityState={{ checked: value }} accessibilityLabel={label} aria-checked={value} onPress={() => onChange(!value)} style={s.row} scaleTo={0.99}>
      <View style={s.rowIcon}>
        <Icon name={icon} size={18} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T v="bodyStrong">{label}</T>
        {detail ? (
          <T v="small" tone={color.muted}>
            {detail}
          </T>
        ) : null}
      </View>
      <View style={[s.track, value && s.trackOn]}>
        <View style={[s.knob, value && s.knobOn]} />
      </View>
    </Press>
  );
}

function Segment({ value, options, onChange, testID }: { value: string; options: { key: string; label: string }[]; onChange: (key: string) => void; testID?: string }) {
  return (
    <View style={s.segment} accessibilityRole="radiogroup">
      {options.map((o) => (
        <Press key={o.key} testID={testID ? `${testID}-${o.key}` : undefined} accessibilityRole="radio" accessibilityState={{ checked: value === o.key }} aria-checked={value === o.key} onPress={() => onChange(o.key)} style={[s.segmentItem, value === o.key && s.segmentOn]}>
          <T v="smallStrong" tone={value === o.key ? color.paper : color.ink}>
            {o.label}
          </T>
        </Press>
      ))}
    </View>
  );
}

function Confirm({ text, action, onCancel, onConfirm }: { text: string; action: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <View style={s.confirm}>
      <T v="small" style={{ flexBasis: "100%" }}>
        {text}
      </T>
      <Button kind="ghost" label="Cancel" onPress={onCancel} />
      <Button kind="dark" label={action} onPress={onConfirm} />
    </View>
  );
}

const s = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm },
  page: { padding: space.xl, paddingTop: space.md, paddingBottom: space.xxxl, gap: space.xl, maxWidth: 680, width: "100%", alignSelf: "center" },
  group: { borderRadius: radius.lg, backgroundColor: color.paper, borderWidth: 1, borderColor: color.line, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 60, paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  rowIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: color.canvas, alignItems: "center", justifyContent: "center" },
  inline: { gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  segment: { flexDirection: "row", gap: 4, padding: 4, borderRadius: radius.pill, backgroundColor: color.canvas },
  segmentItem: { flex: 1, minHeight: touch, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  segmentOn: { backgroundColor: color.ink },
  track: { width: 50, height: 30, borderRadius: 15, backgroundColor: color.lineStrong, padding: 3 },
  trackOn: { backgroundColor: color.ink },
  knob: { width: 24, height: 24, borderRadius: 12, backgroundColor: color.paper },
  knobOn: { transform: [{ translateX: 20 }] },
  confirm: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm, padding: space.lg, backgroundColor: color.coralTint },
});
