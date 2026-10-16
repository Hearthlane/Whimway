import React, { useEffect, useState } from "react";
import { Text } from "react-native";
import { useURL } from "expo-linking";
import { router } from "expo-router";
import { completeAuthCallback } from "../../src/services/auth";
import { Screen, styles, Notice, Button } from "../../src/components/ui";
export default function AuthCallback() {
  const url = useURL();
  const [error, setError] = useState("");
  useEffect(() => {
    if (url)
      void completeAuthCallback(url)
        .then(() => router.replace("/profile"))
        .catch((e) => setError(e.message));
  }, [url]);
  return (
    <Screen>
      <Text maxFontSizeMultiplier={2} style={styles.title}>
        Opening your account…
      </Text>
      <Notice message={error} error />
      {error ? (
        <Button
          title="Back to profile"
          onPress={() => router.replace("/profile")}
        />
      ) : null}
    </Screen>
  );
}
