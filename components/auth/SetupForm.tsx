"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { completeSetup } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import { SetupDone } from "@/components/auth/SetupDone";
import { Field, Input, PasswordInput, PrefixInput } from "@/components/ui/field";
import { slugify } from "@/lib/slug";

/** `adminEmailConfigured`: SUPER_ADMIN_EMAIL is set, so the form says which address gets the instance admin tools. */
export function SetupForm({ defaultTimeZone, adminEmailConfigured = false }: { defaultTimeZone: string; adminEmailConfigured?: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", username: "", password: "", workspaceName: "", workspaceSlug: "" });
  const [slugEdited, setSlugEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<{ workspaceSlug: string; superAdmin: boolean } | null>(null);

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setForm((current) => ({
      ...current,
      [key]: value,
      ...(key === "workspaceName" && !slugEdited ? { workspaceSlug: slugify(value, "") } : {}),
    }));
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setFieldErrors({});
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || defaultTimeZone;
      const result = await completeSetup({ ...form, username: form.username.trim() || undefined, timezone });
      if (!result.ok) {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      const signedIn = await signIn("credentials", { identifier: form.email, password: form.password, redirect: false }).catch(() => null);
      if (!signedIn?.ok || signedIn.error) {
        router.push("/login");
        return;
      }
      // The instance admin is asked to turn on two-step verification first. No refresh here:
      // /setup is closed now and would redirect away from this message.
      if (result.data!.superAdmin) {
        setDone(result.data!);
        return;
      }
      router.push(`/w/${result.data!.workspaceSlug}`);
      router.refresh();
    } catch {
      setError("Couldn't finish setup. Try again.");
    } finally {
      setLoading(false);
    }
  }

  if (done) return <SetupDone workspaceSlug={done.workspaceSlug} workspaceName={form.workspaceName.trim()} />;
  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
      <p className="text-overline text-ink-muted">Your account</p>
      <Field label="Your name" required error={fieldErrors.name?.[0]}>
        <Input value={form.name} onChange={update("name")} autoComplete="name" maxLength={80} />
      </Field>
      <Field label="Email" required helperText={adminEmailConfigured ? "Use the instance admin address (SUPER_ADMIN_EMAIL) to manage organisations and settings for the whole instance." : undefined} error={fieldErrors.email?.[0]}>
        <Input type="email" value={form.email} onChange={update("email")} autoComplete="email" />
      </Field>
      <Field label="Username" optional helperText="Lowercase letters, numbers, dots, dashes. An alternative to your email at sign-in." error={fieldErrors.username?.[0]}>
        <Input value={form.username} onChange={update("username")} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={30} />
      </Field>
      <Field label="Password" required helperText="At least 12 characters." error={fieldErrors.password?.[0]}>
        <PasswordInput value={form.password} onChange={update("password")} autoComplete="new-password" minLength={12} maxLength={128} />
      </Field>
      <p className="mt-2 text-overline text-ink-muted">Your community</p>
      <Field label="Workspace name" required helperText="Usually the community's name, e.g. TinkerSpace Kochi." error={fieldErrors.workspaceName?.[0]}>
        <Input value={form.workspaceName} onChange={update("workspaceName")} maxLength={80} />
      </Field>
      <Field label="Workspace address" required error={fieldErrors.workspaceSlug?.[0]}>
        <PrefixInput
          prefix="/w/"
          value={form.workspaceSlug}
          onChange={(event) => {
            setSlugEdited(true);
            setForm((current) => ({ ...current, workspaceSlug: event.target.value.toLowerCase() }));
          }}
          maxLength={60}
        />
      </Field>
      <Button type="submit" variant="primary" size="lg" fullWidth loading={loading} className="mt-1">Create workspace</Button>
    </form>
  );
}
