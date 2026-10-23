import { Badge } from "@/components/ui/badge";
import type { ReportStatus } from "@/lib/reports/constants";
import { reviewerStatusLabels, reviewerStatusTone } from "@/lib/review/status";

export function StatusBadge({ status }: { status: ReportStatus }) {
  return (
    <Badge tone={reviewerStatusTone[status]}>
      {reviewerStatusLabels[status]}
    </Badge>
  );
}
