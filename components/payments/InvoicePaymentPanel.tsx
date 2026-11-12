"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createInvoicePaymentLinkAction, refundInvoicePaymentAction } from "@/app/actions/payments";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Card, CardHeader, Chip, type ChipTone } from "@/components/ui/display";
import { Dropdown, Field, Input } from "@/components/ui/field";
import { formatMoney, parseMoneyToMinor } from "@/lib/format/money";
import type { InvoicePaymentView } from "@/lib/payments/links";

type Provider = "STRIPE" | "RAZORPAY";
const NAME: Record<Provider, string> = { STRIPE: "Stripe", RAZORPAY: "Razorpay" };
const STATUS: Record<string, { label: string; tone: ChipTone }> = {
  CREATED: { label: "Awaiting payment", tone: "info" },
  PAID: { label: "Paid", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  EXPIRED: { label: "Link expired", tone: "neutral" },
  REFUNDED: { label: "Refunded", tone: "neutral" },
  PARTIALLY_REFUNDED: { label: "Partly refunded", tone: "warning" },
  NEEDS_REVIEW: { label: "Needs review", tone: "warning" },
};

export function InvoicePaymentPanel({ slug, invoiceId, invoiceStatus, providers, payments }: { slug: string; invoiceId: string; invoiceStatus: string; providers: Provider[]; payments: InvoicePaymentView[] }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, start] = useTransition();
  const [provider, setProvider] = useState<Provider>(providers[0] ?? "STRIPE");
  const [refunding, setRefunding] = useState<InvoicePaymentView | null>(null);
  const [amount, setAmount] = useState("");
  const canCreate = invoiceStatus === "SENT" && providers.length > 0;
  if (!canCreate && payments.length === 0) return null;

  const run = (work: () => Promise<{ ok: boolean; error?: string }>, success: string, after?: () => void) =>
    start(async () => {
      const result = await work();
      if (!result.ok) return showToast(result.error ?? "Couldn't complete that. Refresh the page and try again.", "error");
      showToast(success, "success");
      after?.();
      router.refresh();
    });
  const copy = (url: string) => navigator.clipboard.writeText(url).then(() => showToast("Payment link copied.", "success"), () => showToast("Couldn't copy. Open the link and copy it from there.", "error"));
  const remaining = refunding ? refunding.amountMinor - refunding.refundedMinor : 0;
  const parsed = amount.trim() ? parseMoneyToMinor(amount, refunding?.currency) : remaining;

  return (
    <Card as="section" className="flex flex-col gap-4 print:hidden">
      <CardHeader title="Online payment" description="A hosted payment link from your connected provider. The invoice is marked paid automatically once the provider confirms." />
      {canCreate ? (
        <div className="flex flex-wrap items-end gap-3">
          {providers.length > 1 ? (
            <Field label="Provider"><Dropdown value={provider} onChange={(event) => setProvider(event.target.value as Provider)}>{providers.map((item) => <option key={item} value={item}>{NAME[item]}</option>)}</Dropdown></Field>
          ) : null}
          <Button variant="primary" loading={pending && !refunding} onClick={() => run(() => createInvoicePaymentLinkAction(slug, { invoiceId, provider }), "Payment link ready.")}>Create payment link</Button>
        </div>
      ) : null}
      <ul className="flex flex-col divide-y divide-line">
        {payments.map((payment) => {
          const status = STATUS[payment.status] ?? { label: payment.status, tone: "neutral" as ChipTone };
          return (
            <li key={payment.id} className="flex flex-col gap-2 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={status.tone}>{status.label}</Chip>
                <span className="text-body-ui">{NAME[payment.provider]} · {formatMoney(payment.amountMinor, payment.currency)}</span>
                {payment.refundedMinor > 0 ? <span className="text-caption text-ink-secondary">Refunded {formatMoney(payment.refundedMinor, payment.currency)}</span> : null}
              </div>
              {payment.lastError ? <p className="text-caption text-ink-secondary">{payment.lastError}</p> : null}
              {payment.status === "NEEDS_REVIEW" ? <p className="text-caption text-ink-secondary">Money arrived but the invoice was not changed. Check it against your {NAME[payment.provider]} dashboard.</p> : null}
              <div className="flex flex-wrap gap-2">
                {payment.url ? <Button size="sm" variant="secondary" onClick={() => copy(payment.url!)}>Copy link</Button> : null}
                {["PAID", "PARTIALLY_REFUNDED"].includes(payment.status) ? <Button size="sm" variant="danger" onClick={() => { setAmount(""); setRefunding(payment); }}>Refund…</Button> : null}
              </div>
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={Boolean(refunding)}
        title="Refund this payment?"
        message={`The provider returns the money to the client. The invoice and ledger are not changed; void the invoice yourself if it no longer stands. Up to ${refunding ? formatMoney(remaining, refunding.currency) : ""} can be refunded.`}
        confirmLabel="Refund"
        loading={pending}
        onConfirm={() => {
          if (!refunding) return;
          if (parsed === null || parsed < 1 || parsed > remaining) return showToast("Enter a valid refund amount.", "error");
          run(() => refundInvoicePaymentAction(slug, { paymentId: refunding.id, amountMinor: parsed }), "Refund requested. The status updates when the provider confirms.", () => setRefunding(null));
        }}
        onCancel={() => setRefunding(null)}
      >
        <Field label="Amount" optional helperText="Leave blank to refund everything that remains."><Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
      </ConfirmDialog>
    </Card>
  );
}
