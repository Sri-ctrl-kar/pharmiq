import type { CountItem } from "@/lib/review/analytics";

/**
 * Single-series charts drawn with HTML: one data colour, value labels on the bar ends,
 * native hover titles, and a table view for screen readers and exact values.
 */

type ChartOptions = {
  caption: string;
  /** Unit shown in the key and the table header, e.g. "Reports". */
  valueLabel?: string;
  /** Show a key naming what the bars measure. */
  legend?: string;
  /** When set, values are also shown as a percentage of this total. */
  percentOf?: number;
};

const percent = (count: number, total?: number) =>
  total ? `${Math.round((count / total) * 100)}%` : null;

function Legend({ text }: { text: string }) {
  return (
    <p className="mb-3 flex items-center gap-2 text-xs text-muted">
      <span className="size-2.5 rounded-sm bg-chart-bar" aria-hidden="true" />
      {text}
    </p>
  );
}

function TableView({
  items,
  caption,
  valueLabel,
  percentOf,
}: {
  items: CountItem[];
  caption: string;
  valueLabel: string;
  percentOf?: number;
}) {
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-muted hover:text-foreground">
        View as table
      </summary>
      <table className="mt-2 w-full text-left">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border text-xs text-muted">
            <th scope="col" className="py-1 font-medium">
              Category
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              {valueLabel}
            </th>
            {percentOf ? (
              <th scope="col" className="py-1 text-right font-medium">
                % of reports
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.key} className="border-b border-border/60">
              <td className="py-1">{item.label}</td>
              <td className="py-1 text-right tabular-nums">{item.count}</td>
              {percentOf ? (
                <td className="py-1 text-right tabular-nums">
                  {percent(item.count, percentOf)}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export function ColumnChart({
  items,
  caption,
  valueLabel = "Reports",
  legend,
  emptyText = "No data for this selection.",
}: ChartOptions & { items: CountItem[]; emptyText?: string }) {
  if (items.length === 0 || items.every((item) => item.count === 0)) {
    return <p className="text-sm text-muted">{emptyText}</p>;
  }
  const max = Math.max(1, ...items.map((item) => item.count));
  // With many columns, label every other one on small screens so labels never collide.
  const dense = items.length > 8;
  return (
    <figure>
      {legend ? <Legend text={legend} /> : null}
      <div
        className={`flex h-44 items-end border-b border-chart-grid px-1 ${dense ? "gap-1 sm:gap-2" : "gap-2 sm:gap-4"}`}
        aria-hidden="true"
      >
        {items.map((item) => (
          <div
            key={item.key}
            className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
            title={`${item.label}: ${item.count} ${valueLabel.toLowerCase()}`}
          >
            <span
              className={`font-medium text-foreground tabular-nums ${dense ? "text-[0.625rem] sm:text-xs" : "text-xs"}`}
            >
              {item.count}
            </span>
            <div
              className="w-full max-w-6 rounded-t bg-chart-bar"
              style={{
                height: `${(item.count / max) * 100}%`,
                minHeight: item.count > 0 ? 2 : 0,
              }}
            />
          </div>
        ))}
      </div>
      <div
        className={`flex px-1 pt-1.5 ${dense ? "gap-1 sm:gap-2" : "gap-2 sm:gap-4"}`}
        aria-hidden="true"
      >
        {items.map((item, index) => (
          <span
            key={item.key}
            className={`min-w-0 flex-1 text-center text-xs whitespace-nowrap text-muted ${dense && index % 2 === 1 ? "max-sm:invisible" : ""}`}
          >
            {item.shortLabel ?? item.label.split(" ")[0]}
          </span>
        ))}
      </div>
      <figcaption className="sr-only">{caption}</figcaption>
      <TableView items={items} caption={caption} valueLabel={valueLabel} />
    </figure>
  );
}

export function CountBars({
  items,
  caption,
  valueLabel = "Reports",
  legend,
  percentOf,
  emptyText = "No data for this selection.",
}: ChartOptions & { items: CountItem[]; emptyText?: string }) {
  if (items.every((item) => item.count === 0)) {
    return <p className="text-sm text-muted">{emptyText}</p>;
  }
  const max = Math.max(1, ...items.map((item) => item.count));
  return (
    <figure>
      {legend ? <Legend text={legend} /> : null}
      <ul className="flex flex-col gap-2" aria-hidden="true">
        {items.map((item) => (
          <li
            key={item.key}
            className="grid grid-cols-[minmax(0,11rem)_1fr] items-center gap-3 text-sm"
            title={`${item.label}: ${item.count}${percentOf ? ` (${percent(item.count, percentOf)})` : ""}`}
          >
            <span className="leading-snug break-words text-foreground/90">
              {item.label}
            </span>
            <span className="flex items-center gap-2">
              <span
                className="h-3 rounded-r bg-chart-bar"
                style={{
                  width: `${(item.count / max) * (percentOf ? 70 : 85)}%`,
                  minWidth: item.count > 0 ? 2 : 0,
                }}
              />
              <span className="text-xs font-medium whitespace-nowrap tabular-nums">
                {item.count}
                {percentOf ? (
                  <span className="font-normal text-muted">
                    {" "}
                    · {percent(item.count, percentOf)}
                  </span>
                ) : null}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <figcaption className="sr-only">{caption}</figcaption>
      <TableView
        items={items}
        caption={caption}
        valueLabel={valueLabel}
        percentOf={percentOf}
      />
    </figure>
  );
}
