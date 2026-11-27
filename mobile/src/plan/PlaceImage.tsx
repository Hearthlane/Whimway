import { Image, type ImageStyle } from "expo-image";
import { useState } from "react";
import { StyleSheet, View, type StyleProp } from "react-native";
import type { CandidatePlace } from "@shared/schema";
import { API_URL } from "@/lib/config";
import { StopArt } from "@/plan/StopArt";

/**
 * The venue's own photo when the provider has one. Otherwise (or if it fails to load) a
 * drawn illustration of the kind of place: never a stock photo of some other venue's
 * dish or a skyline, which reads as a claim about the place.
 */
export function PlaceImage({ place, style }: { place: Pick<CandidatePlace, "photos" | "category" | "types">; chosen?: string; style: StyleProp<ImageStyle> }) {
  const [failed, setFailed] = useState(false);
  const photo = place.photos[0];
  if (photo && !failed)
    return (
      <Image
        source={{ uri: `${API_URL}/api/photo?name=${encodeURIComponent(photo.name)}&w=400` }}
        onError={() => setFailed(true)}
        style={style}
        contentFit="cover"
        transition={200}
        accessibilityIgnoresInvertColors
        alt=""
        accessible={false}
      />
    );
  const flat = StyleSheet.flatten(style) ?? {};
  const height = typeof flat.height === "number" ? flat.height : 120;
  return (
    <View style={[style as object, { overflow: "hidden" }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <StopArt place={place} height={height} />
    </View>
  );
}
