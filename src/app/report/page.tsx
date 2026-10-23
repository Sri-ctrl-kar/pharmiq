import type { Metadata } from "next";
import { MilestonePlaceholder } from "@/components/layout/milestone-placeholder";
import {
  EmergencyNotice,
  SafetyNotice,
} from "@/components/safety/safety-notice";

export const metadata: Metadata = { title: "Report a reaction" };

export default function ReportPage() {
  return (
    <MilestonePlaceholder
      title="Report a suspected reaction"
      description="A guided form for patients, caregivers and healthcare professionals."
      milestone="Milestone 3"
    >
      <div className="grid gap-4 md:grid-cols-2">
        <EmergencyNotice />
        <SafetyNotice />
      </div>
    </MilestonePlaceholder>
  );
}
