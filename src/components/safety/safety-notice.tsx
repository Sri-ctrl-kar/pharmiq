import { Alert } from "@/components/ui/alert";
import { safetyCopy } from "@/lib/site";

/** Standard reporting-context safety notice. Shown before and during reporting. */
export function SafetyNotice({ className }: { className?: string }) {
  return (
    <Alert tone="warning" title="Before you report" className={className}>
      <ul className="list-disc space-y-1 pl-4">
        <li>{safetyCopy.doNotStopMedication}</li>
        <li>{safetyCopy.notMedicalAdvice}</li>
      </ul>
    </Alert>
  );
}

export function EmergencyNotice({ className }: { className?: string }) {
  return (
    <Alert tone="danger" title="Medical emergency?" className={className}>
      {safetyCopy.emergency}
    </Alert>
  );
}
