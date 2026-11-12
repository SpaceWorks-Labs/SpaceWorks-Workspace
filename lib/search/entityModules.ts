import { isModuleEnabled, type ModuleKey, type ModuleSettings } from "@/lib/modules";

/**
 * Which module owns each search/activity entity type. Types missing here
 * belong to core and are never hidden. Pure and client-safe.
 */
export const ENTITY_MODULE: Readonly<Record<string, ModuleKey>> = {
  application_secret: "secrets", secret_environment: "secrets", secret_project: "secrets",
  task: "projects", project: "projects", project_milestone: "projects", project_update: "projects", cycle: "projects", cycle_review: "projects", goal: "projects", product_ops: "projects",
  meeting: "meetings", decision: "meetings", signature_snapshot: "meetings",
  message: "chat", channel: "chat",
  doc: "knowledge", link: "knowledge", template: "knowledge", form: "knowledge", file: "knowledge", business_document: "knowledge",
  announcement: "community", changelog: "community", idea: "community", idea_comment: "community", poll: "community",
  team: "people", org_department: "people", org_responsibility: "people", org_escalation: "people", org_attendance: "people", ops_hours: "people", ops_leave: "people", ops_candidate: "people", ops_opening: "people", shift: "people",
  governance: "operations", ops_safety: "operations", ops_lease: "operations", ops_inspection: "operations",
  ops_ticket: "helpdesk",
  service: "services", asset: "services", monitor: "services", incident: "services", monitor_results: "services",
  contact: "outreach", organisation: "outreach", marketing_it: "outreach",
  app_review: "social",
  funding: "finance", money_control: "finance", invoice: "finance", recurring_cost: "finance", subscription: "finance",
  finance_fund: "finance", finance_centre: "finance", finance_budget: "finance", finance_bill: "finance", finance_disbursement: "finance", finance_entry: "finance",
  analytics_adjustment: "analytics", analytics_preset: "analytics",
};

export function moduleForEntityType(entityType: string): ModuleKey {
  return ENTITY_MODULE[entityType] ?? "core";
}

/** Entity types whose module is switched off for these settings. */
export function disabledEntityTypes(settings: ModuleSettings): string[] {
  return Object.entries(ENTITY_MODULE).filter(([, key]) => !isModuleEnabled(settings, key)).map(([type]) => type);
}
