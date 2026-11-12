import { emailLayout } from "./brand";
import { actionButton, escapeHtml, heading as h, paragraph as p, type RenderedEmail } from "./templates";

/** Heads-up to the super admin. The link opens the sign-in-protected queue; it carries no token. */
export function renderOrgRequestAdminEmail(input: { summary: string; requesterName: string; message?: string | null; queueUrl: string }): RenderedEmail {
  const subject = `Organisation request: ${input.summary}`;
  const reason = input.message?.trim();
  const html = emailLayout(escapeHtml(subject), [
    h("A request is waiting for you"),
    p(`<strong>${escapeHtml(input.requesterName)}</strong> asked for: ${escapeHtml(input.summary)}.`),
    reason ? p(`Their reason: ${escapeHtml(reason)}`) : "",
    actionButton(input.queueUrl, "Open the request queue"),
    p("The queue asks you to sign in and confirm two-step verification."),
  ].join(""));
  const text = `${input.requesterName} asked for: ${input.summary}.${reason ? `\n\nTheir reason: ${reason}` : ""}\n\nOpen the queue (sign-in required): ${input.queueUrl}`;
  return { subject, html, text };
}

/** To the requester right after a new-organisation request: it arrived, and what happens next. */
export function renderOrgRequestReceivedEmail(input: { summary: string; url: string }): RenderedEmail {
  const subject = `We received your request: ${input.summary}`;
  const html = emailLayout(escapeHtml(subject), [
    h("Your request is with the instance admin"),
    p(`${escapeHtml(input.summary)} is waiting for approval. We'll email you when it's decided. Once it's approved you're the owner and can invite the crew.`),
    actionButton(input.url, "View your requests"),
    p("You can change or cancel the request while it's waiting."),
  ].join(""));
  const text = `${input.summary} is waiting for approval. We'll email you when it's decided. Once it's approved you're the owner and can invite the crew.\n\nView or change your requests: ${input.url}`;
  return { subject, html, text };
}

export function renderOrgRequestDecidedEmail(input: { summary: string; approved: boolean; note?: string | null; url: string; actionLabel: string }): RenderedEmail {
  const verdict = input.approved ? "approved" : "not approved";
  const subject = `Your request was ${verdict}: ${input.summary}`;
  const note = input.note?.trim();
  const next = input.approved ? "It's ready now." : "You can send a new request with the changes the admin asked for.";
  const html = emailLayout(escapeHtml(subject), [
    h(`Your request was ${verdict}`),
    p(`${escapeHtml(input.summary)}. ${next}`),
    note ? p(`Note from the admin: ${escapeHtml(note)}`) : "",
    actionButton(input.url, input.actionLabel),
  ].join(""));
  const text = `Your request was ${verdict}: ${input.summary}. ${next}${note ? `\n\nNote from the admin: ${note}` : ""}\n\n${input.actionLabel}: ${input.url}`;
  return { subject, html, text };
}
