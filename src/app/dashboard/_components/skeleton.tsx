export function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="h-20 animate-pulse rounded-lg bg-surface-muted" />
      <div className="h-48 animate-pulse rounded-lg bg-surface-muted" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="h-24 animate-pulse rounded-lg bg-surface-muted"
          />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-lg bg-surface-muted" />
      <p className="sr-only" role="status">
        Loading analytics
      </p>
    </div>
  );
}
