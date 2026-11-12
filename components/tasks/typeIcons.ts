import { Bug, CircleCheck, FileText, Flag, Lightbulb, Sparkles, TriangleAlert, Wrench, type LucideIcon } from "lucide-react";
import type { TaskTypeIcon } from "@prisma/client";

/** Task-type glyphs: the only place that maps the enum to (approved) lucide icons. */
export const TASK_TYPE_GLYPHS: Record<TaskTypeIcon, LucideIcon> = {
  TASK: CircleCheck,
  BUG: Bug,
  FEATURE: Sparkles,
  DOCS: FileText,
  CHORE: Wrench,
  MILESTONE: Flag,
  IDEA: Lightbulb,
  RISK: TriangleAlert,
};
