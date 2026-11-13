import { ItineraryView } from "@/components/itinerary";
export const metadata = {
  title: "A plan worth going on · Whimway",
  description:
    "Someone shared a Whimway plan with you. Open it, copy it, make it yours.",
};
// Account-free share links: the redacted plan lives in the URL fragment (#…),
// which is never sent to the server; the page hydrates live venue data from IDs.
export default function Page() {
  return <ItineraryView id="link" shared />;
}
