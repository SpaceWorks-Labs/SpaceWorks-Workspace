import { OrgDefaultsForm } from "@/components/admin/orgs/OrgDefaultsForm";
import { InstanceSettingsForm } from "@/components/admin/InstanceSettingsForm";
import { PageHeader } from "@/components/ui/display";
import { getInstanceSettingsForDisplay } from "@/lib/instanceSettings";
import { requireSuperAdminMfa } from "@/lib/permissions";

/** Organisation defaults have their own form so the two never overwrite each other. */
const isOrgDefaultKey = (key: string) => key.startsWith("limits.") || key === "modules.disabledByDefault" || key === "workspaces.requireApproval";

export const metadata = { title: "Instance settings" };

export default async function AdminSettingsPage() {
  await requireSuperAdminMfa();
  const settings = await getInstanceSettingsForDisplay();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Instance settings" description="Saved values override environment variables. Secrets are encrypted and never shown again." />
      <InstanceSettingsForm settings={settings.filter(({ key }) => !isOrgDefaultKey(key)).map(({ key, secret, value, isSet, source }) => ({ key, secret, value, isSet, source }))} />
      <OrgDefaultsForm values={Object.fromEntries(settings.filter(({ key }) => isOrgDefaultKey(key)).map(({ key, value }) => [key, value ?? ""]))} />
    </div>
  );
}
