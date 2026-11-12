"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

/** `callbackUrl`: where to land after signing out (an app path), e.g. back on an invitation. */
export function SignOutButton({ label = "Sign out", callbackUrl = "/login" }: { label?: string; callbackUrl?: string }) {
  return <Button variant="secondary" onClick={() => void signOut({ callbackUrl })}>{label}</Button>;
}
