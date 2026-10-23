import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/field";
import {
  ageBands,
  type DateRange,
  type PublicQuery,
} from "@/lib/analytics/public-analytics";
import {
  medicalAttentionOptions,
  patientSexes,
  reactionOutcomes,
  reporterTypes,
} from "@/lib/reports/constants";

/**
 * Plain GET form: filters live in the URL, work without JavaScript and apply to every
 * chart on the page at once.
 */
export function DashboardFilters({
  query,
  coverage,
  medicineOptions,
}: {
  query: PublicQuery;
  coverage: DateRange;
  medicineOptions: string[];
}) {
  const select = (
    name: keyof PublicQuery,
    label: string,
    options: Record<string, string>,
  ) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`dashboard-${name}`}>{label}</Label>
      <Select
        id={`dashboard-${name}`}
        name={name}
        defaultValue={(query[name] as string | undefined) ?? ""}
      >
        <option value="">Any</option>
        {Object.entries(options).map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </Select>
    </div>
  );

  return (
    <Card>
      <CardContent>
        <form
          method="get"
          action="/dashboard"
          className="flex flex-col gap-4"
          role="search"
          aria-label="Filter the dashboard"
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dashboard-from">Submitted from</Label>
              <Input
                id="dashboard-from"
                name="from"
                type="date"
                min={coverage.from}
                max={coverage.to}
                defaultValue={query.from}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dashboard-to">Submitted to</Label>
              <Input
                id="dashboard-to"
                name="to"
                type="date"
                min={coverage.from}
                max={coverage.to}
                defaultValue={query.to}
              />
            </div>
            {select(
              "medicine",
              "Suspected medicine",
              Object.fromEntries(medicineOptions.map((name) => [name, name])),
            )}
            {select("reporter", "Reporter type", reporterTypes.labels)}
            {select(
              "outcome",
              "Outcome (as reported)",
              reactionOutcomes.labels,
            )}
            {select(
              "attention",
              "Medical attention",
              medicalAttentionOptions.labels,
            )}
            {select("sex", "Patient sex", patientSexes.labels)}
            {select("age", "Patient age group", ageBands)}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="serious"
                value="1"
                defaultChecked={query.serious === "1"}
                className="size-4 accent-primary"
              />
              Only reports with a reported serious event (death, admission or
              emergency visit)
            </label>
            <div className="ml-auto flex gap-2">
              <Link
                href="/dashboard"
                className={buttonVariants({ variant: "ghost", size: "sm" })}
              >
                Clear
              </Link>
              <Button type="submit" size="sm">
                Apply filters
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
