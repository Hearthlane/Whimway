// Whimway design tokens. A night out reads like a departure board: midnight ink on clean
// white, marquee yellow for the one thing to tap, signal blue for coloured copy.
// Bricolage Grotesque for display, Instrument Sans for reading. Token names (coral, mint)
// are kept from the first identity so screens did not need renaming.
export const color = {
  canvas: "#F4F5F8",
  paper: "#FFFFFF",
  ink: "#10173A",
  inkSoft: "#27305A",
  muted: "#4E5674",
  faint: "#8B92AB",
  line: "#E1E4EC",
  // The accent is marquee yellow: a fill colour that always carries ink text.
  coral: "#FFC53D",
  // Coloured copy and links use signal blue, which passes contrast on white and canvas.
  coralText: "#2B46D9",
  coralTint: "#FFF3CF",
  mint: "#CFE0FF",
  mintTint: "#EDF2FF",
  lavender: "#C5B6FF",
  lavenderTint: "#F0ECFF",
  yellow: "#FFD98A",
  yellowTint: "#FFF6DD",
  success: "#1D4ED8",
  warning: "#7A5200",
  danger: "#B3261E",
};
export const font = {
  display: "BricolageGrotesque_600SemiBold",
  displayBold: "BricolageGrotesque_700Bold",
  body: "InstrumentSans_400Regular",
  bodyMedium: "InstrumentSans_500Medium",
  bodyBold: "InstrumentSans_600SemiBold",
};
// 4/8pt rhythm.
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };
export const radius = { sm: 10, md: 16, lg: 22, xl: 28, pill: 999 };
export const type = {
  hero: { fontFamily: font.displayBold, fontSize: 38, lineHeight: 40, letterSpacing: -1.2 },
  title: { fontFamily: font.display, fontSize: 27, lineHeight: 31, letterSpacing: -0.7 },
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
    shadowColor: "#10173A",
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  lift: {
    shadowColor: "#10173A",
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
