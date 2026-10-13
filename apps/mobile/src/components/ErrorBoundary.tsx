import React from "react";
import { View, Text, Pressable } from "react-native";
import { colors } from "../design/theme";
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    console.warn("Whimway screen failed. No personal data included.");
  }
  render() {
    return this.state.failed ? (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.paper,
          padding: 32,
          justifyContent: "center",
          gap: 20,
        }}
      >
        <Text style={{ fontSize: 28, color: colors.ink }}>
          Let’s try that again.
        </Text>
        <Text>
          The screen could not open. Your saved plans are still on this device.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => this.setState({ failed: false })}
        >
          <Text style={{ fontSize: 18, color: colors.ink }}>
            Reload screen →
          </Text>
        </Pressable>
      </View>
    ) : (
      this.props.children
    );
  }
}
