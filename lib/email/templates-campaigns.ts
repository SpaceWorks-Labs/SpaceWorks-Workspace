import { EMAIL_BUTTON_STYLE, EMAIL_COLORS, emailLayout } from "./brand";
import { escapeHtml, type RenderedEmail } from "./templates";

const p = (text: string) => `<p style="font-size:16px;line-height:1.5;color:${EMAIL_COLORS.inkMuted};margin:0 0 16px">${text}</p>`;

/** Double opt-in confirmation. The link only opens a button page; confirming needs a POST. */
export function renderSubscriptionConfirmationEmail(input: { workspaceName: string; listName: string; confirmUrl: string }): RenderedEmail {
  const subject = `Confirm your subscription to ${input.listName}`;
  const url = escapeHtml(input.confirmUrl);
  const html = emailLayout(escapeHtml(subject), [
    `<h2 style="margin-top:0;color:${EMAIL_COLORS.ink};font-size:20px;font-weight:600">Confirm your subscription</h2>`,
    p(`Someone asked to add this address to <strong>${escapeHtml(input.listName)}</strong> from ${escapeHtml(input.workspaceName)}. Confirm that it was you to start receiving email.`),
    `<p style="text-align:center;margin:32px 0"><a href="${url}" style="${EMAIL_BUTTON_STYLE}">Confirm subscription</a></p>`,
    `<p style="font-size:13px;color:${EMAIL_COLORS.inkMuted};overflow-wrap:anywhere">Or open this link: <a href="${url}" style="color:${EMAIL_COLORS.teal}">${url}</a></p>`,
    p("The link expires in 3 days. If you didn't ask for this, ignore this email and nothing will change."),
  ].join(""));
  const text = `Confirm your subscription to ${input.listName} from ${input.workspaceName}.\n\nOpen this link to confirm (expires in 3 days):\n${input.confirmUrl}\n\nIf you didn't ask for this, ignore this email and nothing will change.`;
  return { subject, html, text };
}
