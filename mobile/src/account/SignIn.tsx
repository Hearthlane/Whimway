import * as WebBrowser from "expo-web-browser";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { supabase } from "@/lib/auth";
import { SHARE_ORIGIN } from "@/lib/config";
import { useStore } from "@/lib/store";
import { Button, Notice, Press, T, tap } from "@/ui/kit";
import { color, font, radius, space } from "@/ui/theme";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RESEND_AFTER = 30;

export type SignedIn = { email: string; restored: boolean; plans: number };

/** Turn Supabase's errors into something a person can act on. */
function explain(error: { message?: string; status?: number; code?: string }, stage: "email" | "code") {
  const text = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  if (error.status === 429 || /rate|too many|security purposes/.test(text)) return "Too many tries. Wait a minute, then try again.";
  // Supabase reports a wrong code and an expired one the same way.
  if (stage === "code") return "That code didn’t work. Check you’re using the latest email, or send a new code.";
  if (/network|fetch|failed to/.test(text)) return "Couldn’t reach the sign-in service. Check your connection and try again.";
  return "We couldn’t send a code to that address. Check it and try again.";
}

/**
 * Passwordless sign-in: email → 6-digit code. New addresses get an account automatically.
 * After signing in, this device's profile and plans are combined with the account's.
 */
export function SignIn({ onSignedIn, cta = "Email me a code", compact }: { onSignedIn: (r: SignedIn) => void; cta?: string; compact?: boolean }) {
  const store = useStore();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState(false);
  const [wait, setWait] = useState(0);
  const verifying = useRef(false);
  const valid = EMAIL.test(email.trim());

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  if (!supabase) return null;
  const auth = supabase.auth;

  const send = async () => {
    setTouched(true);
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    const { error: e } = await auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: true } });
    setBusy(false);
    if (e) return setError(explain(e, "email"));
    store.track("auth_code_sent");
    setStage("code");
    setCode("");
    setWait(RESEND_AFTER);
  };

  const verify = async (token = code) => {
    if (verifying.current || token.trim().length < 6) return;
    verifying.current = true;
    setBusy(true);
    setError("");
    const { error: e } = await auth.verifyOtp({ email: email.trim().toLowerCase(), token: token.trim(), type: "email" });
    if (e) {
      verifying.current = false;
      setBusy(false);
      return setError(explain(e, "code"));
    }
    const result = await store.syncAccount().catch(() => ({ restored: false, plans: 0 }));
    store.track("auth_signed_in", { restored: result.restored });
    tap("success");
    verifying.current = false;
    setBusy(false);
    onSignedIn({ email: email.trim().toLowerCase(), ...result });
  };

  return (
    <View style={{ gap: space.md }}>
      {stage === "email" ? (
        <Animated.View key="email" entering={FadeIn.duration(200)} style={{ gap: space.sm }}>
          <T v="smallStrong" nativeID="signin-email-label">
            Email
          </T>
          <TextInput
            testID="signin-email"
            accessibilityLabelledBy="signin-email-label"
            value={email}
            onChangeText={(v) => (setEmail(v), error && setError(""))}
            onBlur={() => setTouched(true)}
            onSubmitEditing={send}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="send"
            placeholder="you@example.com"
            placeholderTextColor={color.faint}
            style={[s.input, touched && email && !valid && s.inputBad]}
          />
          {touched && email && !valid ? (
            <T v="small" tone={color.coralText}>
              Check the email address — it looks incomplete.
            </T>
          ) : null}
          <Button testID="signin-send" label={cta} busy={busy} disabled={!valid} onPress={send} style={{ marginTop: space.xs }} />
        </Animated.View>
      ) : (
        <Animated.View key="code" entering={FadeIn.duration(200)} style={{ gap: space.sm }}>
          <T v="smallStrong" nativeID="signin-code-label">
            Enter the 6-digit code sent to {email.trim()}
          </T>
          <TextInput
            testID="signin-code"
            accessibilityLabelledBy="signin-code-label"
            value={code}
            onChangeText={(v) => {
              const digits = v.replace(/\D/g, "").slice(0, 10);
              setCode(digits);
              if (error) setError("");
              if (digits.length === 6) void verify(digits);
            }}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            autoFocus
            placeholder="123456"
            placeholderTextColor={color.faint}
            style={[s.input, s.code]}
            maxLength={10}
          />
          <Button testID="signin-verify" label="Sign in" busy={busy} disabled={code.length < 6} onPress={() => verify()} />
          <View style={s.links}>
            <Press accessibilityRole="button" onPress={() => (setStage("email"), setError(""))} hitSlop={8}>
              <T v="smallStrong" tone={color.coralText}>
                Use a different email
              </T>
            </Press>
            <Press testID="signin-resend" accessibilityRole="button" accessibilityState={{ disabled: wait > 0 }} disabled={wait > 0 || busy} onPress={send} hitSlop={8}>
              <T v="smallStrong" tone={wait > 0 ? color.faint : color.coralText}>
                {wait > 0 ? `Resend in ${wait}s` : "Resend code"}
              </T>
            </Press>
          </View>
          <T v="small" tone={color.muted}>
            Can’t find it? Check spam or promotions. Codes expire after a few minutes.
          </T>
        </Animated.View>
      )}
      {error ? (
        <Notice tone="coral" icon="alert-circle">
          {error}
        </Notice>
      ) : null}
      {compact ? null : (
        <T v="small" tone={color.faint}>
          No password. New here? This creates your account. By continuing you agree to the{" "}
          <T v="small" tone={color.coralText} onPress={() => void WebBrowser.openBrowserAsync(`${SHARE_ORIGIN}/terms`)} accessibilityRole="link">
            Terms
          </T>{" "}
          and{" "}
          <T v="small" tone={color.coralText} onPress={() => void WebBrowser.openBrowserAsync(`${SHARE_ORIGIN}/privacy`)} accessibilityRole="link">
            Privacy Policy
          </T>
          .
        </T>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  input: { minHeight: 52, borderRadius: radius.md, borderWidth: 1.5, borderColor: color.line, backgroundColor: color.paper, paddingHorizontal: space.lg, fontFamily: font.body, fontSize: 16, color: color.ink },
  inputBad: { borderColor: color.coralText },
  code: { fontFamily: font.displayBold, fontSize: 26, letterSpacing: 8, textAlign: "center" },
  links: { flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: space.md, marginTop: space.xs },
});
