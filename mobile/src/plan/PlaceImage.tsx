import { Image, type ImageStyle } from "expo-image";
import { useState } from "react";
import type { StyleProp } from "react-native";
import type { CandidatePlace } from "@shared/schema";
import { API_URL } from "@/lib/config";
import { guidePhotos, kindOf } from "@/plan/guidePhotos";

/**
 * The venue's own photo when the provider has one, otherwise (or if it fails to load) a
 * photo of the kind of place it is, so a slow or blocked image never leaves a grey box.
 */
export function PlaceImage({ place, chosen, style }: { place: Pick<CandidatePlace, "photos" | "category" | "types">; chosen?: string; style: StyleProp<ImageStyle> }) {
  const [failed, setFailed] = useState(false);
  const photo = place.photos[0];
  const own = photo && !failed ? { uri: `${API_URL}/api/photo?name=${encodeURIComponent(photo.name)}` } : undefined;
  return (
    <Image
      source={own ?? guidePhotos[kindOf(place, chosen)]}
      placeholder={guidePhotos[kindOf(place, chosen)]}
      onError={() => setFailed(true)}
      style={style}
      contentFit="cover"
      transition={200}
      accessibilityIgnoresInvertColors
    />
  );
}
