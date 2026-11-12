"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { verifyEmail } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import { Field, PasswordInput } from "@/components/ui/field";

/** Confirming needs the sign-up password, so the same password signs the person straight in afterwards. */
export function VerifyEmailForm({ token }: { token: string }) {
  const router = useRouter();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await verifyEmail({ token, password });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const signedIn = await signIn("credentials", { identifier: result.data!.email, password, redirect: false }).catch(() => null);
      if (signedIn?.ok && !signedIn.error) {
        router.push("/");
        router.refresh();
        return;
      }
      setDone(true);
    } catch {
      setError("Couldn't confirm your email. Try again.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <Callout tone="success" role="status">Email confirmed. Sign in to continue.</Callout>
        <Button asChild variant="primary" size="lg" fullWidth><Link href="/login">Go to sign in</Link></Button>
      </div>
    );
  }
  return (
    <form className="flex flex-col gap-4" onSubmit={confirm}>
      {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
      <Field label="Password" required helperText="Enter the password you chose when you signed up. If you didn't sign up, close this page.">
        <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      </Field>
      <Button type="submit" variant="primary" size="lg" fullWidth loading={loading} disabled={!password}>Confirm and sign in</Button>
    </form>
  );
}
