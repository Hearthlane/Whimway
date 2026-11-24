import { Platform, useWindowDimensions } from "react-native";

/** A computer-sized browser window: navigation moves to a sidebar and sheets become dialogs. */
export const WIDE = 900;
export function useWide() {
  const { width } = useWindowDimensions();
  return Platform.OS === "web" && width >= WIDE;
}
