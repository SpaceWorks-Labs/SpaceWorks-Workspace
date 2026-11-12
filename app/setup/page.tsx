import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/chrome/AuthFrame";
import { SetupForm } from "@/components/auth/SetupForm";
import { isSetupOpen } from "@/lib/setup";

export const metadata: Metadata = { title: "Set up Space Works" };

/** First run only: disappears (redirects to /login) once any account exists. */
export default async function SetupPage() {
  if (!(await isSetupOpen())) redirect("/login");
  return (
    <AuthFrame title="Set up your workspace." description="Create the first account and your community's workspace. This account owns the workspace; you can invite the crew next." accent={"Start the\nbuild."}>
      <SetupForm defaultTimeZone="Asia/Kolkata" adminEmailConfigured={Boolean(process.env.SUPER_ADMIN_EMAIL?.trim())} />
    </AuthFrame>
  );
}
