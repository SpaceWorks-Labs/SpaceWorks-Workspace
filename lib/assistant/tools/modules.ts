import type { ModuleKey } from "@/lib/modules";

/**
 * Which module owns each `sw_*` tool. Tools missing here are core and always
 * offered. Kept in one table so task tools (owned elsewhere) need no edits.
 */
export const TOOL_MODULE: Readonly<Record<string, ModuleKey>> = {
  sw_list_tasks: "projects", sw_get_task: "projects", sw_list_projects: "projects", sw_create_task: "projects", sw_update_task: "projects",
  sw_add_comment: "projects", sw_archive_task: "projects", sw_move_task: "projects", sw_assign_task: "projects", sw_claim_task: "projects",
  sw_list_channels: "chat", sw_read_channel_messages: "chat", sw_send_channel_message: "chat",
  sw_list_docs: "knowledge", sw_get_doc: "knowledge", sw_create_doc: "knowledge",
  sw_list_announcements: "community",
  sw_finance_summary: "finance",
  sw_list_monitors: "services", sw_list_incidents: "services",
  sw_remember: "assistant", sw_forget: "assistant", sw_search_memory: "assistant", sw_list_skills: "assistant", sw_get_skill: "assistant", sw_web_search: "assistant",
  sw_list_social_comments: "social", sw_social_overview: "social", sw_list_app_reviews: "social", sw_get_app_review: "social",
};
