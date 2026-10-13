import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// Avoid the historical Keychain value-size limit; all credential chunks remain
// in the OS secure store. No tokens or verifier are placed in AsyncStorage.
const secureKey = (key: string) =>
  `whimway_${key.replace(/[^a-zA-Z0-9_.-]/g, "_")}`;
const options = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
type Header = { count: number; generation: string };
async function header(key: string): Promise<Header | null> {
  const raw = await SecureStore.getItemAsync(key, options);
  try {
    const value = raw ? JSON.parse(raw) : null;
    return value &&
      Number.isInteger(value.count) &&
      value.count > 0 &&
      value.count <= 200 &&
      /^[0-9a-z]+$/.test(value.generation)
      ? value
      : null;
  } catch {
    return null;
  }
}
const volatile = new Map<string, string>();
export const secureSessionStorage = {
  async getItem(input: string): Promise<string | null> {
    if (Platform.OS === "web") return volatile.get(input) ?? null;
    const key = secureKey(input),
      value = await header(key);
    if (!value) return null;
    const chunks = await Promise.all(
      Array.from({ length: value.count }, (_, i) =>
        SecureStore.getItemAsync(`${key}.${value.generation}.${i}`, options),
      ),
    );
    return chunks.some((chunk) => chunk === null) ? null : chunks.join("");
  },
  async setItem(input: string, value: string): Promise<void> {
    if (Platform.OS === "web") {
      volatile.set(input, value);
      return;
    }
    const key = secureKey(input),
      previous = await header(key);
    const chars = Array.from(value),
      chunks: string[] = [];
    for (let i = 0; i < chars.length; i += 400)
      chunks.push(chars.slice(i, i + 400).join(""));
    if (!chunks.length) chunks.push("");
    if (chunks.length > 200)
      throw new Error("This account session is too large to store securely.");
    const generation = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    try {
      for (let i = 0; i < chunks.length; i++)
        await SecureStore.setItemAsync(
          `${key}.${generation}.${i}`,
          chunks[i],
          options,
        );
      await SecureStore.setItemAsync(
        key,
        JSON.stringify({ count: chunks.length, generation }),
        options,
      );
    } catch (error) {
      await Promise.all(
        chunks.map((_, i) =>
          SecureStore.deleteItemAsync(
            `${key}.${generation}.${i}`,
            options,
          ).catch(() => undefined),
        ),
      );
      throw error;
    }
    if (previous)
      await Promise.all(
        Array.from({ length: previous.count }, (_, i) =>
          SecureStore.deleteItemAsync(
            `${key}.${previous.generation}.${i}`,
            options,
          ),
        ),
      );
  },
  async removeItem(input: string): Promise<void> {
    if (Platform.OS === "web") {
      volatile.delete(input);
      return;
    }
    const key = secureKey(input),
      previous = await header(key);
    await SecureStore.deleteItemAsync(key, options);
    if (previous)
      await Promise.all(
        Array.from({ length: previous.count }, (_, i) =>
          SecureStore.deleteItemAsync(
            `${key}.${previous.generation}.${i}`,
            options,
          ),
        ),
      );
  },
};
