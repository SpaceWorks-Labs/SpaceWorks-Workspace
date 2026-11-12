import "server-only";
import { getWorkspaceModules } from "@/lib/limits/modules";

/** Operations that belong to the finance.payroll sub-area (the gate's options.module skips sub checks). */
export const PAYROLL_OPERATIONS = new Set(["grant", "payProfile", "payRun", "payTransition", "payBookkeeping", "disbursement", "disbursementTransition"]);

/** True when the super admin switched finance.payroll off for the workspace. */
export async function payrollDisabled(workspaceId: string): Promise<boolean> {
  return (await getWorkspaceModules(workspaceId)).disabledModules.includes("finance.payroll");
}
