import { ItineraryView } from "@/components/itinerary";
export default async function Page({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  return <ItineraryView id={(await params).shareId} shared />;
}
