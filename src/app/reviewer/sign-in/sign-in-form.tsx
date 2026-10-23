"use client";

import { useActionState } from "react";
import { Loader2, LogIn } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { signInAction, type SignInState } from "../actions";

export function SignInForm({ mode }: { mode: "supabase" | "demo-code" }) {
  const [state, formAction, pending] = useActionState<SignInState, FormData>(
    async (previous, formData) => {
      try {
        return await signInAction(previous, formData);
      } catch (error) {
        // redirect() after a successful sign-in is delivered as a thrown navigation.
        if (error && typeof error === "object" && "digest" in error)
          throw error;
        return {
          message:
            "Could not reach the server. Check your connection and try again.",
        };
      }
    },
    { message: null },
  );

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4"
      aria-busy={pending}
    >
      {state.message ? (
        <Alert tone="danger" title="Not signed in">
          {state.message}
        </Alert>
      ) : null}
      {mode === "supabase" ? (
        <>
          <Field id="email" label="Email address" required>
            {(props) => (
              <Input
                {...props}
                name="email"
                type="email"
                autoComplete="username"
              />
            )}
          </Field>
          <Field id="password" label="Password" required>
            {(props) => (
              <Input
                {...props}
                name="password"
                type="password"
                autoComplete="current-password"
              />
            )}
          </Field>
        </>
      ) : (
        <Field
          id="accessCode"
          label="Demo access code"
          required
          hint="Provided by whoever runs this demonstration."
        >
          {(props) => (
            <Input
              {...props}
              name="accessCode"
              type="password"
              autoComplete="off"
            />
          )}
        </Field>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <LogIn aria-hidden="true" />
        )}
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
