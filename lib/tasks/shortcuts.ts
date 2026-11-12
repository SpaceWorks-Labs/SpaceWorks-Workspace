/** Keyboard shortcut rules for the board (pure, client-safe). */

/** True when the key press came from a field the person is typing in. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as { isContentEditable?: boolean; tagName?: string } | null;
  return Boolean(element && (element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName ?? "")));
}

export type ShortcutEventLike = { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey?: boolean; defaultPrevented?: boolean; target: EventTarget | null };

/**
 * The single-key shortcut a key press stands for, or null when it must be
 * ignored: modified keys, typing in a field, and while a menu, dialog or
 * listbox is open (`overlayOpen`).
 */
export function shortcutFor(event: ShortcutEventLike, overlayOpen: boolean): "search" | "next" | "prev" | null {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || overlayOpen || isTypingTarget(event.target)) return null;
  if (event.key === "/") return "search";
  if (event.key === "j") return "next";
  if (event.key === "k") return "prev";
  return null;
}

/** Index of the card to focus after `j` (next) or `k` (previous); `current` is -1 when no card has focus. */
export function nextFocusIndex(current: number, count: number, direction: "next" | "prev"): number {
  if (count === 0) return -1;
  if (current < 0) return direction === "next" ? 0 : count - 1;
  return Math.min(count - 1, Math.max(0, current + (direction === "next" ? 1 : -1)));
}
