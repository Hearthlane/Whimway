import React, { useEffect } from "react";
import { View, Text } from "react-native";
import Svg, { Path, Circle, Rect } from "react-native-svg";
import Animated, {
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { colors as c, fonts } from "../design/theme";
const AnimatedPath = Animated.createAnimatedComponent(Path);
export function RouteArt({
  compact = false,
  animate = false,
}: {
  compact?: boolean;
  animate?: boolean;
}) {
  const reduced = useReducedMotion();
  const offset = useSharedValue(animate && !reduced ? 340 : 0);
  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: offset.value,
  }));
  useEffect(() => {
    if (animate && !reduced) offset.set(withTiming(0, { duration: 1500 }));
  }, [animate, reduced, offset]);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        backgroundColor: c.mint,
        borderRadius: 28,
        height: compact ? 140 : 195,
        overflow: "hidden",
      }}
    >
      <Svg width="100%" height="100%" viewBox="0 0 340 190">
        <Circle cx="285" cy="38" r="60" fill={c.sun} />
        <Rect
          x="22"
          y="120"
          width="95"
          height="95"
          rx="25"
          fill={c.lavender}
          transform="rotate(-12 22 120)"
        />
        <AnimatedPath
          animatedProps={animatedProps}
          d="M44 157 C44 100 166 159 169 97 S258 70 278 34"
          fill="none"
          stroke={c.ink}
          strokeWidth="3"
          strokeDasharray={animate ? "340" : "6 8"}
          strokeLinecap="round"
        />
        <Circle cx="44" cy="157" r="10" fill={c.ink} />
        <Circle cx="169" cy="97" r="22" fill={c.coral} />
        <Circle cx="169" cy="97" r="7" fill={c.paper} />
        <Path
          d="M278 14 C252 14 247 41 278 66 C309 41 304 14 278 14"
          fill={c.ink}
        />
        <Circle cx="278" cy="33" r="6" fill={c.sun} />
        <Path
          d="M76 33 L80 45 L93 49 L80 53 L76 66 L72 53 L59 49 L72 45 Z"
          fill={c.ink}
        />
      </Svg>
      {!compact ? (
        <Text
          style={{
            position: "absolute",
            bottom: 18,
            right: 18,
            fontFamily: fonts.medium,
            fontSize: 11,
            letterSpacing: 1.5,
            color: c.ink,
          }}
        >
          FOLLOW YOUR “WHY NOT?”
        </Text>
      ) : null}
    </View>
  );
}
