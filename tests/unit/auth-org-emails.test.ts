import { describe, expect, it } from "vitest";
import { renderEmailVerificationEmail } from "@/lib/email/templates";
import { renderOrgRequestAdminEmail, renderOrgRequestDecidedEmail, renderOrgRequestReceivedEmail } from "@/lib/email/templates-orgs";

const base = "http://localhost:3100";

describe("auth and organisation emails", () => {
  it("tells the requester their request arrived, with a plain fallback link", () => {
    const mail = renderOrgRequestReceivedEmail({ summary: 'New organisation "Kochi <Makers>"', url: `${base}/account/organisations` });
    expect(mail.subject).toBe('We received your request: New organisation "Kochi <Makers>"');
    expect(mail.html).toContain("Kochi &lt;Makers&gt;");
    expect(mail.html).toContain(`Or open this link: <a href="${base}/account/organisations"`);
    expect(mail.text).toContain(`${base}/account/organisations`);
  });

  it("links an approved new organisation and explains a rejection", () => {
    const approved = renderOrgRequestDecidedEmail({ summary: 'New organisation "Kochi"', approved: true, url: `${base}/w/kochi`, actionLabel: "Open your organisation" });
    expect(approved.subject).toContain("was approved");
    expect(approved.text).toContain(`Open your organisation: ${base}/w/kochi`);
    const rejected = renderOrgRequestDecidedEmail({ summary: 'New organisation "Kochi"', approved: false, note: "Use the full name", url: `${base}/account/organisations`, actionLabel: "View your requests" });
    expect(rejected.html).toContain("Note from the admin: Use the full name");
    expect(rejected.text).toContain("send a new request");
  });

  it("sends the super admin to the queue without a token", () => {
    const mail = renderOrgRequestAdminEmail({ summary: "x", requesterName: "Meera", queueUrl: `${base}/admin/requests` });
    expect(mail.text).toContain(`${base}/admin/requests`);
  });

  it("explains that confirming needs the sign-up password", () => {
    const mail = renderEmailVerificationEmail({ verificationUrl: `${base}/verify-email/abc` });
    expect(mail.text).toContain("password you chose when you signed up");
    expect(mail.html).not.toContain("change your email");
  });
});
