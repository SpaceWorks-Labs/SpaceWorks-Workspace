import { EMAIL_BUTTON_STYLE, EMAIL_COLORS, emailLayout } from "./brand";

export type RenderedEmail = {
  attachments?: { filename: string; content: Buffer; contentType: string }[]; subject: string; html: string; text: string; calendarInvite?: { method: "REQUEST" | "CANCEL"; content: string } };

export function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]!);
}

export function paragraph(text: string) {
  return `<p style="font-size:16px;line-height:1.5;color:${EMAIL_COLORS.inkMuted};margin:0 0 16px">${text}</p>`;
}

export function heading(text: string) {
  return `<h2 style="margin-top:0;color:${EMAIL_COLORS.ink};font-size:20px;font-weight:600">${text}</h2>`;
}

/** Button plus the plain link underneath, for mail clients that hide buttons. */
export function actionButton(url: string, label: string) {
  const safe = escapeHtml(url);
  return `<p style="text-align:center;margin:32px 0"><a href="${safe}" style="${EMAIL_BUTTON_STYLE}">${escapeHtml(label)}</a></p>
<p style="font-size:13px;color:${EMAIL_COLORS.inkMuted};overflow-wrap:anywhere">Or open this link: <a href="${safe}" style="color:${EMAIL_COLORS.teal}">${safe}</a></p>`;
}

const ROLE_WORDS: Record<string, string> = { OWNER: "an owner", ADMIN: "an admin", MEMBER: "a member", GUEST: "a guest" };

export function renderInviteEmail(input: { workspaceName: string; inviterName?: string | null; role: string; inviteUrl: string; expiresAt: Date }): RenderedEmail {
  const who = input.inviterName?.trim() ? escapeHtml(input.inviterName.trim()) : "Someone";
  const workspace = escapeHtml(input.workspaceName);
  const role = ROLE_WORDS[input.role] ?? "a member";
  const days = Math.max(1, Math.round((input.expiresAt.getTime() - Date.now()) / 86_400_000));
  const subject = `You're invited to ${input.workspaceName} on Space Works`;
  const html = emailLayout(subject, [
    heading(`Join ${workspace}`),
    paragraph(`${who} invited you to join <strong>${workspace}</strong> as ${role}. It's where the crew plans projects, chats, keeps docs and shares the kitty.`),
    actionButton(input.inviteUrl, "Accept invitation"),
    paragraph(`This invitation expires in ${days} ${days === 1 ? "day" : "days"}. If you weren't expecting it, you can ignore this email.`),
  ].join(""));
  const text = `${input.inviterName?.trim() || "Someone"} invited you to join ${input.workspaceName} on Space Works as ${role}.\n\nAccept the invitation: ${input.inviteUrl}\n\nThis link expires in ${days} ${days === 1 ? "day" : "days"}. If you weren't expecting it, ignore this email.`;
  return { subject, html, text };
}

export function renderPasswordResetEmail(input: { resetUrl: string }): RenderedEmail {
  const subject = "Reset your Space Works password";
  const html = emailLayout(subject, [
    heading("Reset your password"),
    paragraph("We received a request to reset the password for your Space Works account. The link below works once and expires in 1 hour."),
    actionButton(input.resetUrl, "Choose a new password"),
    paragraph("If you didn't ask for this, you can ignore this email. Your password stays the same."),
  ].join(""));
  const text = `Reset your Space Works password\n\nOpen this link to choose a new password (expires in 1 hour):\n${input.resetUrl}\n\nIf you didn't ask for this, ignore this email.`;
  return { subject, html, text };
}

export function renderEmailVerificationEmail(input: { verificationUrl: string }): RenderedEmail {
  const subject = "Confirm your email for Space Works";
  const html = emailLayout(subject, [
    heading("Confirm your email"),
    paragraph("Confirm that this address belongs to you. Open the link and enter the password you chose when you signed up; you'll be signed in straight away. The link expires in 1 hour."),
    actionButton(input.verificationUrl, "Confirm email"),
    paragraph("If you didn't create a Space Works account, you can ignore this email. Nothing happens without that password."),
  ].join(""));
  const text = `Confirm your email for Space Works\n\nOpen this link and enter the password you chose when you signed up (expires in 1 hour):\n${input.verificationUrl}\n\nIf you didn't create a Space Works account, ignore this email.`;
  return { subject, html, text };
}

/** Generic notification email for later features (digests, mentions). `bodyHtml` must already be escaped. */
export function renderNotificationEmail(input: { title: string; bodyHtml: string; actionUrl?: string; actionLabel?: string }): RenderedEmail {
  const subject = input.title;
  const html = emailLayout(escapeHtml(subject), [
    heading(escapeHtml(input.title)),
    `<div style="font-size:16px;line-height:1.5;color:${EMAIL_COLORS.inkMuted}">${input.bodyHtml}</div>`,
    input.actionUrl ? actionButton(input.actionUrl, input.actionLabel ?? "Open Space Works") : "",
  ].join(""));
  const text = `${input.title}\n\n${input.bodyHtml.replace(/<[^>]+>/g, "")}${input.actionUrl ? `\n\n${input.actionUrl}` : ""}`;
  return { subject, html, text };
}
