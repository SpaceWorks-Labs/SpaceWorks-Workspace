import { formatDayShort } from "@/lib/format/datetime";
import { PRIORITY_LABELS } from "@/lib/tasks/filters";

/**
 * One line of task history in plain language (pure, client-safe). `data`
 * is the TaskActivity JSON written by lib/tasks/service.ts.
 */

type Data = Record<string, unknown> | null | undefined;

const str = (value: unknown) => (typeof value === "string" ? value : "");
/** "Every week on Mon" → "every week on Mon" (only the first letter). */
const lowerFirst = (value: string) => value.charAt(0).toLowerCase() + value.slice(1);
const list = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "someone";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** " via Assistant" / " via MCP · client" / " via API" for changes that did not come from the web app. */
export function sourceSuffix(d: Record<string, unknown>): string {
  const client = str(d.client);
  switch (d.source) {
    case "assistant": return " via Assistant";
    case "mcp": return client ? ` via MCP · ${client}` : " via MCP";
    case "api": return client ? ` via API · ${client}` : " via API";
    default: return "";
  }
}

/** Kinds shown elsewhere (comments have their own list) or internal markers. */
export const HIDDEN_ACTIVITY_KINDS = new Set(["commented"]);

export function activityText(kind: string, data: Data, context: { nameOf: (userId: string) => string; timeZone: string }): string {
  const d = (data ?? {}) as Record<string, unknown>;
  switch (kind) {
    case "plan_updated": return "updated the schedule and blocker";
    case "created":
      return "created this task";
    case "created_recurring":
      return `was created by the repeat schedule${str(d.text) ? ` (${lowerFirst(str(d.text))})` : ""}`;
    case "title":
      return `renamed this from “${str(d.from)}”`;
    case "description":
      return "updated the description";
    case "priority": {
      const to = str(d.to) as keyof typeof PRIORITY_LABELS;
      return to === "NONE" ? "cleared the priority" : `set the priority to ${(PRIORITY_LABELS[to] ?? to).toLowerCase()}`;
    }
    case "due":
      return d.to ? `set the due date to ${formatDayShort(str(d.to), context.timeZone)}` : "cleared the due date";
    case "moved":
      return d.from ? `moved this from ${str(d.from)} to ${str(d.to)}` : `moved this to ${str(d.to)}`;
    case "type_changed":
      return str(d.from) ? `changed the type from ${str(d.from)} to ${str(d.to)}` : `set the type to ${str(d.to)}`;
    case "transferred": {
      const from = d.from as { key?: unknown; name?: unknown } | null | undefined;
      const to = d.to as { key?: unknown; name?: unknown } | null | undefined;
      const dropped = list(d.droppedAssignees);
      const base = `moved this from ${str(from?.name)} (${str(from?.key)}) to ${str(to?.name)} (${str(to?.key)})`;
      return (dropped.length > 0 ? `${base}; unassigned ${joinNames(dropped.map(context.nameOf))}` : base) + sourceSuffix(d);
    }
    case "assigned": {
      const ids = list(d.userIds);
      const text = d.claimed === true ? "took this task" : ids.length === 1 && ids[0] === str(d.by) ? "assigned themselves" : `assigned ${joinNames(ids.map(context.nameOf))}`;
      return text + sourceSuffix(d);
    }
    case "unassigned": {
      const ids = list(d.userIds);
      const text = ids.length === 1 && ids[0] === str(d.by) ? "unassigned themselves" : `unassigned ${joinNames(ids.map(context.nameOf))}`;
      return text + sourceSuffix(d);
    }
    case "labeled":
      return `added the ${list(d.names).length === 1 ? "label" : "labels"} ${joinNames(list(d.names))}`;
    case "unlabeled":
      return `removed the ${list(d.names).length === 1 ? "label" : "labels"} ${joinNames(list(d.names))}`;
    case "completed":
      return "marked this done";
    case "reopened":
      return "reopened this";
    case "archived":
      return "archived this task";
    case "restored":
      return "restored this task";
    case "commented":
      return "commented";
    case "subtask_added":
      return `added the subtask “${str(d.title)}”`;
    case "blocked_by_added":
      return `marked this as blocked by ${str(d.ref)}`;
    case "blocks_added":
      return `marked this as blocking ${str(d.ref)}`;
    case "blocked_by_removed":
      return d.ref ? `removed the blocker ${str(d.ref)}` : "removed a blocker";
    case "unblocked":
      return `finished ${str(d.by)}, so this is no longer blocked`;
    case "attachment_added":
      return `attached ${str(d.filename)}`;
    case "attachment_removed":
      return `removed the attachment ${str(d.filename)}`;
    case "recurrence_set":
      return `set this to repeat: ${lowerFirst(str(d.text))}`;
    case "recurrence_stopped":
      return "stopped repeating this task";
    case "recurrence_skipped":
      return "skipped the next repeat";
    default:
      return "updated this task";
  }
}
