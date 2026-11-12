import "server-only";
import { getMetrics, JOB_QUEUES } from "./registry";

/** Called by the worker for every finished job. Only the bounded queue name and result are labels. */
export function recordJobResult(queue: string, result: "completed" | "failed") {
  const name = (JOB_QUEUES as readonly string[]).includes(queue) ? queue : "other";
  getMetrics().jobResults.inc({ queue: name, result });
}

export function recordBeatSchedules(count: number) {
  getMetrics().beatSchedules.set(count);
}
