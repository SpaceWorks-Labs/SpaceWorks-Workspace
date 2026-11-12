import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NoWorkspaceHome } from "@/components/home/NoWorkspaceHome";

type Props = Parameters<typeof NoWorkspaceHome>[0];
const base: Props = { email: "maker@example.test", superAdmin: false, pendingRequest: null, rejectedRequest: null };
const render = (props: Partial<Props> = {}) => renderToStaticMarkup(createElement(NoWorkspaceHome, { ...base, ...props })).replace(/&#x27;|&#39;/g, "'");

describe("NoWorkspaceHome", () => {
  it("with nothing requested, offers both ways in: an invitation or a new organisation", () => {
    const html = render();
    expect(html).toContain("No workspace yet.");
    expect(html).toContain("Ask one of its admins to invite maker@example.test");
    expect(html).toContain('href="/account/organisations#request"');
    expect(html).toContain("Request an organisation");
    expect(html).toContain("The instance admin approves new organisations");
    expect(html).not.toContain("Open instance admin");
    expect(html).toContain("Sign out");
  });

  it("says the organisation is created at once when approval is off", () => {
    const html = render({ requireApproval: false });
    expect(html).toContain("Create an organisation");
    expect(html).toContain("ready straight away");
    expect(html).not.toContain("approves new organisations");
  });

  it("shows a pending request with what happens next, and no second request button", () => {
    const html = render({ pendingRequest: { requestedName: "Kochi Makers", decisionNote: null } });
    expect(html).toContain("Waiting for approval");
    expect(html).toContain("Your request for Kochi Makers is with the instance admin");
    expect(html).toContain("We'll email maker@example.test");
    expect(html).toContain("Kochi Makers opens straight from this page");
    expect(html).toContain('href="/account/organisations"');
    expect(html).toContain("View or edit your request");
    expect(html).not.toContain("Request an organisation");
  });

  it("shows a rejection with the admin's note and a way to resubmit", () => {
    const html = render({ rejectedRequest: { requestedName: "Kochi Makers", decisionNote: "Use the community's full name." } });
    expect(html).toContain("Your request for Kochi Makers was not approved");
    expect(html).toContain("Note from the admin: Use the community's full name.");
    expect(html).toContain("Send a new request");
    expect(html).toContain("Ask one of its admins to invite");
  });

  it("links the instance admin to /admin", () => {
    expect(render({ superAdmin: true })).toContain('href="/admin"');
  });
});
