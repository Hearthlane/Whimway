import * as Location from "expo-location";
import { AppState } from "react-native";
import type { Point } from "../../../../lib/schema";

const asPoint = (position: Location.LocationObject): Point => ({
  lat: position.coords.latitude,
  lng: position.coords.longitude,
});
export async function requestCurrentLocation(): Promise<Point> {
  // This method is only called from the user's Near me / Locate me action.
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted)
    throw new Error(
      "Location is off. Search for a place or choose on the map instead.",
    );
  if (!(await Location.hasServicesEnabledAsync()))
    throw new Error(
      "Location services are off. Enable them in device settings or search for a place.",
    );
  const current = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  return asPoint(current);
}

export async function watchForegroundLocation(
  onPoint: (point: Point) => void,
  onError: (message: string) => void = () => undefined,
): Promise<() => void> {
  // Watching never opens a permission prompt. The screen must request it from
  // an explicit tap before starting location sharing in Day Mode.
  const permission = await Location.getForegroundPermissionsAsync();
  if (!permission.granted)
    throw new Error("Allow location from Locate me to follow your position.");
  let closed = false,
    generation = 0;
  let watch: Location.LocationSubscription | undefined;
  const stop = () => {
    generation++;
    watch?.remove();
    watch = undefined;
  };
  const start = async () => {
    const currentGeneration = ++generation;
    try {
      const granted = await Location.getForegroundPermissionsAsync();
      if (!granted.granted) {
        onError(
          "Location permission changed. You can continue using the route preview.",
        );
        return;
      }
      if (
        closed ||
        currentGeneration !== generation ||
        AppState.currentState !== "active"
      )
        return;
      const next = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 15,
          timeInterval: 5000,
        },
        (position) => {
          if (!closed && currentGeneration === generation)
            onPoint(asPoint(position));
        },
        () =>
          onError(
            "Your position is temporarily unavailable. The route preview is still available.",
          ),
      );
      if (closed || currentGeneration !== generation) next.remove();
      else watch = next;
    } catch {
      if (!closed)
        onError("Could not follow your location. Try Locate me again.");
    }
  };
  const listener = AppState.addEventListener("change", (state) => {
    stop();
    if (state === "active" && !closed) void start();
  });
  await start();
  return () => {
    closed = true;
    stop();
    listener.remove();
  };
}
