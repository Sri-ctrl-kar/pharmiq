import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  canTransition,
  noteRequired,
  type StatusChange,
} from "@/lib/review/status";
import type {
  ReviewReport,
  ReviewerIdentity,
  StatusEvent,
} from "@/lib/review/types";
import type {
  ReviewRepository,
  StatusUpdateResult,
} from "@/server/review/repository";
import { syntheticSeedReports, type SeedReport } from "./demo-seed";
import {
  ReportIdConflictError,
  StorageUnavailableError,
  type CreateReportResult,
  type NewReportRecord,
  type ReportRepository,
  type StoredReport,
} from "./repository";

export const LOCAL_DEMO_NOTICE =
  "LOCAL DEMONSTRATION STORAGE. Plain JSON file on the app server: not encrypted, no access control, no backups. Not a secure production database. Use synthetic or test data only.";

type DemoRow = StoredReport & {
  idempotencyKey: string | null;
  /** Status history (added in Milestone 4; absent in older demo files). */
  events?: StatusEvent[];
  updatedAt?: string;
};
type DemoFile = { notice: string; version: 1; reports: DemoRow[] };

/**
 * Stores reports in a JSON file for local demos when Supabase is not configured.
 * Writes are serialised in-process and replace the file atomically. A corrupt or
 * unreadable file is reported as a storage failure and is never overwritten.
 */
export class LocalDemoReportRepository
  implements ReportRepository, ReviewRepository
{
  readonly mode = "local-demo" as const;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly seed: SeedReport[] = syntheticSeedReports,
  ) {}

  create(record: NewReportRecord): Promise<CreateReportResult> {
    return this.serialise(async () => {
      const file = await this.load();
      const existing = file.reports.find(
        (row) => row.idempotencyKey === record.idempotencyKey,
      );
      if (existing) {
        return {
          reportId: existing.reportId,
          submittedAt: existing.submittedAt,
          duplicate: true,
        };
      }
      if (file.reports.some((row) => row.reportId === record.reportId)) {
        throw new ReportIdConflictError();
      }

      const row: DemoRow = {
        reportId: record.reportId,
        idempotencyKey: record.idempotencyKey,
        submittedAt: new Date().toISOString(),
        status: "submitted",
        isSynthetic: false,
        content: record.content,
        missingFields: record.missingFields,
      };
      await this.save({ ...file, reports: [...file.reports, row] });
      return {
        reportId: row.reportId,
        submittedAt: row.submittedAt,
        duplicate: false,
      };
    });
  }

  /** All stored reports, newest first. For demo views and tests only. */
  async list(): Promise<StoredReport[]> {
    const file = await this.serialise(() => this.load());
    return file.reports
      .map(({ idempotencyKey: _key, ...report }) => report)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  }

  // -------------------------------------------------------------------------
  // Reviewer access. Callers must authorise the reviewer first.
  // -------------------------------------------------------------------------

  async listReports(): Promise<ReviewReport[]> {
    const file = await this.serialise(() => this.load());
    return file.reports
      .map(toReviewReport)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  }

  async getReport(reportId: string): Promise<ReviewReport | null> {
    const file = await this.serialise(() => this.load());
    const row = file.reports.find(
      (candidate) => candidate.reportId === reportId,
    );
    return row ? toReviewReport(row) : null;
  }

  updateStatus(
    change: StatusChange,
    reviewer: ReviewerIdentity,
  ): Promise<StatusUpdateResult> {
    return this.serialise(async () => {
      const file = await this.load();
      const index = file.reports.findIndex(
        (row) => row.reportId === change.reportId,
      );
      if (index === -1) return { ok: false, reason: "not_found" } as const;
      const row = file.reports[index];
      // Optimistic concurrency: refuse if someone else changed it first.
      if (row.status !== change.expectedStatus) {
        return { ok: false, reason: "conflict" } as const;
      }
      if (
        !canTransition(row.status, change.nextStatus) ||
        (noteRequired(row.status, change.nextStatus) && !change.note)
      ) {
        return { ok: false, reason: "invalid_transition" } as const;
      }
      const at = new Date().toISOString();
      const updated: DemoRow = {
        ...row,
        status: change.nextStatus,
        updatedAt: at,
        events: [
          ...(row.events ?? []),
          {
            at,
            from: row.status,
            to: change.nextStatus,
            note: change.note,
            reviewer: reviewer.label,
          },
        ],
      };
      const reports = [...file.reports];
      reports[index] = updated;
      await this.save({ ...file, reports });
      return { ok: true, report: toReviewReport(updated) } as const;
    });
  }

  private serialise<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async load(): Promise<DemoFile> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        const seeded: DemoFile = {
          notice: LOCAL_DEMO_NOTICE,
          version: 1,
          reports: this.seed.map((report) => ({
            ...report,
            idempotencyKey: null,
          })),
        };
        await this.save(seeded);
        return seeded;
      }
      throw new StorageUnavailableError("Demo store could not be read");
    }

    try {
      const parsed = JSON.parse(raw) as DemoFile;
      if (parsed.version !== 1 || !Array.isArray(parsed.reports))
        throw new Error();
      return parsed;
    } catch {
      throw new StorageUnavailableError("Demo store file is corrupt");
    }
  }

  private async save(file: DemoFile): Promise<void> {
    try {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify(file, null, 2), { mode: 0o600 });
      await rename(temp, this.filePath);
    } catch {
      throw new StorageUnavailableError("Demo store could not be written");
    }
  }
}

/** Normalise a stored row for reviewers (older demo files lack newer fields). */
function toReviewReport(row: DemoRow): ReviewReport {
  const events = row.events ?? [];
  return {
    reportId: row.reportId,
    submittedAt: row.submittedAt,
    updatedAt: row.updatedAt ?? events.at(-1)?.at ?? row.submittedAt,
    status: row.status,
    isSynthetic: row.isSynthetic,
    content: {
      ...row.content,
      reaction: {
        ...row.content.reaction,
        symptoms: row.content.reaction.symptoms ?? [],
      },
      aiAssisted: row.content.aiAssisted ?? false,
    },
    missingFields: row.missingFields,
    events,
  };
}
