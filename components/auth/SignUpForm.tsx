"use client";

import { useState } from "react";
import Link from "next/link";
import { resendEmailVerification, signUpWithPassword } from "@/app/actions/auth";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import { Field, Input, PasswordInput } from "@/components/ui/field";
import type { OAuthProvider } from "@/lib/oauthLinking";

export function SignUpForm({ providers, domains }: { providers: OAuthProvider[]; domains: string[] }) {
  const [form, setForm] = useState({ name: "", email: "", username: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [resent, setResent] = useState(false);
  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm((c) => ({ ...c, [key]: event.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setFieldErrors({});
    try {
      const result = await signUpWithPassword({ ...form, username: form.username.trim() || undefined });
      if (!result.ok) {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      setSent(true);
    } catch {
      setError("Couldn't create the account. Try again.");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-4">
        <Callout tone="success" role="status" title="Check your email">
          If {form.email} can be used for a new account, a confirmation link is on its way. Open it within 1 hour and enter the password you just chose. You&apos;ll be signed in straight away.
        </Callout>
        <p className="text-sm text-ink-muted">
          {resent ? "A new link is on its way." : (
            <>No email after a few minutes? Check spam, or{" "}
              <button type="button" className="font-semibold text-ink underline underline-offset-4" onClick={() => { setResent(true); void resendEmailVerification({ identifier: form.email }); }}>send it again</button>.
            </>
          )}
        </p>
        <Link href="/login" className="text-sm font-semibold text-ink underline underline-offset-4">Back to sign in</Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
      <OAuthButtons providers={providers} callbackUrl="/" onError={setError} busy={loading} />
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <Field label="Your name" required error={fieldErrors.name?.[0]}>
          <Input value={form.name} onChange={update("name")} autoComplete="name" maxLength={80} />
        </Field>
        <Field label="Email" required helperText={domains.length ? `Open to ${domains.map((d) => `@${d}`).join(", ")}.` : undefined} error={fieldErrors.email?.[0]}>
          <Input type="email" value={form.email} onChange={update("email")} autoComplete="email" />
        </Field>
        <Field label="Username" optional helperText="An alternative to your email at sign-in." error={fieldErrors.username?.[0]}>
          <Input value={form.username} onChange={update("username")} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={30} />
        </Field>
        <Field label="Password" required helperText="At least 12 characters." error={fieldErrors.password?.[0]}>
          <PasswordInput value={form.password} onChange={update("password")} autoComplete="new-password" minLength={12} maxLength={128} />
        </Field>
        <Button type="submit" variant="primary" size="lg" fullWidth loading={loading}>Create account</Button>
      </form>
      <Link href="/login" className="self-center text-sm text-ink-secondary underline-offset-4 hover:underline">Already have an account? Sign in</Link>
    </div>
  );
}
