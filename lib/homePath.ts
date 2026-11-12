/**
 * Where "/" and the console's back link send a signed-in person. Pure, so
 * unit tests pin each role's landing page. The instance super admin's home is
 * the /admin console (MFA step-up first); everyone else lands on their last
 * (or first) workspace, or null for "no workspace yet".
 */
type Landing = { isSuperAdmin: boolean; workspaces: readonly { slug: string }[]; lastSlug?: string | null };

export function lastWorkspacePath({ workspaces, lastSlug }: Pick<Landing, "workspaces" | "lastSlug">): string | null {
  const target = workspaces.find((workspace) => workspace.slug === lastSlug) ?? workspaces[0];
  return target ? `/w/${encodeURIComponent(target.slug)}` : null;
}

export function homePathFor(landing: Landing): string | null {
  if (landing.isSuperAdmin) return "/admin";
  return lastWorkspacePath(landing);
}
