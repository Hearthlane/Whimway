import { Redirect } from "expo-router";

// The centre tab is an action, not a place: pressing it opens the Create sheet
// (see the tab layout). Landing here directly goes there too.
export default function NewPlan() {
  return <Redirect href="/create" />;
}
