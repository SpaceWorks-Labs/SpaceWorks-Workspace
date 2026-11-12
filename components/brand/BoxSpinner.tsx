import { cn } from "@/lib/cn";
import { BOX_OPEN_SVG } from "./boxOpenMarkup";

/** The box artwork is 136 x 126; the width follows the height. */
const boxWidth = (height: number) => Math.round((height * 136) / 126 * 10) / 10;

/**
 * The bare looping box-open artwork (Design System motion/box-open): decorative,
 * never focusable, the still open logo under reduced motion. `BoxSpinner`,
 * `LogoLoader` and the skeleton layouts wrap it. `mono` draws it in the
 * surrounding text colour (inside filled buttons).
 */
export function BoxArt({ size, mono = false, className }: { size: number; mono?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("sw-box loop inline-block shrink-0 align-middle", mono && "mono", className)}
      style={{ width: boxWidth(size), height: size }}
      dangerouslySetInnerHTML={{ __html: BOX_OPEN_SVG }}
    />
  );
}

/**
 * Inline busy state for buttons, table rows and fields: the same box as
 * `LogoLoader`, 16-24px tall. A polite status announcing `label` (default
 * "Loading"); `mono` follows the text colour. Pair it with visible text that
 * agrees ("Saving", "Uploading").
 */
export function BoxSpinner({ label = "Loading", size = 20, mono = false, className }: { label?: string; size?: number; mono?: boolean; className?: string }) {
  return (
    <span role="status" aria-label={label} className={cn("inline-flex shrink-0 items-center align-middle", className)}>
      <BoxArt size={size} mono={mono} />
      <span className="sr-only">{label}</span>
    </span>
  );
}
