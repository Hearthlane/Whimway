import React from "react";
import {
  Text,
  View,
  Pressable,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Modal,
  type ViewStyle,
  type StyleProp,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, {
  FadeInDown,
  FadeOutUp,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  useReducedMotion,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { ArrowLeft, X, ArrowUpRight } from "lucide-react-native";
import { router } from "expo-router";
import { colors as c, fonts } from "../design/theme";
export const styles = StyleSheet.create({
  title: {
    fontFamily: fonts.display,
    fontSize: 40,
    lineHeight: 44,
    color: c.ink,
    letterSpacing: -1.3,
  },
  heading: {
    fontFamily: fonts.display,
    fontSize: 26,
    color: c.ink,
    letterSpacing: -0.6,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 16,
    lineHeight: 23,
    color: c.muted,
  },
  label: { fontFamily: fonts.medium, fontSize: 14, color: c.ink },
  eyebrow: {
    fontFamily: fonts.medium,
    fontSize: 11,
    letterSpacing: 1.8,
    color: c.muted,
  },
  input: {
    backgroundColor: c.white,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 18,
    padding: 16,
    fontFamily: fonts.body,
    fontSize: 16,
    color: c.ink,
    minHeight: 54,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  section: { gap: 16, marginBottom: 28 },
  divider: { height: 1, backgroundColor: c.line, marginVertical: 20 },
});
export function Screen({
  children,
  scroll = true,
  style,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: c.paper }}
      edges={["top", "left", "right", "bottom"]}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {scroll ? (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[
              { padding: 24, paddingBottom: 40, flexGrow: 1 },
              style,
            ]}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[{ flex: 1, padding: 24 }, style]}>{children}</View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
export function Button({
  title,
  onPress,
  secondary = false,
  disabled = false,
  busy = false,
  icon = true,
  accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  busy?: boolean;
  icon?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityState={{ disabled: disabled || busy }}
      disabled={disabled || busy}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      style={({ pressed }) => ({
        backgroundColor: secondary ? c.white : c.ink,
        borderWidth: secondary ? 1 : 0,
        borderColor: c.line,
        borderRadius: 18,
        padding: 17,
        minHeight: 56,
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
      })}
    >
      <Text
        style={{
          fontFamily: fonts.medium,
          fontSize: 16,
          color: secondary ? c.ink : c.white,
          flexShrink: 1,
        }}
      >
        {title}
      </Text>
      {busy ? (
        <ActivityIndicator color={secondary ? c.ink : c.white} />
      ) : icon ? (
        <ArrowUpRight size={20} color={secondary ? c.ink : c.white} />
      ) : null}
    </Pressable>
  );
}
export function Chip({
  label,
  selected,
  onPress,
  color = c.lavender,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  color?: string;
}) {
  const scale = useSharedValue(1);
  const reduced = useReducedMotion();
  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  return (
    <Animated.View style={animated}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        onPress={() => {
          void Haptics.selectionAsync().catch(() => {});
          if (!reduced) {
            scale.set(0.95);
            scale.set(withSpring(1, { damping: 14 }));
          }
          onPress();
        }}
        style={{
          backgroundColor: selected ? color : c.white,
          borderColor: selected ? c.ink : c.line,
          borderWidth: 1,
          borderRadius: 30,
          paddingVertical: 14,
          paddingHorizontal: 19,
          minHeight: 48,
        }}
      >
        <Text style={styles.label}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}
export function Notice({
  message,
  error = false,
}: {
  message?: string;
  error?: boolean;
}) {
  return message ? (
    <View
      accessibilityRole={error ? "alert" : "text"}
      accessibilityLiveRegion="polite"
      style={{
        backgroundColor: error ? c.peach : c.lilac,
        borderRadius: 16,
        padding: 16,
        marginVertical: 12,
      }}
    >
      <Text style={[styles.body, { color: error ? c.error : c.ink }]}>
        {message}
      </Text>
    </View>
  ) : null;
}
export function Header({
  title,
  back = true,
}: {
  title?: string;
  back?: boolean;
}) {
  return (
    <View
      style={[
        styles.row,
        { justifyContent: "space-between", marginBottom: 26 },
      ]}
    >
      {back ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/")
          }
          style={{ padding: 12, backgroundColor: c.white, borderRadius: 30 }}
        >
          <ArrowLeft color={c.ink} size={22} />
        </Pressable>
      ) : null}
      <Text style={styles.label}>{title || "WHIMWAY"}</Text>
      <View style={{ width: 44 }} />
    </View>
  );
}
export function Reveal({
  children,
  delay = 0,
}: {
  children: React.ReactNode;
  delay?: number;
}) {
  const reduced = useReducedMotion();
  return (
    <Animated.View
      entering={reduced ? undefined : FadeInDown.duration(350).delay(delay)}
      exiting={reduced ? undefined : FadeOutUp.duration(160)}
    >
      {children}
    </Animated.View>
  );
}
export function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  return (
    <Modal
      visible={visible}
      animationType={reduced ? "none" : "slide"}
      transparent
      onRequestClose={onClose}
    >
      <View
        style={{
          flex: 1,
          justifyContent: "flex-end",
          backgroundColor: "#19263066",
        }}
      >
        <Pressable
          style={{ flex: 1 }}
          onPress={onClose}
          accessibilityLabel="Close sheet"
          accessibilityRole="button"
        />
        <SafeAreaView
          edges={["bottom"]}
          style={{
            backgroundColor: c.paper,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            maxHeight: "85%",
          }}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 24, gap: 16 }}
          >
            <View style={[styles.row, { justifyContent: "space-between" }]}>
              <Text style={[styles.heading, { flex: 1 }]}>{title}</Text>
              <Pressable
                onPress={onClose}
                accessibilityLabel="Close"
                accessibilityRole="button"
                style={{ padding: 12 }}
              >
                <X size={22} color={c.ink} />
              </Pressable>
            </View>
            {children}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
