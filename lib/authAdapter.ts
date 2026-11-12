import "server-only";

import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Adapter } from "next-auth/adapters";
import { getAuthSettings } from "@/lib/authSettings";
import { prisma } from "@/lib/db";

const base = PrismaAdapter(prisma);

/**
 * Auth.js adapter. The instance is invite-only: it creates a user only when
 * the instance's self sign-up flag is on, and only from an email the provider
 * verified (lib/authOAuth.ts already refused anything else). The new user has
 * no workspace and lands on the no-workspace screen.
 */
export const authAdapter: Adapter = {
  ...base,
  async createUser(user) {
    const email = user.email?.trim().toLowerCase();
    if (!email || !(await getAuthSettings()).allowSelfSignup) throw new Error("Accounts are created by invitation only.");
    const created = await prisma.user.create({
      data: { email, name: user.name?.slice(0, 80) || null, image: user.image ?? null, emailVerified: new Date() },
      select: { id: true, email: true, name: true, image: true, emailVerified: true },
    });
    return created;
  },
  async getUserByEmail(email) {
    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { id: true, email: true, name: true, image: true, emailVerified: true },
    });
    return user ? { id: user.id, email: user.email, name: user.name, image: user.image, emailVerified: user.emailVerified } : null;
  },
  linkAccount(account) {
    // Sign-in providers are used only for identity. Do not retain reusable OAuth tokens.
    return base.linkAccount!({
      userId: account.userId,
      type: account.type,
      provider: account.provider,
      providerAccountId: account.providerAccountId,
    });
  },
};
