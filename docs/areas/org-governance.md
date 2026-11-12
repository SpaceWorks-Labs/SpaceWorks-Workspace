# Organisation governance

Organisations (workspaces) are requested by users and approved by the instance super admin. Owners see their
plan, limits, usage and modules, and can ask for more.

## Requester and owner side

- **Request a new organisation**: `/account/organisations` (also linked from the workspace switcher and from the
  no-workspace screen on `/`). Form: name, address (slug) and an optional reason. Creates an `OrgRequest`
  (`kind NEW_ORG`, `requestedName`, `requestedSlug`, `message`).
  - Server Action `requestNewOrganisation` (`app/actions/orgRequests.ts`) rate-limits with the `orgRequest` bucket.
  - A user can have 3 pending requests. The slug must be valid, not reserved, and free among workspaces and
    pending requests (checked on submit, inside a per-user advisory lock).
  - `limits.maxWorkspacesPerOwner` counts ACTIVE workspaces the user owns plus their pending NEW_ORG requests.
  - When the instance setting `workspaces.requireApproval` is `false`, the workspace is created straight away
    (requester OWNER, ACTIVE) and the request is stored as APPROVED ("Approved automatically.").
  - The super admin (`SUPER_ADMIN_EMAIL`) gets an outbox email with a plain link to `/admin/requests`
    (never a bearer link), and the requester gets a "We received your request" email linking to
    `/account/organisations`. Audit event: `workspace.requested`.
  - The address field checks availability as you type (`checkOrganisationAddress`, the same rules as submit);
    the server checks again on submit.
- **Requester views**: `/` (`components/home/NoWorkspaceHome.tsx`) shows the two ways in (an invitation, or a new
  organisation) when the user has no workspace, "Waiting for approval" with what happens next, or the rejection
  note with "Send a new request"; the switcher and the account page link to `/account/organisations`, which lists
  every request with its status and next step. Pending new-organisation requests can be edited (name, address,
  reason; `updateOrganisationRequest`, audit `workspace.request_updated`) or cancelled (audit
  `workspace.request_cancelled`); approved ones link to the organisation while it is ACTIVE.
- **Plan page** `/w/<slug>/settings/plan` (OWNER; works while the workspace is SUSPENDED and shows the reason):
  status, plan label, each limit with a usage bar (or "Unlimited"), modules on/off, "Request more" per limit
  (`MORE_LIMIT`, payload `{limit, requested}`; byte limits are entered in MB), "Request access" per disabled module
  (`FEATURE`, payload `{module}`), and this workspace's requests with decisions. Max 5 pending per workspace.
  Loader: `loadPlanView(workspaceId)` in `lib/orgRequests/plan.ts`.

## Service (`lib/orgRequests/service.ts`)

All functions return `{ ok: true, data } | { ok: false, error, fieldErrors? }`.

- `createOrgRequest(userId, input)`: `input` is `{kind:"NEW_ORG", name, slug, message?}`,
  `{kind:"MORE_LIMIT", workspaceId, limit, requested, message?}` or `{kind:"FEATURE", workspaceId, module, message?}`.
  MORE_LIMIT and FEATURE require an ACTIVE OWNER membership. Rate limiting is the caller's job.
- `cancelOrgRequest(userId, requestId)`
- `updateOrgRequest(userId, requestId, {name, slug, message})`: the requester's own pending NEW_ORG request only,
  under the same per-user lock and address rules as creating. `addressProblem(slug, exceptRequestId?)` backs the
  live address check.
- `listRequestsForUser(userId)` / `listRequestsForWorkspace(workspaceId)` return `OrgRequestRow[]`.
- `applyNewOrgApproval(requestId, decidedById, note?)` and
  `applyRequestDecision(requestId, "APPROVED" | "REJECTED", decidedById, note?)`.
  The decision claims the row with `UPDATE ... WHERE status = 'PENDING'`, so a second decision fails
  ("already decided or withdrawn"). A rejection needs a note. Approval applies the change in the same
  transaction: NEW_ORG creates the workspace via `createWorkspaceWithDefaults` (requester OWNER, ACTIVE) and sets
  `request.workspaceId`; MORE_LIMIT upserts the `WorkspaceLimits` field; FEATURE removes the module from
  `disabledModules` and adds it to `enabledModules`. Afterwards `invalidateLimits`, an audit event
  (`workspace.request_approved` / `workspace.request_rejected`), an email to the requester and, when a
  workspace exists, the in-app `org.request_decided` notification.

Emails use `lib/email/templates-orgs.ts` through the outbox.

## Instance admin (`/admin/organisations`, `/admin/requests`)

All pages call `requireSuperAdminMfa()`; every action in `app/actions/adminOrgs.ts` and
`app/actions/adminRequests.ts` does the same, plus a rate limit, zod and an audit event. Queries live in
`lib/admin/**`.

- `/admin/organisations`: name, address, status chip, owners, member and guest counts, usage bars against the
  effective limits, status filter, search (name, slug, owner email), 20 per page. `/admin/workspaces` redirects here.
- `/admin/organisations/[id]` tabs (`?tab=`): Overview (status, reason, requester, decision, plan, actions), Members,
  Limits and modules, Usage, Audit (newest first, paginated), Requests. "Open organisation" links to `/w/<slug>`;
  silent access is `lib/permissions` (the admin never gets a Membership row).
- Actions: suspend (reason, `SUSPENDED` + `suspendedAt`) and reactivate; transfer ownership (locks the owner rows,
  optionally makes the other owners admins); member role, suspend and remove through `lib/admin/orgMutations.ts`,
  which never relies on the synthetic membership and never removes, demotes or suspends the last active owner.
- Limits editor: each numeric field empty = inherit (shows usage and the inherited value); storage and file sizes
  are entered in MB. Modules are tri-state: Default, On (`enabledModules`) or Off (`disabledModules`), including
  `finance.payroll`. Save upserts `WorkspaceLimits`, calls `invalidateLimits(id)` and audits
  `admin.workspace_limits_updated` with numeric before/after values only.
- `/admin/requests`: unified queue (status and kind filters, pending oldest first). Approve or reject with a note
  (rejection needs one) through `applyNewOrgApproval` / `applyRequestDecision`. Approving a NEW_ORG request can set
  starting limits.
- `/admin/settings` has an "Organisation defaults" form: `workspaces.requireApproval` (default on), the instance
  limit defaults, and `modules.disabledByDefault`. Saving calls `invalidateLimits()` for every workspace.
- Audit actions: `admin.workspace_suspended`, `admin.workspace_reactivated`, `admin.ownership_transferred`,
  `admin.member_role_changed`, `admin.member_suspended`, `admin.member_reactivated`, `admin.member_removed`,
  `admin.workspace_limits_updated`, `admin.org_defaults_updated`.
- Tests: `tests/integration/admin-orgs.db.test.ts`.

## Known limits

- Seat and project limits are serialised by `lockWorkspace`, so parallel requests cannot pass them. Storage,
  API-token and webhook limits are checked without that lock, so a burst of parallel requests can go a little
  over the cap. The next create is refused.
- Role and status changes made by the super admin in `/admin/organisations/[id]` skip the seat cap on purpose,
  so the instance admin can always fix an organisation.
- With `workspaces.requireApproval` off and no `limits.maxWorkspacesPerOwner`, one person can create
  organisations up to the `orgRequest` rate limit (10 a day). Set the per-owner limit if self sign-up is on.
