// Generated from app/verify-email/[token]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { prisma } from "@/lib/db";
import { hashEmailVerificationToken, isPlausibleVerificationToken } from "@/lib/emailVerificationToken";

export async function loadVerifyEmailPage({ params }: PageProps<"/verify-email/[token]">) {
const { token } = await params;
const valid = isPlausibleVerificationToken(token)
    && Boolean(await prisma.emailVerificationToken.findFirst({ where: { tokenHash: hashEmailVerificationToken(token), usedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } }));
return viewDto({ valid } as const);
}
