import {
  findMissingInformation,
  type MissingItem,
} from "@/lib/reports/missing-information";
import { generateReportId } from "@/lib/reports/report-id";
import {
  reportSubmissionSchema,
  toFieldErrors,
  toReportContent,
  type FieldErrors,
} from "@/lib/reports/schema";
import { ReportIdConflictError, type ReportRepository } from "./repository";

export const MAX_REPORT_ID_ATTEMPTS = 5;

export type SubmitReportResult =
  | {
      ok: true;
      reportId: string;
      submittedAt: string;
      duplicate: boolean;
      missingInformation: MissingItem[];
    }
  | { ok: false; reason: "validation"; fieldErrors: FieldErrors }
  | { ok: false; reason: "storage" };

type Dependencies = {
  repository: ReportRepository;
  now?: () => Date;
  generateId?: (now: Date) => string;
  /** Receives error names/codes only — never report content. */
  logError?: (message: string) => void;
};

/**
 * Validates untrusted input and persists it. All callers (server actions, future API
 * routes) go through here so validation can never be skipped.
 */
export async function submitReport(
  input: unknown,
  {
    repository,
    now = () => new Date(),
    generateId = generateReportId,
    logError = (message) => console.error(message),
  }: Dependencies,
): Promise<SubmitReportResult> {
  const parsed = reportSubmissionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation",
      fieldErrors: toFieldErrors(parsed.error.issues),
    };
  }

  const { idempotencyKey } = parsed.data;
  const content = toReportContent(parsed.data);
  const missingInformation = findMissingInformation(content);

  for (let attempt = 1; attempt <= MAX_REPORT_ID_ATTEMPTS; attempt++) {
    try {
      const result = await repository.create({
        reportId: generateId(now()),
        idempotencyKey,
        content,
        missingFields: missingInformation.map((item) => item.field),
      });
      return { ok: true, ...result, missingInformation };
    } catch (error) {
      if (error instanceof ReportIdConflictError) continue;
      logError(
        `[reports] ${repository.mode} write failed: ${describeError(error)}`,
      );
      return { ok: false, reason: "storage" };
    }
  }

  logError(
    `[reports] ${repository.mode} write failed: no free report ID after ${MAX_REPORT_ID_ATTEMPTS} attempts`,
  );
  return { ok: false, reason: "storage" };
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? `${error.name} (${code})` : error.name;
  }
  return "unknown error";
}
