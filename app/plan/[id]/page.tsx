import { ItineraryView } from "@/components/itinerary";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <ItineraryView id={(await params).id} />;
}
