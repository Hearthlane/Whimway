import React, { useState } from "react";
import { View, Text, Linking, Pressable } from "react-native";
import { Image } from "expo-image";
import { MapPin } from "lucide-react-native";
import type { CandidatePlace } from "../../../../lib/schema";
import { apiPhotoUrl } from "../services/api";
import { safeUrl } from "../../../../lib/geo";
import { colors as c } from "../design/theme";
import { styles } from "./ui";
export function PlacePhoto({
  place,
  demo,
  height = 175,
}: {
  place: CandidatePlace;
  demo: boolean;
  height?: number;
}) {
  const [failed, setFailed] = useState(false);
  const photo = place.photos[0];
  let url: string | undefined;
  try {
    if (!demo && photo && !failed) url = apiPhotoUrl(photo.name);
  } catch {}
  return (
    <View>
      {url ? (
        <Image
          source={{ uri: url }}
          accessibilityLabel={place.name}
          alt={place.name}
          style={{ height, borderRadius: 22, backgroundColor: c.lilac }}
          contentFit="cover"
          cachePolicy="none"
          onError={() => setFailed(true)}
        />
      ) : (
        <View
          style={{
            height,
            borderRadius: 22,
            backgroundColor: c.mint,
            justifyContent: "center",
            alignItems: "center",
            gap: 10,
          }}
        >
          <MapPin color={c.ink} size={36} />
          <Text style={[styles.label, { fontSize: 12 }]}>
            {demo ? "SYNTHETIC PLACE · NO VENUE PHOTO" : "A PLACE TO DISCOVER"}
          </Text>
        </View>
      )}
      {url ? (
        <View style={{ paddingTop: 5 }}>
          <Text style={[styles.body, { fontSize: 11 }]}>Google Maps</Text>
          {photo.authors.map((author, index) => {
            const uri = safeUrl(author.uri);
            return (
              <Pressable
                key={author.name + index}
                accessibilityRole={uri ? "link" : "text"}
                disabled={!uri}
                onPress={() => uri && void Linking.openURL(uri).catch(() => {})}
              >
                <Text style={[styles.body, { fontSize: 11 }]}>
                  {author.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
