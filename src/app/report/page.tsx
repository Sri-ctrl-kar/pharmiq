import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { Database } from "lucide-react";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import {
  EmergencyNotice,
  SafetyNotice,
} from "@/components/safety/safety-notice";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { safetyCopy } from "@/lib/site";
import { isAiExtractionConfigured } from "@/server/ai";
import { getStorageStatus } from "@/server/reports/storage";
import { ReportFormShell } from "./_components/report-form";

export const metadata: Metadata = { title: "Report a reaction" };

export default function ReportPage() {
  return (
    <Container className="flex flex-col gap-8 py-10">
      <PageHeader
        title="Report a suspected reaction"
        description="A guided form for patients, caregivers and healthcare professionals. It takes about 5 minutes. Only a few questions are required — leave anything you don't know blank."
      />
      <div className="grid gap-4 md:grid-cols-2">
        <EmergencyNotice />
        <SafetyNotice />
      </div>
      <Suspense fallback={<FormSkeleton />}>
        <ReportFormWithStorage />
      </Suspense>
      <p className="text-xs text-muted">{safetyCopy.notOfficial}</p>
    </Container>
  );
}

async function ReportFormWithStorage() {
  // Storage configuration is read at request time, not baked in at build time.
  await connection();
  const storage = getStorageStatus();

  if (storage.mode === "misconfigured") {
    return (
      <Alert tone="danger" title="Reporting is temporarily unavailable">
        Report storage is not configured correctly, so reports cannot be saved
        right now. Please try again later.
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {storage.mode === "local-demo" ? (
        <div className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning-soft p-4 text-sm sm:flex-row sm:items-center">
          <Badge tone="warning" className="self-start bg-surface sm:self-auto">
            <Database aria-hidden="true" />
            Demo storage
          </Badge>
          <p>{safetyCopy.localDemoStorage}</p>
        </div>
      ) : null}
      <ReportFormShell
        storageMode={storage.mode}
        aiAvailable={isAiExtractionConfigured()}
      />
    </div>
  );
}

function FormSkeleton() {
  return (
    <Card aria-busy="true" aria-label="Loading report form">
      <CardContent className="flex animate-pulse flex-col gap-4">
        <div className="h-6 w-48 rounded bg-surface-muted" />
        <div className="h-20 rounded bg-surface-muted" />
        <div className="h-10 rounded bg-surface-muted" />
        <div className="h-10 rounded bg-surface-muted" />
      </CardContent>
    </Card>
  );
}
