// Generated from app/w/[workspaceSlug]/settings/payments/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { liveKeysAllowed } from "@/lib/payments/credentials";
import { listAccounts } from "@/lib/payments/accounts";
import { canManageFinance, requireWorkspace } from "@/lib/permissions";
import { notFound } from "next/navigation";

export async function loadPaymentsSettingsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
const { workspaceSlug } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
if (!canManageFinance(membership)) notFound();
const accounts = await listAccounts(workspace.id);
const view = (provider: "STRIPE" | "RAZORPAY") => {
    const row = accounts.find((account) => account.provider === provider);
    return row ? { mode: row.mode, status: row.status, lastVerifiedAt: row.lastVerifiedAt, lastError: row.lastError, hasWebhookSecret: row.hasWebhookSecret, webhookUrl: row.webhookUrl } : null;
  };
const liveAllowed = liveKeysAllowed();
return viewDto({ workspace, accounts, liveAllowed } as const);
}
