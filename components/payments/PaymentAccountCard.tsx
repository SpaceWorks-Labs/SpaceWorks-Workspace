"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { disconnectPaymentAccountAction, savePaymentAccountAction, verifyPaymentAccountAction } from "@/app/actions/payments";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Callout, Card, CardHeader, Chip } from "@/components/ui/display";
import { Field, Input, ReadOnlyValue } from "@/components/ui/field";

export type AccountCardProps = {
  slug: string;
  provider: "STRIPE" | "RAZORPAY";
  name: string;
  hint: string;
  liveAllowed: boolean;
  account: { mode: "test" | "live" | null; status: string; lastVerifiedAt: string | null; lastError: string | null; hasWebhookSecret: boolean; webhookUrl: string } | null;
};

const FIELDS: Record<AccountCardProps["provider"], Array<{ key: string; label: string; help?: string }>> = {
  STRIPE: [{ key: "secretKey", label: "Secret or restricted key", help: "Starts with sk_ or rk_. Restricted keys need Checkout Sessions and Refunds write access." }],
  RAZORPAY: [{ key: "keyId", label: "Key id", help: "Starts with rzp_test_ or rzp_live_." }, { key: "keySecret", label: "Key secret" }],
};

export function PaymentAccountCard({ slug, provider, name, hint, liveAllowed, account }: AccountCardProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [confirm, setConfirm] = useState(false);

  const run = (work: () => Promise<{ ok: boolean; error?: string; fieldErrors?: Record<string, string[]> }>, success: string, after?: () => void) =>
    start(async () => {
      const result = await work();
      setErrors(result.fieldErrors ?? {});
      if (!result.ok) return showToast(result.error ?? "Couldn't save. Try again.", "error");
      showToast(success, "success");
      after?.();
      router.refresh();
    });

  return (
    <Card as="section" className="flex flex-col gap-5">
      <CardHeader
        title={name}
        description={hint}
        action={account ? (
          <span className="flex flex-wrap items-center gap-2">
            <Chip tone={account.mode === "live" ? "warning" : "info"}>{account.mode === "live" ? "Live mode" : "Test mode"}</Chip>
            <Chip tone={account.lastVerifiedAt ? "success" : "neutral"}>{account.lastVerifiedAt ? "Verified" : "Not verified"}</Chip>
          </span>
        ) : <Chip>Not connected</Chip>}
      />
      {account?.lastError ? <Callout tone="danger" role="alert">{account.lastError}</Callout> : null}
      {!liveAllowed ? <p className="text-caption text-ink-secondary">Live keys are refused until this workspace is served over https. Test keys work now.</p> : null}
      <form
        className="grid gap-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const values = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
          run(() => savePaymentAccountAction(slug, { provider, ...values }), account ? "Payment settings saved." : `${name} connected. Verify the keys next.`, () => form.reset());
        }}
      >
        {FIELDS[provider].map((item) => (
          <Field key={item.key} label={item.label} helperText={account ? "Leave blank to keep the saved value." : item.help} error={errors[item.key]?.[0]}>
            <Input type="password" name={item.key} autoComplete="new-password" required={!account} maxLength={300} />
          </Field>
        ))}
        {account ? (
          <>
            <div className="md:col-span-2">
              <Field label="Webhook URL" helperText={`Add this as a webhook endpoint in the ${name} dashboard. It contains a private token.`}>
                <ReadOnlyValue value={<span className="select-all [overflow-wrap:anywhere]">{account.webhookUrl}</span>} action={<Button type="button" size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(account.webhookUrl).then(() => showToast("Webhook URL copied.", "success"), () => showToast("Couldn't copy. Select the text instead.", "error"))}>Copy</Button>} />
              </Field>
            </div>
            <Field label="Signing secret" helperText={account.hasWebhookSecret ? "Saved. Leave blank to keep it." : provider === "STRIPE" ? "Starts with whsec_. Shown by Stripe after you add the endpoint." : "The secret you chose for the Razorpay webhook."} error={errors.webhookSecret?.[0]}>
              <Input type="password" name="webhookSecret" autoComplete="new-password" maxLength={300} />
            </Field>
          </>
        ) : null}
        <div className="flex flex-wrap items-center gap-3 md:col-span-2">
          <Button type="submit" variant="primary" loading={pending}>{account ? "Save changes" : `Connect ${name}`}</Button>
          {account ? <Button type="button" variant="secondary" disabled={pending} onClick={() => run(() => verifyPaymentAccountAction(slug, { provider }), "Keys verified.")}>Verify keys</Button> : null}
          {account ? <Button type="button" variant="danger" disabled={pending} onClick={() => setConfirm(true)}>Disconnect…</Button> : null}
        </div>
      </form>
      <ConfirmDialog open={confirm} title={`Disconnect ${name}?`} message="Stored keys are deleted and the webhook URL stops working. Existing payment links keep working at the provider, but payments no longer update invoices." confirmLabel="Disconnect" loading={pending} onConfirm={() => run(() => disconnectPaymentAccountAction(slug, { provider }), `${name} disconnected.`, () => setConfirm(false))} onCancel={() => setConfirm(false)} />
    </Card>
  );
}
