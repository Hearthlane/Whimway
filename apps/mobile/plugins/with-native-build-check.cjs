/* eslint-disable @typescript-eslint/no-require-imports -- Expo config plugins use CommonJS. */
const { withPodfile } = require("expo/config-plugins");
const { addMapsCocoapods } = require("react-native-maps/plugin/build/ios");

// Build the actual Google adapter on credential-free CI. Do not inject a fake
// Maps key or initialize GMSServices; nativeMapsConfigured remains false.
module.exports = function withNativeBuildCheck(config) {
  return withPodfile(config, (result) => {
    result.modResults.contents = addMapsCocoapods(
      result.modResults.contents,
      true,
    ).contents;
    return result;
  });
};
