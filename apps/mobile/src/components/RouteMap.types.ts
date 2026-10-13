import type { StyleProp, ViewStyle } from "react-native";
import type { Itinerary, Point, TravelLeg } from "../../../../lib/schema";
export type RouteMapProps = {
  plan?: Itinerary;
  center?: Point;
  radius?: number;
  selectedId?: string;
  onSelectStop?: (placeId: string) => void;
  onSelectPoint?: (point: Point) => void;
  userLocation?: Point;
  showUserLocation?: boolean;
  guideLeg?: TravelLeg;
  style?: StyleProp<ViewStyle>;
};
