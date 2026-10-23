import type { CountItem } from "@/lib/review/analytics";

/**
 * Single-series charts drawn with HTML: one data colour, value labels on the bar ends,
 * native hover titles, and a table view for screen readers and exact values.
 */

function TableView({
  items,
  caption,
  valueLabel,
}: {
  items: CountItem[];
  caption: string;
  valueLabel: string;
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
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.key} className="border-b border-border/60">
              <td className="py-1">{item.label}</td>
              <td className="py-1 text-right tabular-nums">{item.count}</td>
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
}: {
  items: CountItem[];
  caption: string;
}) {
  const max = Math.max(1, ...items.map((item) => item.count));
  return (
    <figure>
      <div
        className="flex h-44 items-end gap-2 border-b border-chart-grid px-1 sm:gap-4"
        aria-hidden="true"
      >
        {items.map((item) => (
          <div
            key={item.key}
            className="flex h-full flex-1 flex-col items-center justify-end gap-1"
            title={`${item.label}: ${item.count} reports`}
          >
            <span className="text-xs font-medium text-foreground tabular-nums">
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
      <div className="flex gap-2 px-1 pt-1.5 sm:gap-4" aria-hidden="true">
        {items.map((item) => (
          <span
            key={item.key}
            className="flex-1 text-center text-xs text-muted"
          >
            {item.label.split(" ")[0]}
          </span>
        ))}
      </div>
      <figcaption className="sr-only">{caption}</figcaption>
      <TableView items={items} caption={caption} valueLabel="Reports" />
    </figure>
  );
}

export function CountBars({
  items,
  caption,
  emptyText = "No data for this selection.",
}: {
  items: CountItem[];
  caption: string;
  emptyText?: string;
}) {
  if (items.every((item) => item.count === 0)) {
    return <p className="text-sm text-muted">{emptyText}</p>;
  }
  const max = Math.max(1, ...items.map((item) => item.count));
  return (
    <figure>
      <ul className="flex flex-col gap-2" aria-hidden="true">
        {items.map((item) => (
          <li
            key={item.key}
            className="grid grid-cols-[minmax(0,11rem)_1fr] items-center gap-3 text-sm"
            title={`${item.label}: ${item.count}`}
          >
            <span className="leading-snug break-words text-foreground/90">
              {item.label}
            </span>
            <span className="flex items-center gap-2">
              <span
                className="h-3 rounded-r bg-chart-bar"
                style={{
                  width: `${(item.count / max) * 85}%`,
                  minWidth: item.count > 0 ? 2 : 0,
                }}
              />
              <span className="text-xs font-medium tabular-nums">
                {item.count}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <figcaption className="sr-only">{caption}</figcaption>
      <TableView items={items} caption={caption} valueLabel="Reports" />
    </figure>
  );
}
