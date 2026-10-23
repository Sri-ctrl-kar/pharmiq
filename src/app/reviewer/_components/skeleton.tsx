import { Container } from "@/components/layout/container";

export function ReviewerSkeleton({ label }: { label: string }) {
  return (
    <Container
      className="flex flex-col gap-6 py-8"
      aria-busy="true"
      aria-label={label}
    >
      <div className="h-10 w-full animate-pulse rounded-md bg-surface-muted" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <div
            key={index}
            className="h-24 animate-pulse rounded-lg bg-surface-muted"
          />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-lg bg-surface-muted" />
      <p className="sr-only" role="status">
        {label}
      </p>
    </Container>
  );
}
