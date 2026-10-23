import "server-only";

import {
  medicineOptionsOf,
  toPublicRecord,
  type DateRange,
  type PublicRecord,
} from "@/lib/analytics/public-analytics";
import { generateSyntheticReports } from "@/server/reports/demo-seed";

/**
 * The dataset behind the public dashboard: a fixed, versioned set of SYNTHETIC records
 * produced by the same deterministic generator as the demo seed data.
 *
 * It is deliberately independent of report storage. Reports submitted through the form
 * (local demo store or Supabase) are never read here, so they cannot reach public
 * charts, and the public page adds no read path into report storage. Records are reduced
 * to `PublicRecord` before leaving this module.
 */

export const PUBLIC_DATASET_VERSION = "2026.1";
const GENERATOR = {
  count: 300,
  seed: 51_2026,
  firstIndex: 1000,
  start: "2025-11-01",
  end: "2026-10-19",
} as const;

export type PublicDataset = {
  name: string;
  version: string;
  source: "synthetic";
  records: PublicRecord[];
  coverage: DateRange;
  medicineOptions: string[];
};

let cached: PublicDataset | null = null;

export function getPublicDataset(): PublicDataset {
  if (cached) return cached;
  const records = generateSyntheticReports(GENERATOR.count, GENERATOR).map(
    toPublicRecord,
  );
  const days = records.map((record) => record.submittedOn).sort();
  cached = {
    name: "ADR Connect India synthetic demonstration dataset",
    version: PUBLIC_DATASET_VERSION,
    source: "synthetic",
    records,
    coverage: { from: days[0], to: days[days.length - 1] },
    medicineOptions: medicineOptionsOf(records),
  };
  return cached;
}
