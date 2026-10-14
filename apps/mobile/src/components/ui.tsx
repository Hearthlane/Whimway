import React, { useCallback, useEffect, useRef, useState } from "react";
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
  Keyboard,
  AccessibilityInfo,
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
  withTiming,
  cancelAnimation,
  useReducedMotion,
} from "react-native-reanimated";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import { scheduleOnRN } from "react-native-worklets";
import { shouldDismissSheet } from "../core/sheet-gesture";
import * as Haptics from "expo-haptics";
import { ArrowLeft, X, ArrowUpRight } from "lucide-react-native";
import { router } from "expo-router";
import { colors as c, fonts, mobilePreviewWidth } from "../design/theme";
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
  scrollResetKey,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
  scrollResetKey?: string;
}) {
  const scrollView = useRef<ScrollView>(null);
  useEffect(() => {
    if (scrollResetKey !== undefined)
      scrollView.current?.scrollTo({ y: 0, animated: false });
  }, [scrollResetKey]);
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: c.paper }}
      edges={["top", "left", "right", "bottom"]}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={
          Platform.OS === "ios"
            ? "padding"
            : Platform.OS === "android"
              ? "height"
              : undefined
        }
      >
        {scroll ? (
          <ScrollView
            ref={scrollView}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={
              Platform.OS === "ios" ? "interactive" : "on-drag"
            }
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
        <KeyboardDoneBar />
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
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={() => {
        Keyboard.dismiss();
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
    <Animated.View style={[animated, { maxWidth: "100%" }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        aria-pressed={selected}
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
        <Text style={[styles.label, { flexShrink: 1 }]}>{label}</Text>
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
          onPress={() => {
            Keyboard.dismiss();
            if (router.canGoBack()) router.back();
            else router.replace("/");
          }}
          style={{ padding: 12, backgroundColor: c.white, borderRadius: 30 }}
        >
          <ArrowLeft color={c.ink} size={22} />
        </Pressable>
      ) : null}
      <Text style={[styles.label, { flexShrink: 1, textAlign: "center" }]}>
        {title || "WHIMWAY"}
      </Text>
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
  onDismissStart,
  children,
  error,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  onDismissStart?: () => void;
  children: React.ReactNode;
  error?: string;
}) {
  const reduced = useReducedMotion();
  const displacement = useSharedValue(0),
    sheetHeight = useSharedValue(400),
    closing = useSharedValue(false);
  const closeRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);
  const dismissalStarted = useSharedValue(false);
  const beginDismissal = useCallback(() => {
    if (dismissalStarted.get()) return;
    dismissalStarted.set(true);
    onDismissStart?.();
  }, [onDismissStart, dismissalStarted]);
  const closeSheet = useCallback(() => {
    Keyboard.dismiss();
    beginDismissal();
    onClose();
  }, [onClose, beginDismissal]);
  const dismissKeyboard = useCallback(() => Keyboard.dismiss(), []);
  useEffect(() => {
    dismissalStarted.set(false);
    cancelAnimation(displacement);
    displacement.set(0);
    closing.set(false);
  }, [visible, displacement, closing, dismissalStarted]);
  useEffect(() => {
    if (visible && error)
      scrollRef.current?.scrollTo({ y: 0, animated: !reduced });
  }, [visible, error, reduced]);
  const animated = useAnimatedStyle(() => ({
    transform: [{ translateY: displacement.value }],
  }));
  const drag = Gesture.Pan()
    .activeOffsetY([-12, 12])
    .failOffsetX([-28, 28])
    .maxPointers(1)
    .onStart(() => {
      scheduleOnRN(dismissKeyboard);
    })
    .onUpdate((event) => {
      displacement.set(Math.max(0, event.translationY));
    })
    .onEnd((event) => {
      if (
        shouldDismissSheet(
          event.translationY,
          event.velocityY,
          sheetHeight.value,
        )
      ) {
        closing.set(true);
        // Stop pending work when dismissal is accepted, before the exit motion.
        scheduleOnRN(beginDismissal);
        if (reduced) scheduleOnRN(closeSheet);
        else
          displacement.set(
            withTiming(sheetHeight.value, { duration: 160 }, (finished) => {
              if (finished) scheduleOnRN(closeSheet);
            }),
          );
      } else
        displacement.set(
          reduced ? 0 : withSpring(0, { damping: 24, stiffness: 280 }),
        );
    })
    .onFinalize(() => {
      if (!closing.value)
        displacement.set(
          reduced ? 0 : withSpring(0, { damping: 24, stiffness: 280 }),
        );
    });
  function focusClose() {
    if (!closeRef.current) return;
    if (Platform.OS === "web") closeRef.current.focus();
    else AccessibilityInfo.sendAccessibilityEvent(closeRef.current, "focus");
  }
  return (
    <Modal
      visible={visible}
      animationType={reduced ? "none" : "fade"}
      transparent
      onRequestClose={closeSheet}
      onShow={focusClose}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          behavior={
            Platform.OS === "ios"
              ? "padding"
              : Platform.OS === "android"
                ? "height"
                : undefined
          }
          style={{
            flex: 1,
            justifyContent: "flex-end",
            backgroundColor: "#19263066",
          }}
        >
          <Pressable
            style={{ flex: 1 }}
            onPress={closeSheet}
            accessibilityLabel="Close sheet"
            accessibilityRole="button"
          />
          <Animated.View
            onLayout={(event) =>
              sheetHeight.set(event.nativeEvent.layout.height)
            }
            accessibilityViewIsModal
            role={Platform.OS === "web" ? "dialog" : undefined}
            accessibilityLabel={title}
            onAccessibilityEscape={closeSheet}
            style={[
              {
                backgroundColor: c.paper,
                borderTopLeftRadius: 28,
                borderTopRightRadius: 28,
                maxHeight: "85%",
                flexShrink: 1,
              },
              Platform.OS === "web" && {
                width: "100%",
                maxWidth: mobilePreviewWidth,
                alignSelf: "center",
              },
              animated,
            ]}
          >
            <SafeAreaView
              edges={["bottom"]}
              style={{
                flexShrink: 1,
                backgroundColor: c.paper,
                borderTopLeftRadius: 28,
                borderTopRightRadius: 28,
              }}
            >
              <GestureDetector gesture={drag}>
                <Animated.View
                  style={{
                    paddingHorizontal: 24,
                    paddingTop: 12,
                    paddingBottom: 8,
                  }}
                >
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={{
                      width: 40,
                      height: 4,
                      borderRadius: 4,
                      backgroundColor: c.line,
                      alignSelf: "center",
                      marginBottom: 10,
                    }}
                  />
                  <View
                    style={[styles.row, { justifyContent: "space-between" }]}
                  >
                    <Text
                      accessibilityRole="header"
                      style={[styles.heading, { flex: 1 }]}
                    >
                      {title}
                    </Text>
                    <Pressable
                      ref={closeRef}
                      onPress={closeSheet}
                      accessibilityLabel="Close"
                      accessibilityRole="button"
                      style={{
                        padding: 12,
                        minHeight: 44,
                        minWidth: 44,
                        justifyContent: "center",
                        alignItems: "center",
                      }}
                    >
                      <X size={22} color={c.ink} />
                    </Pressable>
                  </View>
                </Animated.View>
              </GestureDetector>
              <ScrollView
                ref={scrollRef}
                style={{ flexShrink: 1 }}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={
                  Platform.OS === "ios" ? "interactive" : "on-drag"
                }
                contentContainerStyle={{ padding: 24, paddingTop: 8, gap: 16 }}
              >
                <Notice message={error} error />
                {children}
              </ScrollView>
              <KeyboardDoneBar />
            </SafeAreaView>
          </Animated.View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}
function KeyboardDoneBar() {
  const [visible, setVisible] = useState(Keyboard.isVisible());
  useEffect(() => {
    if (Platform.OS === "web") return;
    const show = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      () => setVisible(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setVisible(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible && Platform.OS !== "web" ? (
    <View
      style={{
        alignItems: "flex-end",
        backgroundColor: c.paper,
        borderTopWidth: 1,
        borderColor: c.line,
        paddingHorizontal: 16,
      }}
    >
      <Pressable
        onPress={Keyboard.dismiss}
        accessibilityRole="button"
        accessibilityLabel="Done editing, dismiss keyboard"
        style={{
          minHeight: 44,
          minWidth: 64,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Text style={styles.label}>Done</Text>
      </Pressable>
    </View>
  ) : null;
}
