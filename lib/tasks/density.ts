/** Board card density (pure, client-safe). Remembered in localStorage by components/tasks/useDensity. */

export type Density = "comfortable" | "compact";
export const DENSITY_KEY = "sww.tasks.density";
export const parseDensity = (value: string | null | undefined): Density => (value === "compact" ? "compact" : "comfortable");
