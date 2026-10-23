import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  getReviewerAccess,
  getReviewerAuthMode,
} from "@/server/auth/reviewer-session";
import { AccessGate } from "../_components/access-gate";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Reviewer sign-in" };

export default function SignInPage() {
  return (
    <Suspense fallback={<Container className="py-10" aria-busy="true" />}>
      <SignIn />
    </Suspense>
  );
}

async function SignIn() {
  await connection();
  const authMode = getReviewerAuthMode();
  if (authMode.mode === "not_configured") {
    return (
      <AccessGate
        access={{ status: "not_configured", missing: authMode.missing }}
      />
    );
  }
  const access = await getReviewerAccess();

  return (
    <Container className="flex max-w-xl flex-col gap-6 py-10">
      <PageHeader
        title="Reviewer sign-in"
        description="For authorised reviewers. Reporters do not need an account."
      />
      {access.status === "authorised" ? (
        <Alert tone="success" title="You are signed in">
          <Link
            href="/reviewer"
            className={`${buttonVariants({ size: "sm" })} mt-2`}
          >
            Go to the reviewer workspace
          </Link>
        </Alert>
      ) : (
        <Card>
          <CardContent className="flex flex-col gap-4">
            {authMode.mode === "demo-code" ? (
              <Alert tone="warning" title="Demonstration access">
                This server uses a shared demo access code with the local demo
                store. It is not individual authentication and is only for
                synthetic or test data.
              </Alert>
            ) : null}
            <SignInForm mode={authMode.mode} />
          </CardContent>
        </Card>
      )}
    </Container>
  );
}
