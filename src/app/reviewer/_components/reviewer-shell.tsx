import Link from "next/link";
import { Database, LogOut, ShieldCheck } from "lucide-react";
import { Container } from "@/components/layout/container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { safetyCopy } from "@/lib/site";
import { cn } from "@/lib/utils";
import type { ReviewerAccess } from "@/server/auth/reviewer-access";
import { signOutAction } from "../actions";

type Authorised = Extract<ReviewerAccess, { status: "authorised" }>;

const tabs = [
  { href: "/reviewer", label: "Overview", key: "overview" },
  { href: "/reviewer/reports", label: "Reports", key: "reports" },
] as const;

export function ReviewerShell({
  access,
  active,
  children,
}: {
  access: Authorised;
  active: "overview" | "reports";
  children: React.ReactNode;
}) {
  return (
    <Container className="flex flex-col gap-6 py-8">
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Reviewer workspace" className="flex gap-1">
          {tabs.map((tab) => (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={active === tab.key ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active === tab.key
                  ? "bg-primary-soft text-primary-soft-foreground"
                  : "text-muted hover:bg-surface-muted hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={access.method === "supabase" ? "success" : "warning"}>
            <ShieldCheck aria-hidden="true" />
            {access.method === "supabase"
              ? "Signed in"
              : "Demo access (shared code)"}
          </Badge>
          <span className="text-muted">{access.reviewer.label}</span>
          <form action={signOutAction}>
            <Button type="submit" variant="ghost" size="sm">
              <LogOut aria-hidden="true" />
              Sign out
            </Button>
          </form>
        </div>
      </div>
      {access.repository.mode === "local-demo" ? (
        <div className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm sm:flex-row sm:items-center">
          <Badge tone="warning" className="self-start bg-surface sm:self-auto">
            <Database aria-hidden="true" />
            Demo storage
          </Badge>
          <p>
            {safetyCopy.localDemoStorage} Review status changes are saved to the
            same file on this server only.
          </p>
        </div>
      ) : null}
      {children}
    </Container>
  );
}
