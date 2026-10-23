"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Check, CheckCircle2, Copy } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { MissingItem } from "@/lib/reports/missing-information";
import type { StorageModeLabel } from "@/lib/reports/submission-state";
import { safetyCopy } from "@/lib/site";

type Props = {
  reportId: string;
  submittedAt: string;
  missingInformation: MissingItem[];
  storageMode: StorageModeLabel;
  onReportAnother: () => void;
};

const formatter = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

export function SubmissionSuccess({
  reportId,
  submittedAt,
  missingInformation,
  storageMode,
  onReportAnother,
}: Props) {
  const [copied, setCopied] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Announce the result and bring it into view for keyboard and screen reader users.
  useEffect(() => {
    headingRef.current?.focus();
    headingRef.current?.scrollIntoView({ block: "center" });
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(reportId);
      setCopied(true);
    } catch {
      // Clipboard unavailable (e.g. non-HTTPS); the ID stays visible to copy manually.
    }
  }

  return (
    <div className="flex flex-col gap-6" role="status" aria-live="polite">
      <Card>
        <CardContent className="flex flex-col items-start gap-5">
          <span className="flex size-12 items-center justify-center rounded-full bg-success-soft text-success">
            <CheckCircle2 className="size-7" aria-hidden="true" />
          </span>
          <div className="flex flex-col gap-1">
            <h2
              ref={headingRef}
              className="text-xl font-semibold focus:outline-none"
              tabIndex={-1}
            >
              Your report has been recorded
            </h2>
            <p className="text-sm text-muted">
              Submitted {formatter.format(new Date(submittedAt))} IST
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 rounded-lg border border-border bg-surface-muted p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-medium tracking-wide text-muted uppercase">
                Report ID
              </p>
              <p
                className="font-mono text-2xl font-semibold tracking-wider"
                data-testid="report-id"
              >
                {reportId}
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={copy}>
              {copied ? (
                <Check aria-hidden="true" />
              ) : (
                <Copy aria-hidden="true" />
              )}
              {copied ? "Copied" : "Copy ID"}
            </Button>
          </div>
          <p className="text-sm">
            Keep this ID if you want to refer to your report later. Its status
            is <strong>Submitted</strong>; it may be looked at by authorised
            reviewers.
          </p>
        </CardContent>
      </Card>

      <Alert tone="info" title="What this report is — and is not">
        <ul className="list-disc space-y-1 pl-4">
          <li>{safetyCopy.notSentToPvpi}</li>
          <li>{safetyCopy.notMedicalAdvice}</li>
          <li>{safetyCopy.doNotStopMedication}</li>
        </ul>
      </Alert>

      {storageMode === "local-demo" ? (
        <p className="text-sm text-muted">
          Saved to demonstration storage only (see the notice above).
        </p>
      ) : null}

      {missingInformation.length > 0 ? (
        <p className="text-sm text-muted">
          Recorded as not provided:{" "}
          {missingInformation.map((item) => item.label).join("; ")}.
        </p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button onClick={onReportAnother}>Report another reaction</Button>
        <Link href="/" className={buttonVariants({ variant: "secondary" })}>
          Back to home
        </Link>
      </div>
    </div>
  );
}
