import { FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { safetyCopy } from "@/lib/site";
import { cn } from "@/lib/utils";

/** Required on every chart, table or figure built from demonstration data. */
export function SyntheticDataBadge({ className }: { className?: string }) {
  return (
    <Badge
      tone="synthetic"
      className={className}
      title={safetyCopy.syntheticData}
    >
      <FlaskConical aria-hidden="true" />
      Synthetic demonstration data
    </Badge>
  );
}

export function SyntheticDataBanner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-synthetic/25 bg-synthetic-soft p-4 text-sm sm:flex-row sm:items-center",
        className,
      )}
    >
      <SyntheticDataBadge className="self-start bg-surface sm:self-auto" />
      <p className="text-foreground/90">{safetyCopy.syntheticData}</p>
    </div>
  );
}
