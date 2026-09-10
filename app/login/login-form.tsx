"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button, ErrorNote, Field, Input } from "@/components/ui";

import { signIn, type SignInState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending} className="mt-1 w-full">
      {pending ? "Signing in…" : "Sign in"}
    </Button>
  );
}

export function LoginForm() {
  const [state, formAction] = useActionState<SignInState, FormData>(signIn, {
    error: null,
  });

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Field label="Email">
        <Input
          name="email"
          type="email"
          autoComplete="username"
          autoFocus
          required
          placeholder="you@zeroinfy.in"
        />
      </Field>

      <Field label="Password">
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>

      {state.error ? <ErrorNote>{state.error}</ErrorNote> : null}

      <SubmitButton />
    </form>
  );
}
