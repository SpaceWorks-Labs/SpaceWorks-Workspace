import type { Metadata } from "next";
import { AuthFrame } from "@/components/chrome/AuthFrame";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <AuthFrame centered title="Reset your password." description="Enter your username or email and we'll send a link to your account's email to choose a new password.">
      <ForgotPasswordForm />
    </AuthFrame>
  );
}
