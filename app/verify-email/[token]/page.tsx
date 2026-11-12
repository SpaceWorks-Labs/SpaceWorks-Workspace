import type { Metadata } from "next";
import Link from "next/link";
import { AuthFrame } from "@/components/chrome/AuthFrame";
import { VerifyEmailForm } from "@/components/auth/VerifyEmailForm";
import { Callout } from "@/components/ui/display";
import { prisma } from "@/lib/db";
import { hashEmailVerificationToken, isPlausibleVerificationToken } from "@/lib/emailVerificationToken";

export const metadata: Metadata = { title: "Confirm your email", referrer: "no-referrer" };

/** Opening the link only checks it; the button posts, so mail scanners that fetch links can't use it up. */
export default async function VerifyEmailPage({ params }: PageProps<"/verify-email/[token]">) {
  const { token } = await params;
  const valid = isPlausibleVerificationToken(token)
    && Boolean(await prisma.emailVerificationToken.findFirst({ where: { tokenHash: hashEmailVerificationToken(token), usedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } }));
  return (
    <AuthFrame centered title="Confirm your email." description={valid ? "One more step: enter your password to confirm this address and sign in." : undefined}>
      {valid ? (
        <VerifyEmailForm token={token} />
      ) : (
        <Callout tone="warning" title="This link has expired or was already used">
          <Link href="/login" className="font-semibold underline underline-offset-4">Sign in</Link> and we&apos;ll offer to send a new confirmation link.
        </Callout>
      )}
    </AuthFrame>
  );
}
