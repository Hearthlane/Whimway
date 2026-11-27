import { Redirect } from "expo-router";
import { Platform } from "react-native";

/**
 * A shared plan link (…/p#<plan>) opened on the web app's own site: hand the whole link to
 * Import, which reads the plan from the fragment and saves a copy. The fragment never reaches
 * a server.
 */
export default function SharedFragment() {
  const link = Platform.OS === "web" && typeof window !== "undefined" ? window.location.href : "";
  return <Redirect href={link.includes("#") ? { pathname: "/import", params: { link } } : "/"} />;
}
