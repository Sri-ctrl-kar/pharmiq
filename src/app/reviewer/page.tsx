import type { Metadata } from "next";
import { MilestonePlaceholder } from "@/components/layout/milestone-placeholder";

export const metadata: Metadata = { title: "Reviewer" };

export default function ReviewerPage() {
  return (
    <MilestonePlaceholder
      title="Reviewer workspace"
      description="For authorised healthcare professionals to review submitted reports. Sign-in will be required."
      milestone="Milestone 4"
    />
  );
}
