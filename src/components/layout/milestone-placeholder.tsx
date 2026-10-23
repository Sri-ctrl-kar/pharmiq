import Link from "next/link";
import { Construction } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Container } from "./container";
import { PageHeader } from "./page-header";

type MilestonePlaceholderProps = {
  title: string;
  description: string;
  milestone: string;
  children?: React.ReactNode;
};

/** Honest placeholder for routes that are planned but not yet built. */
export function MilestonePlaceholder({
  title,
  description,
  milestone,
  children,
}: MilestonePlaceholderProps) {
  return (
    <Container className="flex flex-col gap-8 py-10">
      <PageHeader title={title} description={description} />
      {children}
      <Card>
        <CardContent className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-muted text-muted">
            <Construction className="size-5" aria-hidden="true" />
          </span>
          <div className="flex-1">
            <p className="font-medium">Not available yet</p>
            <p className="text-sm text-muted">
              This section is planned for {milestone} and is not functional in
              this build.
            </p>
          </div>
          <Link href="/" className={buttonVariants({ variant: "secondary" })}>
            Back to home
          </Link>
        </CardContent>
      </Card>
    </Container>
  );
}
