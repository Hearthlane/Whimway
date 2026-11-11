import type { ExpoConfig } from "expo/config";

// Static config lives here; secrets/keys come from the build environment (EAS secrets),
// never from the repository. GOOGLE_MAPS_ANDROID_KEY enables native maps on Android.
const config: ExpoConfig = {
  "name": "Whimway",
  "slug": "whimway",
  "version": "1.0.0",
  "orientation": "portrait",
  "icon": "./assets/images/icon.png",
  "scheme": "whimway",
  "userInterfaceStyle": "light",
  "ios": {
    "icon": "./assets/images/icon.png",
    "bundleIdentifier": "app.whimway",
    "supportsTablet": false,
    "infoPlist": {
      "ITSAppUsesNonExemptEncryption": false,
      "NSLocationWhenInUseUsageDescription": "Whimway uses your location only when you tap “Near me”, to plan around where you are."
    }
  },
  "android": {
    "adaptiveIcon": {
      "backgroundColor": "#FF705B",
      "foregroundImage": "./assets/images/android-icon-foreground.png",
      "backgroundImage": "./assets/images/android-icon-background.png",
      "monochromeImage": "./assets/images/android-icon-monochrome.png"
    },
    "predictiveBackGestureEnabled": false,
    "package": "app.whimway",
    "permissions": [
      "ACCESS_COARSE_LOCATION"
    ]
  },
  "web": {
    "output": "single",
    "favicon": "./assets/images/favicon.png",
    "bundler": "metro"
  },
  "plugins": [
    "expo-router",
    [
      "expo-splash-screen",
      {
        "backgroundColor": "#F8F7F2",
        "image": "./assets/images/splash-icon.png",
        "imageWidth": 120
      }
    ],
    "expo-font"
  ],
  "experiments": {
    "typedRoutes": false,
    "reactCompiler": true
  },
  "description": "From “what should we do?” to “we’re going” in under a minute."
};

if (process.env.GOOGLE_MAPS_ANDROID_KEY)
  config.android = {
    ...config.android,
    config: { googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_KEY } },
  };

export default config;
