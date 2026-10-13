"use client";
import { Button, Empty } from "@/components/ui";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="wrap">
      <Empty
        title="A little bump in the road."
        text="This page could not be loaded. Your saved device plans are still available."
      >
        <Button className="primary" onClick={reset}>
          Try again
        </Button>
      </Empty>
    </div>
  );
}
