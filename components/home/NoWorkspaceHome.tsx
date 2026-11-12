import { AuthFrame } from "@/components/chrome/AuthFrame";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { Callout } from "@/components/ui/display";
import { buttonClasses } from "@/components/ui/button";

type OrgRequest = { requestedName: string | null; decisionNote: string | null } | null;

type Props = {
  email: string;
  superAdmin: boolean;
  pendingRequest: OrgRequest;
  rejectedRequest: OrgRequest;
  /** `workspaces.requireApproval`; when false a request creates the organisation straight away. */
  requireApproval?: boolean;
};

const REQUEST_PAGE = "/account/organisations#request";

/** Signed in, but not a member of any workspace yet: what to do next, and where an organisation request stands. */
export function NoWorkspaceHome({ email, superAdmin, pendingRequest, rejectedRequest, requireApproval = true }: Props) {
  const pendingName = pendingRequest?.requestedName ?? "your organisation";
  return (
    <AuthFrame title="No workspace yet." description={`You're signed in as ${email}, but you aren't a member of any workspace.`}>
      {pendingRequest ? (
        <>
          <Callout tone="info" title="Waiting for approval">
            Your request for {pendingName} is with the instance admin. We&apos;ll email {email} when it&apos;s decided.
          </Callout>
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-body-ui text-ink-secondary">
            <li>The instance admin reviews the name, address and your reason.</li>
            <li>Once it&apos;s approved, {pendingName} opens straight from this page. You&apos;re its owner.</li>
            <li>Then invite the crew from its settings.</li>
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <a href="/account/organisations" className={buttonClasses({ variant: "primary" })}>View or edit your request</a>
            <SignOutButton />
          </div>
        </>
      ) : (
        <>
          {rejectedRequest ? (
            <Callout tone="warning" title={`Your request for ${rejectedRequest.requestedName ?? "an organisation"} was not approved`}>
              {rejectedRequest.decisionNote ? `Note from the admin: ${rejectedRequest.decisionNote} ` : ""}You can send a new request with the changes they asked for.
            </Callout>
          ) : null}
          <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-panel">
            <li className="flex flex-col gap-1 p-4">
              <h2 className="text-label text-ink">Join a workspace</h2>
              <p className="text-body-ui text-ink-secondary">Ask one of its admins to invite {email}. The link in that email brings you straight in.</p>
            </li>
            <li className="flex flex-col gap-3 p-4">
              <div className="flex flex-col gap-1">
                <h2 className="text-label text-ink">Start your own organisation</h2>
                <p className="text-body-ui text-ink-secondary">
                  {requireApproval
                    ? "Choose a name and address and say what it's for. The instance admin approves new organisations and you get an email with the decision."
                    : "Choose a name and address. It's ready straight away and you're its owner."}
                </p>
              </div>
              <a href={REQUEST_PAGE} className={buttonClasses({ variant: "primary", className: "self-start" })}>
                {rejectedRequest ? "Send a new request" : requireApproval ? "Request an organisation" : "Create an organisation"}
              </a>
            </li>
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <SignOutButton />
          </div>
        </>
      )}
      {superAdmin ? (
        <p className="text-sm text-ink-muted">
          You&apos;re the instance admin. <a href="/admin" className="font-semibold text-ink underline underline-offset-4">Open instance admin</a> to review requests and manage organisations.
        </p>
      ) : null}
    </AuthFrame>
  );
}
