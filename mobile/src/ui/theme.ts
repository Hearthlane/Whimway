// Whimway design tokens — carried over from the web identity (cream canvas, ink, coral,
// mint, lavender; Outfit display + DM Sans body). Coral is a fill colour: as text on the
// cream canvas it fails WCAG contrast, so `coralText` is used for coloured copy.
export const color = {
  canvas: "#F8F7F2",
  paper: "#FFFEFB",
  ink: "#192630",
  inkSoft: "#2B3A45",
  muted: "#52615D",
  faint: "#8A958F",
  line: "#E4E6DE",
  coral: "#FF705B",
  coralText: "#C2412F",
  coralTint: "#FFE7E2",
  mint: "#BDE9DA",
  mintTint: "#E6F6F0",
  lavender: "#B8A4F5",
  lavenderTint: "#EEE9FD",
  yellow: "#FFCC66",
  yellowTint: "#FFF4DB",
  success: "#2F7A5B",
  warning: "#8A5A00",
  danger: "#B3261E",
};
export const font = {
  display: "Outfit_500Medium",
  displayBold: "Outfit_600SemiBold",
  body: "DMSans_400Regular",
  bodyMedium: "DMSans_500Medium",
  bodyBold: "DMSans_700Bold",
};
// 4/8pt rhythm.
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };
export const radius = { sm: 10, md: 16, lg: 22, xl: 28, pill: 999 };
export const type = {
  hero: { fontFamily: font.display, fontSize: 36, lineHeight: 40, letterSpacing: -0.8 },
  title: { fontFamily: font.display, fontSize: 26, lineHeight: 31, letterSpacing: -0.4 },
  heading: { fontFamily: font.displayBold, fontSize: 19, lineHeight: 24, letterSpacing: -0.2 },
  body: { fontFamily: font.body, fontSize: 15, lineHeight: 22 },
  bodyStrong: { fontFamily: font.bodyBold, fontSize: 15, lineHeight: 22 },
  small: { fontFamily: font.body, fontSize: 13, lineHeight: 18 },
  smallStrong: { fontFamily: font.bodyMedium, fontSize: 13, lineHeight: 18 },
  // Small label above content. Sentence case: quieter and easier to read than tracked capitals.
  eyebrow: { fontFamily: font.bodyMedium, fontSize: 13, lineHeight: 18, letterSpacing: 0.1 },
};
export const shadow = {
  card: {
    shadowColor: "#192630",
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  lift: {
    shadowColor: "#192630",
    shadowOpacity: 0.14,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
};
// Minimum comfortable touch target.
export const touch = 44;

// Motion tokens: quick for feedback, standard for reveals, spring for anything touched.
export const motion = { quick: 140, standard: 280, slow: 480, spring: { damping: 16, stiffness: 220, mass: 0.8 } };
