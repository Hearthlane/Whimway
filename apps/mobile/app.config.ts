import type { ExpoConfig } from "expo/config";

// CI compiles the Google iOS adapter without claiming a configured live map.
// This mode must never be used for a distribution build (release:check rejects it).
const nativeBuildCheck = process.env.WHIMWAY_NATIVE_BUILD_CHECK === "true";

const config: ExpoConfig = {
  name: "Whimway",
  slug: "whimway",
  version: "0.2.0",
  scheme: "whimway",
  orientation: "portrait",
  userInterfaceStyle: "light",
  icon: "./assets/icon.png",
  ios: {
    bundleIdentifier:
      process.env.WHIMWAY_IOS_BUNDLE_ID || "com.example.whimway",
    supportsTablet: false,
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults",
          NSPrivacyAccessedAPITypeReasons: ["CA92.1"],
        },
      ],
    },
  },
  android: {
    package: process.env.WHIMWAY_ANDROID_PACKAGE || "com.example.whimway",
    allowBackup: false,
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#F8F7F2",
    },
    blockedPermissions: [
      "android.permission.ACCESS_BACKGROUND_LOCATION",
      "android.permission.RECORD_AUDIO",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.SCHEDULE_EXACT_ALARM",
      "android.permission.USE_EXACT_ALARM",
    ],
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-font",
    "expo-dev-client",
    "expo-status-bar",
    "expo-image",
    [
      "expo-splash-screen",
      {
        image: "./assets/splash.png",
        imageWidth: 180,
        backgroundColor: "#F8F7F2",
      },
    ],
    [
      "expo-location",
      {
        locationWhenInUsePermission:
          "Whimway uses your location when you choose Near me or follow your outing.",
        isIosBackgroundLocationEnabled: false,
        isAndroidBackgroundLocationEnabled: false,
      },
    ],
    [
      "expo-notifications",
      { color: "#192630", icon: "./assets/notification-icon.png" },
    ],
    [
      "react-native-maps",
      {
        androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_KEY || "",
        iosGoogleMapsApiKey: process.env.GOOGLE_MAPS_IOS_KEY || "",
      },
    ],
    "@react-native-community/datetimepicker",
    ...(nativeBuildCheck && !process.env.GOOGLE_MAPS_IOS_KEY
      ? ["./plugins/with-native-build-check.cjs"]
      : []),
  ],
  web: { bundler: "metro", output: "single", favicon: "./assets/favicon.png" },
  extra: {
    nativeBuildCheck,
    nativeMapsConfigured: {
      ios: Boolean(process.env.GOOGLE_MAPS_IOS_KEY),
      android: Boolean(process.env.GOOGLE_MAPS_ANDROID_KEY),
    },
    ...(process.env.EAS_PROJECT_ID
      ? { eas: { projectId: process.env.EAS_PROJECT_ID } }
      : {}),
  },
};
export default config;
