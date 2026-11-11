import Feather from "@expo/vector-icons/Feather";
import * as Haptics from "expo-haptics";
import { type ComponentProps, type ReactNode } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import Animated, { FadeIn, SlideInDown, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { color, font, motion, radius, shadow, space, touch, type } from "./theme";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
type PressProps = Omit<React.ComponentProps<typeof Pressable>, "style"> & { style?: StyleProp<ViewStyle>; scaleTo?: number };
/** Pressable with a springy scale: every tappable surface answers the finger. */
export function Press({ style, scaleTo = 0.96, onPressIn, onPressOut, disabled, ...rest }: PressProps) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => {
        scale.value = withSpring(scaleTo, motion.spring);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, motion.spring);
        onPressOut?.(e);
      }}
      style={[style, animated]}
    />
  );
}

export type IconName = ComponentProps<typeof Feather>["name"];
export function Icon({ name, size = 18, tint = color.ink }: { name: IconName; size?: number; tint?: string }) {
  return <Feather name={name} size={size} color={tint} accessibilityElementsHidden importantForAccessibility="no" />;
}

type Variant = keyof typeof type;
export function T({ v = "body", style, tone, ...rest }: TextProps & { v?: Variant; tone?: string; style?: StyleProp<TextStyle> }) {
  return <Text {...rest} style={[type[v] as TextStyle, { color: tone ?? color.ink }, style]} />;
}

export function tap(kind: "light" | "success" | "select" = "light") {
  if (Platform.OS === "web") return;
  if (kind === "success") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  else if (kind === "select") void Haptics.selectionAsync();
  else void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

export function Button({
  label,
  onPress,
  kind = "primary",
  icon,
  busy,
  disabled,
  style,
  size = "md",
  testID,
}: {
  label: string;
  onPress?: () => void;
  kind?: "primary" | "dark" | "ghost" | "soft";
  icon?: IconName;
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  size?: "md" | "lg";
  testID?: string;
}) {
  const palette = {
    primary: { bg: color.coral, fg: color.ink, border: color.coral },
    dark: { bg: color.ink, fg: color.paper, border: color.ink },
    ghost: { bg: "transparent", fg: color.ink, border: color.line },
    soft: { bg: color.paper, fg: color.ink, border: color.line },
  }[kind];
  return (
    <Press
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      scaleTo={0.97}
      onPress={() => {
        tap();
        onPress?.();
      }}
      style={[
        styles.button,
        size === "lg" && { minHeight: 58, paddingHorizontal: space.xl },
        { backgroundColor: palette.bg, borderColor: palette.border, opacity: disabled ? 0.45 : 1 },
        kind === "primary" && !disabled && styles.buttonGlow,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <>
          <T v={size === "lg" ? "bodyStrong" : "smallStrong"} tone={palette.fg} style={size === "lg" ? { fontSize: 17 } : undefined}>
            {label}
          </T>
          {icon ? <Icon name={icon} size={size === "lg" ? 19 : 16} tint={palette.fg} /> : null}
        </>
      )}
    </Press>
  );
}

export function IconButton({ icon, label, onPress, active, tint }: { icon: IconName; label: string; onPress: () => void; active?: boolean; tint?: string }) {
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      scaleTo={0.9}
      onPress={() => {
        tap("select");
        onPress();
      }}
      hitSlop={6}
      style={[styles.iconButton, active && { backgroundColor: color.ink, borderColor: color.ink }]}
    >
      <Icon name={icon} size={17} tint={active ? color.paper : tint ?? color.ink} />
    </Press>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  icon,
  tone = "neutral",
  testID,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  tone?: "neutral" | "mint" | "lavender" | "yellow" | "coral";
  testID?: string;
}) {
  const tints = { neutral: color.paper, mint: color.mintTint, lavender: color.lavenderTint, yellow: color.yellowTint, coral: color.coralTint };
  const content = (
    <>
      {icon ? <Icon name={icon} size={14} tint={selected ? color.paper : color.inkSoft} /> : null}
      <T v="smallStrong" tone={selected ? color.paper : color.ink}>
        {label}
      </T>
    </>
  );
  const base = [styles.chip, { backgroundColor: selected ? color.ink : tints[tone], borderColor: selected ? color.ink : color.line }];
  if (!onPress) return <View style={base}>{content}</View>;
  return (
    <Press
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      scaleTo={0.94}
      onPress={() => {
        tap("select");
        onPress();
      }}
      style={base}
    >
      {content}
    </Press>
  );
}

export function Card({ children, style, padded = true }: { children: ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean }) {
  return <View style={[styles.card, padded && { padding: space.lg }, style]}>{children}</View>;
}

export function Badge({ label, tone = "mint", icon }: { label: string; tone?: "mint" | "yellow" | "coral" | "lavender" | "ink"; icon?: IconName }) {
  const bg = { mint: color.mintTint, yellow: color.yellowTint, coral: color.coralTint, lavender: color.lavenderTint, ink: color.ink }[tone];
  const fg = { mint: color.success, yellow: color.warning, coral: color.coralText, lavender: "#4B3A9A", ink: color.paper }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      {icon ? <Icon name={icon} size={12} tint={fg} /> : null}
      <T v="smallStrong" tone={fg} style={{ fontSize: 12, lineHeight: 16 }}>
        {label}
      </T>
    </View>
  );
}

/** Bottom sheet built on Modal: native slide on iOS/Android, fade on web. */
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const insets = useSafeAreaInsets();
  const content = (
      <Animated.View entering={FadeIn.duration(motion.quick)} style={styles.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" />
        <Animated.View entering={SlideInDown.duration(motion.standard)} style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space.lg) }]} accessibilityViewIsModal>
          <View style={styles.grabber} />
          <View style={styles.sheetHeader}>
            <T v="heading" style={{ flex: 1 }} accessibilityRole="header">
              {title}
            </T>
            <IconButton icon="x" label="Close" onPress={onClose} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 520 }} contentContainerStyle={{ paddingBottom: space.md }}>
            {children}
          </ScrollView>
          {footer}
        </Animated.View>
      </Animated.View>
  );
  // Web: an in-screen overlay, so sheets stay inside the app frame on desktop browsers.
  if (Platform.OS === "web") return open ? <View style={[StyleSheet.absoluteFill, { zIndex: 50 }]}>{content}</View> : null;
  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      {content}
    </Modal>
  );
}

export function Notice({ tone = "yellow", icon = "info", children }: { tone?: "yellow" | "mint" | "coral" | "lavender"; icon?: IconName; children: ReactNode }) {
  const bg = { yellow: color.yellowTint, mint: color.mintTint, coral: color.coralTint, lavender: color.lavenderTint }[tone];
  const fg = { yellow: color.warning, mint: color.success, coral: color.coralText, lavender: "#4B3A9A" }[tone];
  return (
    <View style={[styles.notice, { backgroundColor: bg }]} accessibilityRole="text">
      <Icon name={icon} size={16} tint={fg} />
      <T v="small" tone={color.inkSoft} style={{ flex: 1 }}>
        {children}
      </T>
    </View>
  );
}

/** The Whimway spark (same geometry as the app icon). */
export function Spark({ size = 24, fill = color.paper, accent = color.ink }: { size?: number; fill?: string; accent?: string }) {
  const spark = (cx: number, cy: number, r: number) => {
    const i = r * 0.26;
    return `M${cx} ${cy - r} C${cx + i * 0.35} ${cy - i} ${cx + i} ${cy - i * 0.35} ${cx + r} ${cy} C${cx + i} ${cy + i * 0.35} ${cx + i * 0.35} ${cy + i} ${cx} ${cy + r} C${cx - i * 0.35} ${cy + i} ${cx - i} ${cy + i * 0.35} ${cx - r} ${cy} C${cx - i} ${cy - i * 0.35} ${cx - i * 0.35} ${cy - i} ${cx} ${cy - r} Z`;
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityElementsHidden importantForAccessibility="no">
      <Path d={spark(47, 52, 30)} fill={fill} />
      <Path d={spark(73, 27, 8.5)} fill={accent} />
    </Svg>
  );
}

export function Wordmark({ size = 24 }: { size?: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }} accessibilityRole="header" accessibilityLabel="Whimway">
      <View style={[styles.mark, { width: size * 1.35, height: size * 1.35, borderRadius: size * 0.42 }]}>
        <Spark size={size * 1.35} />
      </View>
      <Text style={{ fontFamily: font.displayBold, fontSize: size, color: color.ink, letterSpacing: -0.6 }}>
        whimway<Text style={{ color: color.coral }}>.</Text>
      </Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
  },
  buttonGlow: { shadowColor: color.coral, shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  iconButton: {
    width: touch,
    height: touch,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  chip: {
    minHeight: 38,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  card: { backgroundColor: color.paper, borderRadius: radius.lg, borderWidth: 1, borderColor: color.line, ...shadow.card },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, alignSelf: "flex-start" },
  scrim: { flex: 1, backgroundColor: "rgba(25,38,48,0.42)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: color.canvas,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    width: "100%",
    maxWidth: 430,
    alignSelf: "center",
  },
  grabber: { width: 40, height: 5, borderRadius: 3, backgroundColor: color.line, alignSelf: "center", marginBottom: space.sm },
  sheetHeader: { flexDirection: "row", alignItems: "center", marginBottom: space.md },
  notice: { flexDirection: "row", gap: space.sm, padding: space.md, borderRadius: radius.md, alignItems: "flex-start" },
  mark: { backgroundColor: color.coral, alignItems: "center", justifyContent: "center" },
});
