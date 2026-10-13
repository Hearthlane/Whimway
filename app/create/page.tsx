import { CreatePlan } from "@/components/create-plan";
export default function Page() {
  return <CreatePlan currencies={Intl.supportedValuesOf("currency")} />;
}
