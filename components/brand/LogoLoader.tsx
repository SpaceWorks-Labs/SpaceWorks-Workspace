import { cn } from "@/lib/cn";
import { BoxArt } from "./BoxSpinner";

/**
 * Loading state for a whole page, panel or Suspense boundary (Design System
 * 0.12.0, the one loader everywhere): the Space Works box opens, holds, folds
 * shut and repeats every 4.4s; under reduced motion it is the still, open logo.
 * Announces `label` as a polite status; `showLabel` also prints it under the box.
 * Buttons, rows and fields use the small `BoxSpinner` of the same artwork.
 */
export function LogoLoader({ label = "Loading", size = 72, showLabel = false, className = "min-h-40 py-10" }: {
  label?: string; size?: number; showLabel?: boolean; className?: string;
}) {
  return (
    <div role="status" aria-label={label} className={cn("grid w-full place-content-center justify-items-center gap-3", className)}>
      <BoxArt size={size} />
      <p className={showLabel ? "text-body-ui text-ink-muted" : "sr-only"}>{label}</p>
    </div>
  );
}
