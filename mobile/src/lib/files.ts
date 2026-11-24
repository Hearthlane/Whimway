import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

/**
 * Hand a generated file to the person: a download on the web, the share sheet on a phone
 * (where "Add to Calendar", "Save to Files" and mail apps all live).
 */
export async function saveFile(name: string, mime: string, text: string) {
  if (Platform.OS === "web") {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  await file.write(text);
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: mime, UTI: mime === "text/calendar" ? "public.calendar-event" : undefined });
}
