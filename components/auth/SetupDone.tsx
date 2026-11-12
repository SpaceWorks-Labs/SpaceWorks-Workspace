import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";

/** After first-run setup, for the instance admin: two-step verification first, since /admin needs it. */
export function SetupDone({ workspaceSlug, workspaceName }: { workspaceSlug: string; workspaceName: string }) {
  return (
    <div className="flex flex-col gap-4" role="status">
      <Callout tone="success" title={`${workspaceName || "Your workspace"} is ready`}>
        You&apos;re the instance admin. The admin tools ask for a code from an authenticator app, so turn on two-step verification now. It takes a minute.
      </Callout>
      <Button asChild variant="primary" size="lg" fullWidth>
        <Link href="/account#two-step">Set up two-step verification</Link>
      </Button>
      <Button asChild variant="secondary" size="lg" fullWidth>
        <Link href={`/w/${workspaceSlug}`}>Skip for now and open the workspace</Link>
      </Button>
    </div>
  );
}
