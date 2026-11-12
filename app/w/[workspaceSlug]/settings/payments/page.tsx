import { PaymentAccountCard } from "@/components/payments/PaymentAccountCard";
import { PageHeader } from "@/components/ui/display";
import { liveKeysAllowed } from "@/lib/payments/credentials";
import { listAccounts } from "@/lib/payments/accounts";
import { canManageFinance, requireWorkspace } from "@/lib/permissions";
import { notFound } from "next/navigation";

export const metadata = { title: "Payments" };

export default async function PaymentsSettingsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
  if (!canManageFinance(membership)) notFound();
  const accounts = await listAccounts(workspace.id);
  const view = (provider: "STRIPE" | "RAZORPAY") => {
    const row = accounts.find((account) => account.provider === provider);
    return row ? { mode: row.mode, status: row.status, lastVerifiedAt: row.lastVerifiedAt, lastError: row.lastError, hasWebhookSecret: row.hasWebhookSecret, webhookUrl: row.webhookUrl } : null;
  };
  const liveAllowed = liveKeysAllowed();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Payments" description="Let clients pay invoices online through your own Stripe or Razorpay account. Space Works creates a hosted payment link; the provider handles the card details." />
      <PaymentAccountCard slug={workspace.slug} provider="STRIPE" name="Stripe" hint="Card payments in most currencies." liveAllowed={liveAllowed} account={view("STRIPE")} />
      <PaymentAccountCard slug={workspace.slug} provider="RAZORPAY" name="Razorpay" hint="UPI, cards and netbanking for invoices in INR." liveAllowed={liveAllowed} account={view("RAZORPAY")} />
    </div>
  );
}
