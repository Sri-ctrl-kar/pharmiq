import type { ReportStatus } from "@/lib/reports/constants";
import type { ReportContent } from "@/lib/reports/schema";

export type StorageMode = "local-demo" | "supabase";

/** A validated report ready to persist. */
export type NewReportRecord = {
  reportId: string;
  /** Client-generated token so a retried submission never creates a second report. */
  idempotencyKey: string;
  content: ReportContent;
  missingFields: string[];
};

export type StoredReport = {
  reportId: string;
  submittedAt: string;
  status: ReportStatus;
  isSynthetic: boolean;
  content: ReportContent;
  missingFields: string[];
};

export type CreateReportResult = {
  reportId: string;
  submittedAt: string;
  /** True when this idempotency key was already stored; the original report is returned. */
  duplicate: boolean;
};

export interface ReportRepository {
  readonly mode: StorageMode;
  create(record: NewReportRecord): Promise<CreateReportResult>;
}

/** The generated report ID is already taken; the caller should retry with a new one. */
export class ReportIdConflictError extends Error {
  constructor() {
    super("Report ID already exists");
    this.name = "ReportIdConflictError";
  }
}

/** Storage could not complete the write. Messages must never include report content. */
export class StorageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageUnavailableError";
  }
}
