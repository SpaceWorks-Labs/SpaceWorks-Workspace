import type { ModuleKey } from "@/lib/modules";

/** Top-level managed folders and the module whose data they hold. */
const FOLDER_MODULE: Readonly<Record<string, ModuleKey>> = {
  governance: "operations", safeguarding: "operations",
  funding: "finance", finance: "finance", "finance-tools": "finance", "money-controls": "finance",
  analytics: "analytics",
  "product-ops": "projects", tasks: "projects",
  documents: "knowledge", "doc images": "knowledge",
  chat: "chat",
  "org-people": "people", "people-service": "people",
  "marketing-it": "outreach", "marketing-assets": "outreach",
  requests: "helpdesk",
  calendar: "core", imports: "core",
};

/** Module that owns a file by its folder; the shared file library (everything else) belongs to knowledge. */
export function moduleForFolder(folder: string): ModuleKey {
  const top = folder.split("/").filter(Boolean)[0]?.toLowerCase();
  return (top && FOLDER_MODULE[top]) || "knowledge";
}
