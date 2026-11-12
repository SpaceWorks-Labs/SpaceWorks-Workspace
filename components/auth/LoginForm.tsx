"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn, signOut } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import { Field, Input, PasswordInput } from "@/components/ui/field";
import { resendEmailVerification } from "@/app/actions/auth";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import { safeAuthRedirect } from "@/lib/authRedirect";
import { OAUTH_ERROR_MESSAGES, type OAuthProvider } from "@/lib/oauthLinking";

type Props = {
  providers: OAuthProvider[];
  oidcProviders?: { id: string; name: string }[];
  ssoMfa?: boolean;
  allowSignup?: boolean;
  /** Pre-filled username or email, e.g. the invited address when signing in to accept an invitation. */
  defaultIdentifier?: string;
};

const SIGN_IN_ERRORS: Record<string, string> = {
  account_disabled: "This account is switched off. Ask the instance admin to turn it back on.",
  rate_limited: "Too many sign-in attempts. Wait a few minutes, then try again.",
};

export function LoginForm({ providers, oidcProviders = [], ssoMfa = false, allowSignup = false, defaultIdentifier = "" }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = safeAuthRedirect(params.get("callbackUrl"));
  const [identifier, setIdentifier] = useState(defaultIdentifier);
  const [unverified, setUnverified] = useState(false);
  const [resent, setResent] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [mfaStep, setMfaStep] = useState(ssoMfa);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(() => {
    const value = params.get("error");
    if (!value) return null;
    return OAUTH_ERROR_MESSAGES[value] ?? "Sign-in couldn't be completed. Try again.";
  });
  const resetDone = params.get("reset") === "1";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setUnverified(false);
    setLoading("credentials");
    try {
      const result = await signIn(ssoMfa ? "sso-mfa" : "credentials", { identifier, password, totp: mfaStep ? code : undefined, redirect: false });
      if (!result || result.error) {
        if (result?.code === "mfa_required") {
          setMfaStep(true);
        } else if (result?.code === "email_not_verified") {
          setUnverified(true);
          setResent(false);
        } else if (result?.code && SIGN_IN_ERRORS[result.code]) {
          setError(SIGN_IN_ERRORS[result.code]!);
        } else {
          setError(mfaStep ? "That code didn't work. Check your authenticator app or use a recovery code." : "Wrong username, email or password. Try again or reset your password.");
        }
        return;
      }
      router.push(callbackUrl);
      router.refresh();
    } catch {
      // Also reached when the sign-in endpoint itself is rate limited.
      setError("Couldn't sign you in just now. Wait a minute, then try again.");
    } finally {
      setLoading(null);
    }
  }

  if (mfaStep) {
    return (
      <form className="flex flex-col gap-5" onSubmit={submit}>
        <div className="flex flex-col gap-1.5">
          <h2 className="text-h3 text-ink">Two-step verification</h2>
          <p className="text-body-ui text-ink-secondary">Enter the six-digit code from your authenticator app, or one of your recovery codes.</p>
        </div>
        {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
        <Field label="Verification code" required>
          <Input autoFocus value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" inputMode="text" maxLength={32} />
        </Field>
        <Button type="submit" variant="primary" size="lg" fullWidth loading={loading === "credentials"}>Verify and sign in</Button>
        <Button
          variant="quiet"
          className="self-center"
          onClick={() => {
            if (ssoMfa) { void signOut({ callbackUrl: "/login" }); return; }
            setMfaStep(false);
            setCode("");
            setError(null);
          }}
        >
          Use a different account
        </Button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {resetDone ? <Callout tone="success" role="status">Password updated. Sign in with your new password.</Callout> : null}
      {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
      {unverified ? (
        <Callout tone="warning" role="alert" title="Confirm your email first">
          {resent ? (
            "If that account needs confirming, a new link is on its way. It expires in 1 hour."
          ) : (
            <>
              We sent a confirmation link when the account was created.{" "}
              <button type="button" className="font-semibold underline underline-offset-4" onClick={() => { setResent(true); void resendEmailVerification({ identifier }); }}>Send it again</button>
            </>
          )}
        </Callout>
      ) : null}
      <OAuthButtons providers={providers} oidcProviders={oidcProviders} callbackUrl={callbackUrl} onError={setError} busy={loading !== null} />
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <Field label="Username or email" required>
          <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={254} />
        </Field>
        <div className="relative">
          <Field label="Password" required>
            <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoFocus={Boolean(defaultIdentifier)} autoComplete="current-password" maxLength={128} />
          </Field>
          <Link href="/forgot-password" className="absolute right-0 top-0 text-sm font-semibold text-ink-secondary underline underline-offset-4 hover:text-ink">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" variant="primary" size="lg" fullWidth loading={loading === "credentials"} className="mt-1">Sign in</Button>
      </form>
      {allowSignup ? (
        <p className="text-center text-sm text-ink-muted">New here? <Link href="/signup" className="font-semibold text-ink underline underline-offset-4">Create an account</Link></p>
      ) : (
        <p className="text-center text-sm text-ink-muted">Space Works is invite-only. Ask a workspace admin for an invitation.</p>
      )}
    </div>
  );
}
