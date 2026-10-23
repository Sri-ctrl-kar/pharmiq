import type { Metadata } from "next";
import { MilestonePlaceholder } from "@/components/layout/milestone-placeholder";
import { SyntheticDataBanner } from "@/components/safety/synthetic-data-badge";

export const metadata: Metadata = { title: "Analytics" };

export default function DashboardPage() {
  return (
    <MilestonePlaceholder
      title="Analytics dashboard"
      description="Aggregate trends across reported suspected reactions."
      milestone="Milestone 6"
    >
      <SyntheticDataBanner />
    </MilestonePlaceholder>
  );
}
