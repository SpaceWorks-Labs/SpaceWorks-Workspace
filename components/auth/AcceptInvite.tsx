"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { acceptInviteAsCurrentUser, acceptInviteWithNewAccount } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import { Field, Input, PasswordInput, ReadOnlyValue } from "@/components/ui/field";
import { SignOutButton } from "@/components/auth/SignOutButton";

type Props = {
  token: string;
  email: string;
  workspaceName: string;
  /** "signed-in-match": accept with one click; "signed-in-other": wrong account; "existing": sign in first; "new": create account. */
  mode: "signed-in-match" | "signed-in-other" | "existing" | "new";
  /** The signed-in account's email, shown when it isn't the invited one. */
  signedInAs?: string | null;
};

export function AcceptInvite({ token, email, workspaceName, mode, signedInAs = null }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(false);
  const callback = `/invite/${token}`;

  async function acceptAsCurrent() {
    setLoading(true);
    setError(null);
    try {
      const result = await acceptInviteAsCurrentUser({ token });
      if (!result.ok) setError(result.error);
      else {
        router.push(`/w/${result.data!.workspaceSlug}`);
        router.refresh();
      }
    } catch {
      setError("Couldn't accept the invitation. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function createAccount(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setFieldErrors({});
    try {
      const result = await acceptInviteWithNewAccount({ token, name, password, username: username.trim() || undefined });
      if (!result.ok) {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      const signedIn = await signIn("credentials", { identifier: email, password, redirect: false }).catch(() => null);
      router.push(signedIn && !signedIn.error ? `/w/${result.data!.workspaceSlug}` : "/login");
      router.refresh();
    } catch {
      setError("Couldn't create your account. Try again.");
    } finally {
      setLoading(false);
    }
  }

  if (mode === "signed-in-match") {
    return (
      <div className="flex flex-col gap-4">
        {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
        <Button variant="primary" size="lg" fullWidth loading={loading} onClick={acceptAsCurrent}>Join {workspaceName}</Button>
      </div>
    );
  }
  if (mode === "signed-in-other") {
    return (
      <div className="flex flex-col gap-4">
        <Callout tone="warning" title="You're signed in with a different account">
          This invitation is for {email}{signedInAs ? `, but you're signed in as ${signedInAs}` : ""}. Sign out and you&apos;ll come straight back here to continue as {email}.
        </Callout>
        <SignOutButton label="Sign out and continue" callbackUrl={`/invite/${token}`} />
      </div>
    );
  }
  if (mode === "existing") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-body-ui text-ink-secondary">There&apos;s already an account for {email}. Sign in with it and you&apos;ll come back here to join.</p>
        <Button asChild variant="primary" size="lg" fullWidth>
          <Link href={`/login?callbackUrl=${encodeURIComponent(callback)}`}>Sign in to accept</Link>
        </Button>
      </div>
    );
  }
  return (
    <form className="flex flex-col gap-4" onSubmit={createAccount}>
      {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
      <Field label="Email">
        <ReadOnlyValue value={email} />
      </Field>
      <Field label="Your name" required error={fieldErrors.name?.[0]}>
        <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} />
      </Field>
      <Field label="Username" optional helperText="An alternative to your email at sign-in." error={fieldErrors.username?.[0]}>
        <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={30} />
      </Field>
      <Field label="Choose a password" required helperText="At least 12 characters." error={fieldErrors.password?.[0]}>
        <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={12} maxLength={128} />
      </Field>
      <Button type="submit" variant="primary" size="lg" fullWidth loading={loading}>Create account and join</Button>
      <p className="text-center text-sm text-ink-muted">This invitation confirms your email, so you&apos;re signed in straight away.</p>
    </form>
  );
}
