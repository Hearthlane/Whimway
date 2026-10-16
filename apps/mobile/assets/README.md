# Whimway mobile artwork

The original mark draws a wandering **W** into a sunny destination. It uses the existing coral, dark ink, warm white, mint and sunshine palette. It is abstract brand artwork, not venue photography.

- `icon.png`: 1024 × 1024 square store icon with an opaque warm background. Let the operating system apply its mask.
- `adaptive-icon.png`: transparent 1024 × 1024 Android foreground; the mark remains in the central safe area. Configure the background as `#F8F7F2`.
- `splash.png`: transparent 1024 × 1024 mark for the splash-screen plugin on `#F8F7F2`.
- `notification-icon.png`: white monochrome artwork on transparency for Android notification status icons.
- `favicon.png`: 64 × 64 browser preview icon.

Editable SVG sources are committed alongside the PNGs. Regenerate from the repository root with `node scripts/create-mobile-assets.mjs` after `npm ci`; the existing Next.js dependency tree supplies Sharp. These assets were authored in this repository and require no stock-photo attribution or external image service.
