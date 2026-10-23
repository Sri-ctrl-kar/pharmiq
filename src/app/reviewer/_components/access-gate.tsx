import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import type { ReviewerAccess } from "@/server/auth/reviewer-access";

type Denied = Exclude<ReviewerAccess, { status: "authorised" }>;

/** Shown instead of any reviewer content when access is not authorised. Contains no report data. */
export function AccessGate({ access }: { access: Denied }) {
  return (
    <Container className="flex flex-col gap-6 py-10">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <LockKeyhole className="size-4" aria-hidden="true" />
            Restricted
          </span>
        }
        title="Reviewer workspace"
        description="For authorised reviewers only. Reports are not shown until access is verified on the server."
      />
      {access.status === "not_configured" ? (
        <Alert
          tone="warning"
          title="Reviewer access is not configured on this server"
        >
          <p>
            No reviewer sign-in method is set up, so the reviewer workspace is
            locked. To enable it, the server operator must configure one of:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong>Production:</strong> Supabase storage and Auth (see the
              README), and give reviewer accounts{" "}
              <code>role = &apos;reviewer&apos;</code> in{" "}
              <code>public.profiles</code>.
            </li>
            <li>
              <strong>Local demonstration only:</strong> set{" "}
              {access.missing.map((name, index) => (
                <span key={name}>
                  {index > 0 ? " and " : null}
                  <code>{name}</code>
                </span>
              ))}
              . This is a shared demo access code, not individual
              authentication.
            </li>
          </ul>
        </Alert>
      ) : null}
      {access.status === "signed_out" ? (
        <Alert tone="info" title="Sign in to continue">
          <p>You need to sign in as a reviewer to see reports.</p>
          <Link
            href="/reviewer/sign-in"
            className={`${buttonVariants({ size: "sm" })} mt-3`}
          >
            Sign in
          </Link>
        </Alert>
      ) : null}
      {access.status === "forbidden" ? (
        <Alert tone="danger" title="This account is not a reviewer">
          You are signed in, but your account does not have the reviewer role.
          Ask an administrator to grant access.
        </Alert>
      ) : null}
      {access.status === "unavailable" ? (
        <Alert tone="danger" title="Reviewer access is temporarily unavailable">
          We could not verify your access right now. Please try again shortly.
        </Alert>
      ) : null}
    </Container>
  );
}
