import Link from "next/link";
import { Card, CardHeader, PageHeader, Callout } from "@/components/ui/display";
import { OidcForm } from "@/components/importer/SettingsForms";
import { requireSuperAdminMfa } from "@/lib/permissions";
import { prisma } from "@/lib/db";
export const metadata = { title: "Single sign-on" };
export default async function SsoPage() {
  await requireSuperAdminMfa();
  const providers = await prisma.ssoProvider.findMany({
    where: { workspaceId: null },
    select: {
      id: true,
      name: true,
      issuer: true,
      clientId: true,
      allowedDomains: true,
      enabled: true,
    },
    orderBy: { createdAt: "asc" },
  });
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Single sign-on"
        description="OpenID Connect for existing, active invited members. New accounts are never created through SSO."
      />
      <Callout tone="info" title="OpenID Connect is live">
        Enabled providers appear as &ldquo;Continue with&rdquo; buttons on the
        sign-in page. Google, GitHub and Apple are configured on the{" "}
        <Link className="font-semibold underline underline-offset-4" href="/admin/sign-in">Sign-in</Link> tab.
      </Callout>
      <Link
        className="inline-flex min-h-11 items-center underline"
        href="/admin/backups"
      >
        Backups posture
      </Link>
      {providers.map((p) => (
        <Card key={p.id}>
          <CardHeader
            title={p.name}
            description={`Callback path: /api/auth/callback/oidc-${p.id}`}
          />
          <OidcForm provider={p} />
        </Card>
      ))}
      <Card>
        <CardHeader
          title="Add an OIDC provider"
          description="The issuer must provide discovery, PKCE and verified email claims. Configure the callback path shown after saving."
        />
        <OidcForm />
      </Card>
    </div>
  );
}
