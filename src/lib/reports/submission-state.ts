import type { MissingItem } from "./missing-information";
import type { FieldErrors } from "./schema";

export type StorageModeLabel = "supabase" | "local-demo";

export type SubmitReportState =
  | { status: "idle" }
  | {
      status: "success";
      reportId: string;
      submittedAt: string;
      duplicate: boolean;
      missingInformation: MissingItem[];
      storageMode: StorageModeLabel;
    }
  | { status: "invalid"; message: string; fieldErrors: FieldErrors }
  | { status: "error"; message: string };

export const initialSubmitReportState: SubmitReportState = { status: "idle" };
