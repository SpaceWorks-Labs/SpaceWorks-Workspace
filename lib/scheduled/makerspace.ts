import "server-only";
import { runMaintenanceReminders } from "@/lib/makerspace/maintenance";

/** Hourly makerspace work: maintenance-due reminders. */
export async function run(now: Date = new Date()): Promise<void> {
  await runMaintenanceReminders(now);
}
