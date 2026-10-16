import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// Original Whimway artwork: a wandering W with a sunny destination.
// Keep source artwork editable and regenerate store assets without a remote service.
const directory = fileURLToPath(new URL("../apps/mobile/assets/", import.meta.url));
await mkdir(directory, { recursive: true });
const route = "M265 342 C282 527 301 670 385 633 C429 613 442 536 486 486 C522 445 547 449 568 527 C587 600 611 659 666 634 C727 606 743 453 777 341";
const mark = `<circle cx="512" cy="512" r="385" fill="#FF705B"/>
  <path d="${route}" stroke="#192630" stroke-width="78" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <path d="${route}" stroke="#F8F7F2" stroke-width="45" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <circle cx="265" cy="342" r="29" fill="#BDE9DA" stroke="#192630" stroke-width="12"/>
  <circle cx="777" cy="341" r="39" fill="#FFCC66" stroke="#192630" stroke-width="12"/>
  <path d="M776 322v38m-19-19h38" stroke="#192630" stroke-width="9" stroke-linecap="round"/>`;
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${body}</svg>`;
const sources = {
  icon: svg(`<rect width="1024" height="1024" fill="#F8F7F2"/>${mark}`),
  "adaptive-icon": svg(`<g transform="translate(153.6 153.6) scale(.7)">${mark}</g>`),
  splash: svg(mark),
  "notification-icon": svg(`<path d="${route}" stroke="white" stroke-width="88" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`),
};
for (const [name, source] of Object.entries(sources)) {
  await writeFile(`${directory}${name}.svg`, source, "utf8");
  const raster = sharp(Buffer.from(source));
  if (name === "icon") raster.flatten({ background: "#F8F7F2" });
  await raster.png().toFile(`${directory}${name}.png`);
}
await sharp(Buffer.from(sources.icon)).flatten({ background: "#F8F7F2" }).resize(64, 64).png().toFile(`${directory}favicon.png`);
for (const name of [...Object.keys(sources), "favicon"]) {
  const metadata = await sharp(`${directory}${name}.png`).metadata();
  console.log(`${name}.png: ${metadata.width} × ${metadata.height}, alpha=${metadata.hasAlpha}`);
}
