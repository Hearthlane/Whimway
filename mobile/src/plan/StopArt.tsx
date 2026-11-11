import Svg, { Circle, Ellipse, G, Path, Rect } from "react-native-svg";
import { color } from "@/ui/theme";

/**
 * Original illustrated artwork for a stop, chosen from its category. Used whenever a
 * venue has no licensed photo (always in demo mode). These are illustrations of a kind
 * of place, never a depiction of the venue itself.
 */
export type ArtKind = "meal" | "drinks" | "cafe" | "sweet" | "outdoors" | "culture" | "play" | "shop" | "landmark" | "water";

export function artKind(place: { category: string; types: string[] }): ArtKind {
  const t = `${place.category} ${place.types.join(" ")}`.toLowerCase();
  if (/aquarium|island|beach|waterfront|marina|lake/.test(t)) return "water";
  if (/ice_cream|dessert|patisserie|bakery|chocolate/.test(t)) return "sweet";
  if (/cafe|café|coffee|tea/.test(t)) return "cafe";
  if (/bar|brewery|wine|cocktail|pub|night_club/.test(t) && !/restaurant/.test(place.types[0] ?? "")) return "drinks";
  if (/restaurant|brunch|food_court|diner|meal/.test(t)) return "meal";
  if (/game|bowling|amusement|arcade|karaoke|escape|mini_golf/.test(t)) return "play";
  if (/museum|gallery|theat|cinema|movie|performing|castle|historic/.test(t)) return "culture";
  if (/park|garden|hiking|trail|conservat|nature/.test(t)) return "outdoors";
  if (/market|mall|shop|store|boutique/.test(t)) return "shop";
  return "landmark";
}

const INK = color.ink;
const scenes: Record<ArtKind, { bg: string; draw: () => React.ReactNode }> = {
  meal: {
    bg: "#FFE7E2",
    draw: () => (
      <G>
        <Ellipse cx={160} cy={150} rx={190} ry={70} fill={color.coral} />
        <Circle cx={160} cy={84} r={44} fill={color.paper} />
        <Circle cx={160} cy={84} r={30} fill="none" stroke={color.line} strokeWidth={3} />
        <Circle cx={150} cy={80} r={9} fill={color.yellow} />
        <Circle cx={170} cy={90} r={7} fill={color.mint} />
        <Rect x={92} y={48} width={5} height={70} rx={2.5} fill={INK} />
        <Path d="M222 48 q10 22 0 38 v32" stroke={INK} strokeWidth={5} strokeLinecap="round" fill="none" />
        <Circle cx={262} cy={52} r={14} fill={color.paper} opacity={0.9} />
        <Circle cx={56} cy={46} r={10} fill={color.lavender} />
      </G>
    ),
  },
  drinks: {
    bg: "#EEE9FD",
    draw: () => (
      <G>
        <Circle cx={250} cy={36} r={22} fill={color.yellow} />
        <Path d="M118 34 h84 l-34 40 v30 h18 v6 h-52 v-6 h18 v-30 z" fill={INK} />
        <Path d="M131 44 h58 l-13 15 h-32 z" fill={color.coral} />
        <Circle cx={196} cy={30} r={8} fill={color.mint} />
        <Path d="M40 120 q30 -40 70 -18 q30 -30 70 -6 q40 -26 80 0 q30 -14 60 6 v40 h-280 z" fill={color.lavender} />
        <Path d="M60 26 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3 z" fill={INK} />
      </G>
    ),
  },
  cafe: {
    bg: "#FFF4DB",
    draw: () => (
      <G>
        <Ellipse cx={160} cy={118} rx={120} ry={14} fill={color.yellow} />
        <Path d="M112 58 h82 v22 a34 34 0 0 1 -34 34 h-14 a34 34 0 0 1 -34 -34 z" fill={color.paper} stroke={INK} strokeWidth={4} />
        <Path d="M194 66 h10 a14 14 0 0 1 0 28 h-12" fill="none" stroke={INK} strokeWidth={4} />
        <Path d="M136 44 q-8 -10 0 -20 M156 44 q-8 -10 0 -20 M176 44 q-8 -10 0 -20" stroke={color.coral} strokeWidth={4} strokeLinecap="round" fill="none" />
        <Circle cx={262} cy={40} r={16} fill={color.mint} />
        <Rect x={44} y={70} width={30} height={40} rx={6} fill={color.lavender} />
      </G>
    ),
  },
  sweet: {
    bg: "#FFE7E2",
    draw: () => (
      <G>
        <Path d="M138 74 l22 52 22 -52 z" fill={color.yellow} stroke={INK} strokeWidth={4} strokeLinejoin="round" />
        <Circle cx={160} cy={56} r={26} fill={color.paper} stroke={INK} strokeWidth={4} />
        <Circle cx={160} cy={28} r={9} fill={color.coral} />
        <Circle cx={70} cy={50} r={20} fill={color.lavender} />
        <Circle cx={254} cy={86} r={26} fill={color.mint} />
        <Path d="M240 30 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3 z" fill={INK} />
      </G>
    ),
  },
  outdoors: {
    bg: "#E6F6F0",
    draw: () => (
      <G>
        <Circle cx={250} cy={40} r={24} fill={color.yellow} />
        <Path d="M-10 130 q70 -70 150 -30 q60 -50 130 -10 q40 -20 70 0 v50 h-350 z" fill={color.mint} />
        <Path d="M-10 140 q90 -40 180 -10 q80 -30 170 0 v30 h-350 z" fill="#8FD3BC" />
        <Rect x={84} y={70} width={6} height={36} rx={3} fill={INK} />
        <Circle cx={87} cy={60} r={22} fill="#2F7A5B" />
        <Rect x={196} y={84} width={5} height={26} rx={2.5} fill={INK} />
        <Circle cx={198} cy={76} r={15} fill="#2F7A5B" />
      </G>
    ),
  },
  culture: {
    bg: "#EEE9FD",
    draw: () => (
      <G>
        <Path d="M90 52 l70 -30 70 30 z" fill={INK} />
        <Rect x={98} y={56} width={14} height={50} fill={color.paper} stroke={INK} strokeWidth={3} />
        <Rect x={132} y={56} width={14} height={50} fill={color.paper} stroke={INK} strokeWidth={3} />
        <Rect x={174} y={56} width={14} height={50} fill={color.paper} stroke={INK} strokeWidth={3} />
        <Rect x={208} y={56} width={14} height={50} fill={color.paper} stroke={INK} strokeWidth={3} />
        <Rect x={84} y={106} width={152} height={10} rx={3} fill={INK} />
        <Rect x={258} y={44} width={40} height={50} rx={4} fill={color.coral} />
        <Circle cx={278} cy={62} r={9} fill={color.yellow} />
        <Circle cx={46} cy={56} r={18} fill={color.lavender} />
      </G>
    ),
  },
  play: {
    bg: "#FFF4DB",
    draw: () => (
      <G>
        <Circle cx={110} cy={78} r={34} fill={INK} />
        <Circle cx={100} cy={66} r={5} fill={color.paper} />
        <Circle cx={116} cy={64} r={5} fill={color.paper} />
        <Circle cx={108} cy={80} r={5} fill={color.paper} />
        <Path d="M190 110 q-10 -30 4 -44 q-6 -14 6 -22 q12 8 6 22 q14 14 4 44 z" fill={color.paper} stroke={INK} strokeWidth={3} />
        <Path d="M190 62 h20" stroke={color.coral} strokeWidth={4} />
        <Path d="M232 110 q-10 -30 4 -44 q-6 -14 6 -22 q12 8 6 22 q14 14 4 44 z" fill={color.paper} stroke={INK} strokeWidth={3} />
        <Path d="M232 62 h20" stroke={color.coral} strokeWidth={4} />
        <Path d="M276 30 l4 10 10 4 -10 4 -4 10 -4 -10 -10 -4 10 -4 z" fill={color.coral} />
        <Circle cx={44} cy={36} r={12} fill={color.mint} />
      </G>
    ),
  },
  shop: {
    bg: "#E6F6F0",
    draw: () => (
      <G>
        <Rect x={76} y={56} width={168} height={64} fill={color.paper} stroke={INK} strokeWidth={3} />
        <Path d="M68 56 l12 -28 h160 l12 28 z" fill={color.coral} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
        <Path d="M108 28 l-6 28 M140 28 l-3 28 M180 28 l3 28 M212 28 l6 28" stroke={color.paper} strokeWidth={10} />
        <Rect x={92} y={70} width={44} height={30} rx={3} fill={color.yellow} />
        <Rect x={184} y={70} width={44} height={50} rx={3} fill={INK} />
        <Circle cx={282} cy={44} r={16} fill={color.lavender} />
      </G>
    ),
  },
  landmark: {
    bg: "#EEE9FD",
    draw: () => (
      <G>
        <Circle cx={66} cy={40} r={20} fill={color.yellow} />
        <Rect x={156} y={10} width={8} height={110} fill={INK} />
        <Ellipse cx={160} cy={46} rx={22} ry={9} fill={color.coral} stroke={INK} strokeWidth={3} />
        <Rect x={84} y={70} width={34} height={50} fill={color.lavender} />
        <Rect x={118} y={86} width={26} height={34} fill="#9C87E8" />
        <Rect x={180} y={62} width={30} height={58} fill={color.mint} />
        <Rect x={214} y={80} width={40} height={40} fill={color.lavender} />
        <Rect x={258} y={96} width={30} height={24} fill="#9C87E8" />
        <Rect x={40} y={98} width={40} height={22} fill="#9C87E8" />
      </G>
    ),
  },
  water: {
    bg: "#E6F6F0",
    draw: () => (
      <G>
        <Circle cx={254} cy={36} r={20} fill={color.yellow} />
        <Path d="M-10 84 q40 -18 80 0 t80 0 t80 0 t80 0 t80 0 v60 h-400 z" fill={color.mint} />
        <Path d="M-10 104 q40 -18 80 0 t80 0 t80 0 t80 0 t80 0 v40 h-400 z" fill="#8FD3BC" />
        <Path d="M112 70 h74 l-14 22 h-46 z" fill={INK} />
        <Path d="M150 22 v46 M150 26 l30 36 h-30 z" stroke={INK} strokeWidth={4} fill={color.coral} strokeLinejoin="round" />
        <Path d="M48 40 q8 -8 16 0 q8 -8 16 0" stroke={INK} strokeWidth={3} fill="none" strokeLinecap="round" />
      </G>
    ),
  },
};

export function StopArt({ place, height = 120 }: { place: { category: string; types: string[] }; height?: number }) {
  const scene = scenes[artKind(place)];
  return (
    <Svg width="100%" height={height} viewBox="0 0 320 120" preserveAspectRatio="xMidYMid slice" accessibilityElementsHidden importantForAccessibility="no">
      <Rect x={-200} y={0} width={720} height={120} fill={scene.bg} />
      {scene.draw()}
    </Svg>
  );
}
