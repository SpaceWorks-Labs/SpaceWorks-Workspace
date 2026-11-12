import { notFound } from "next/navigation";
import { PublicShell, publicMetadata } from "@/components/campaigns/public/PublicShell";

export const metadata = { title: "Space Works", ...publicMetadata };

const COPY: Record<string, { title: string; intro: string }> = {
  subscribe: { title: "Check your inbox", intro: "If this address can be added, we've sent it an email with the next step." },
  confirmed: { title: "You're subscribed", intro: "Thanks for confirming. Every email has an unsubscribe link." },
  unsubscribed: { title: "You've been unsubscribed", intro: "You won't get these emails any more." },
  invalid: { title: "That didn't work", intro: "The link may have expired, or the form needs another go. Try again." },
};

export default async function Page({ params }: PageProps<"/m/done/[kind]">) {
  const copy = COPY[(await params).kind];
  if (!copy) notFound();
  return <PublicShell title={copy.title} intro={copy.intro} />;
}
