import Svg, { Circle, Ellipse, G, Line, Path, Rect } from "react-native-svg";
import { color } from "@/ui/theme";

/**
 * Flat poster-style pictures for the guided planner's choices. One drawing per cuisine and
 * per kind of fun, in the app's four colours. They stand for a kind of place, not a venue.
 */
const INK = color.ink;
const Y = color.coral;
const B = color.coralText;
const L = color.lavender;
const W = color.paper;

const art: Record<string, { bg: string; draw: () => React.ReactNode }> = {
  asian: {
    bg: color.mintTint,
    draw: () => (
      <G>
        <Line x1={74} y1={10} x2={56} y2={46} stroke={INK} strokeWidth={3.5} strokeLinecap="round" />
        <Line x1={84} y1={13} x2={64} y2={46} stroke={INK} strokeWidth={3.5} strokeLinecap="round" />
        <Path d="M24 46 h72 a36 34 0 0 1 -72 0z" fill={INK} />
        <Ellipse cx={60} cy={46} rx={36} ry={8} fill={Y} />
        <Path d="M34 46 q6 -5 12 0 t12 0 t12 0" stroke={W} strokeWidth={3} fill="none" strokeLinecap="round" />
        <Circle cx={80} cy={45} r={6} fill={W} />
        <Circle cx={80} cy={45} r={2.6} fill={Y} />
        <Rect x={48} y={78} width={24} height={5} rx={2.5} fill={INK} />
      </G>
    ),
  },
  mexican: {
    bg: color.coralTint,
    draw: () => (
      <G>
        <Circle cx={38} cy={40} r={9} fill={B} />
        <Circle cx={52} cy={30} r={9} fill={L} />
        <Circle cx={68} cy={30} r={9} fill={INK} />
        <Circle cx={82} cy={40} r={9} fill={B} />
        <Path d="M20 70 a40 40 0 0 1 80 0z" fill={Y} />
        <Path d="M30 70 a30 30 0 0 1 60 0" stroke={INK} strokeWidth={2.5} fill="none" strokeDasharray="1 7" strokeLinecap="round" />
      </G>
    ),
  },
  italian: {
    bg: color.lavenderTint,
    draw: () => (
      <G>
        <Path d="M60 82 L28 26 Q60 12 92 26 Z" fill={Y} />
        <Path d="M28 26 Q60 12 92 26" stroke={INK} strokeWidth={8} fill="none" strokeLinecap="round" />
        <Circle cx={50} cy={40} r={6} fill={INK} />
        <Circle cx={70} cy={42} r={6} fill={B} />
        <Circle cx={60} cy={60} r={5} fill={INK} />
        <Circle cx={58} cy={30} r={2.5} fill={W} />
        <Circle cx={66} cy={54} r={2.5} fill={W} />
      </G>
    ),
  },
  western: {
    bg: color.mintTint,
    draw: () => (
      <G>
        <Path d="M28 42 a32 26 0 0 1 64 0z" fill={Y} />
        <Circle cx={48} cy={28} r={1.8} fill={W} />
        <Circle cx={60} cy={23} r={1.8} fill={W} />
        <Circle cx={72} cy={28} r={1.8} fill={W} />
        <Path d="M26 48 q8 7 17 0 t17 0 t17 0 t17 0" stroke={B} strokeWidth={5} fill="none" strokeLinecap="round" />
        <Rect x={27} y={54} width={66} height={11} rx={5.5} fill={INK} />
        <Path d="M56 54 h22 l-11 9z" fill={Y} />
        <Rect x={29} y={68} width={62} height={11} rx={5.5} fill={Y} />
      </G>
    ),
  },
  indian: {
    bg: color.coralTint,
    draw: () => (
      <G>
        <Path d="M66 18 q24 2 26 22 q-18 10 -32 -4 z" fill={W} stroke={INK} strokeWidth={2.5} />
        <Circle cx={76} cy={30} r={2} fill={L} />
        <Circle cx={83} cy={36} r={2} fill={L} />
        <Path d="M20 50 h64 a32 30 0 0 1 -64 0z" fill={INK} />
        <Ellipse cx={52} cy={50} rx={32} ry={7.5} fill={Y} />
        <Circle cx={44} cy={49} r={3} fill={B} />
        <Circle cx={58} cy={51} r={3} fill={W} />
      </G>
    ),
  },
  sweet: {
    bg: color.lavenderTint,
    draw: () => (
      <G>
        <Path d="M46 50 L60 84 L74 50Z" fill={Y} />
        <Path d="M52 58 l12 6 M56 68 l7 3.5" stroke={INK} strokeWidth={2} strokeLinecap="round" />
        <Circle cx={60} cy={42} r={17} fill={L} />
        <Circle cx={60} cy={24} r={12} fill={W} />
        <Circle cx={60} cy={11} r={4} fill={INK} />
      </G>
    ),
  },
  games: {
    bg: color.lavenderTint,
    draw: () => (
      <G>
        <Rect x={22} y={56} width={76} height={22} rx={11} fill={INK} />
        <Line x1={46} y1={58} x2={54} y2={28} stroke={INK} strokeWidth={5} strokeLinecap="round" />
        <Circle cx={55} cy={24} r={10} fill={Y} />
        <Circle cx={74} cy={67} r={5} fill={B} />
        <Circle cx={87} cy={67} r={5} fill={W} />
      </G>
    ),
  },
  shows: {
    bg: color.coralTint,
    draw: () => (
      <G rotation={-8} origin="60, 45">
        <Path d="M22 26 h76 v12 a7 7 0 0 0 0 14 v12 h-76 v-12 a7 7 0 0 0 0 -14 z" fill={INK} />
        <Line x1={74} y1={30} x2={74} y2={60} stroke={W} strokeWidth={2} strokeDasharray="3 4" />
        <Path d="M48 34 l3.4 7 7.6 1 -5.5 5.3 1.3 7.6 -6.8 -3.6 -6.8 3.6 1.3 -7.6 -5.5 -5.3 7.6 -1z" fill={Y} />
      </G>
    ),
  },
  culture: {
    bg: color.mintTint,
    draw: () => (
      <G>
        <Rect x={26} y={16} width={68} height={58} rx={4} fill={W} stroke={INK} strokeWidth={5} />
        <Circle cx={74} cy={34} r={7} fill={Y} />
        <Path d="M31 69 l20 -26 14 16 8 -9 16 19z" fill={B} />
        <Path d="M31 69 l20 -26 9 10 -12 16z" fill={L} />
      </G>
    ),
  },
  outdoors: {
    bg: color.mintTint,
    draw: () => (
      <G>
        <Circle cx={88} cy={24} r={10} fill={Y} />
        <Path d="M10 78 q24 -30 50 -8 q22 -18 50 8z" fill={L} />
        <Rect x={38} y={44} width={5} height={30} rx={2.5} fill={INK} />
        <Circle cx={40.5} cy={38} r={15} fill={B} />
        <Rect x={66} y={56} width={4} height={20} rx={2} fill={INK} />
        <Circle cx={68} cy={52} r={10} fill={INK} />
      </G>
    ),
  },
  shopping: {
    bg: color.coralTint,
    draw: () => (
      <G>
        <Path d="M46 34 v-6 a14 14 0 0 1 28 0 v6" stroke={INK} strokeWidth={4.5} fill="none" strokeLinecap="round" />
        <Path d="M30 34 h60 l5 46 h-70z" fill={Y} />
        <Circle cx={46} cy={44} r={3} fill={INK} />
        <Circle cx={74} cy={44} r={3} fill={INK} />
        <Path d="M50 60 h20" stroke={INK} strokeWidth={3} strokeLinecap="round" />
      </G>
    ),
  },
  drinks: {
    bg: color.lavenderTint,
    draw: () => (
      <G>
        <Path d="M34 22 h52 L60 52Z" fill={B} />
        <Path d="M41 30 h38 L60 52Z" fill={Y} />
        <Line x1={60} y1={52} x2={60} y2={76} stroke={INK} strokeWidth={4} strokeLinecap="round" />
        <Line x1={46} y1={78} x2={74} y2={78} stroke={INK} strokeWidth={4} strokeLinecap="round" />
        <Line x1={78} y1={12} x2={62} y2={36} stroke={INK} strokeWidth={2.5} strokeLinecap="round" />
        <Circle cx={64} cy={33} r={4.5} fill={INK} />
      </G>
    ),
  },
};

export function GuideArt({ name, height = 96, bg }: { name: string; height?: number; bg?: string }) {
  const a = art[name] ?? art.culture;
  return (
    <Svg width="100%" height={height} viewBox="0 0 120 90" preserveAspectRatio="xMidYMid meet" style={{ backgroundColor: bg ?? a.bg }}>
      {a.draw()}
    </Svg>
  );
}
