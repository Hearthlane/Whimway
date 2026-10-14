import React from "react";
import { View, Text, Pressable } from "react-native";
import { colors } from "../design/theme";
import {
  recordDiagnostic,
  shareDiagnosticReport,
} from "../services/diagnostics";
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean; shareError: string }
> {
  state = { failed: false, shareError: "" };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    recordDiagnostic({
      category: "render",
      code:
        error instanceof TypeError
          ? "SCREEN_TYPE_ERROR"
          : error instanceof RangeError
            ? "SCREEN_RANGE_ERROR"
            : "SCREEN_ERROR",
      operation: "screen",
    });
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
          style={{ minHeight: 48, justifyContent: "center" }}
          onPress={() => this.setState({ failed: false, shareError: "" })}
        >
          <Text style={{ fontSize: 18, color: colors.ink }}>
            Reload screen →
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Share diagnostic report"
          onPress={() =>
            void shareDiagnosticReport().catch(() =>
              this.setState({
                shareError:
                  "The share menu could not open. Try again, or open your diagnostic report in Profile.",
              }),
            )
          }
          style={{ minHeight: 48, justifyContent: "center" }}
        >
          <Text style={{ fontSize: 16, color: colors.ink }}>
            Share diagnostic report
          </Text>
        </Pressable>
        {this.state.shareError ? (
          <Text accessibilityRole="alert" style={{ color: colors.error }}>
            {this.state.shareError}
          </Text>
        ) : null}
      </View>
    ) : (
      this.props.children
    );
  }
}
