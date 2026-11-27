import { Redirect, useLocalSearchParams } from "expo-router";
import { Platform } from "react-native";

/** A saved-plan share link (…/s/<id>) opened on the web app's own site: open it in Import. */
export default function SharedById() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const origin = Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : "https://whimway.app";
  return <Redirect href={id && /^[\w-]+$/.test(id) ? { pathname: "/import", params: { link: `${origin}/s/${id}` } } : "/"} />;
}
