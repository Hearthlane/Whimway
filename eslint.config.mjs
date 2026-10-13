import { defineConfig, globalIgnores } from "eslint/config";
import next from "eslint-config-next/core-web-vitals";
import ts from "eslint-config-next/typescript";
export default defineConfig([
  ...next,
  ...ts,
  globalIgnores([".next/**", "playwright-report/**", "test-results/**", "test-results-mobile/**", "apps/mobile/node_modules/**", "apps/mobile/.expo/**", "apps/mobile/dist/**", "apps/mobile/android/**", "apps/mobile/ios/**"]),
  {
    rules: {
      "@next/next/no-img-element": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);
