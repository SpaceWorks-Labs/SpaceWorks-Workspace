/** Task references and links (pure, client-safe). */

/** "BOT-12" for project tasks, "#12" for tasks without a project. */
export function taskReference(projectKey: string | null | undefined, number: number): string {
  return projectKey ? `${projectKey}-${number}` : `#${number}`;
}

/** Canonical app-relative link to a task. */
export function taskUrl(workspaceSlug: string, projectKey: string | null | undefined, number: number): string {
  return projectKey ? `/w/${workspaceSlug}/projects/${projectKey}/${number}` : `/w/${workspaceSlug}/t/${number}`;
}

export function projectUrl(workspaceSlug: string, projectKey: string): string {
  return `/w/${workspaceSlug}/projects/${projectKey}`;
}

/**
 * Parse a short reference: "BOT-12", "bot-12", "#12" or "12". Task numbers
 * are unique per workspace, so the key is only checked, never required.
 */
export function parseTaskReference(value: string): { key: string | null; number: number } | null {
  const match = /^(?:([A-Za-z][A-Za-z0-9]{1,9})-)?#?(\d{1,9})$/.exec(value.trim());
  if (!match) return null;
  const number = Number(match[2]);
  if (!Number.isSafeInteger(number) || number < 1) return null;
  return { key: match[1] ? match[1].toUpperCase() : null, number };
}

/**
 * Where a task link should land when the project key in the URL is not the task's
 * current one (the task moved to another project, or the key was renamed); null when it is already canonical.
 */
export function canonicalTaskRedirect(workspaceSlug: string, requestedKey: string, task: { number: number; projectKey: string | null }): string | null {
  if (task.projectKey && task.projectKey.toUpperCase() === requestedKey.toUpperCase()) return null;
  return taskUrl(workspaceSlug, task.projectKey, task.number);
}
