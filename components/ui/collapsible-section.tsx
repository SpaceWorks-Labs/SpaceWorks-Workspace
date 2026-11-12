"use client";

import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { parseOpenMap, resolveOpen, withOpen } from "@/lib/collapse";

const listeners = new Set<() => void>();
/** Fallback when localStorage is blocked: the choice lasts for this page view. */
const memory = new Map<string, string>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function read(storageKey: string): string {
  try {
    return window.localStorage.getItem(storageKey) ?? memory.get(storageKey) ?? "";
  } catch {
    return memory.get(storageKey) ?? "";
  }
}

/**
 * Open/closed choices for a family of groups under one storage key. The server
 * snapshot is empty, so the first render uses the defaults and hydration matches.
 */
export function useOpenState(storageKey: string) {
  const raw = useSyncExternalStore(subscribe, () => read(storageKey), () => "");
  const isOpen = useCallback((id: string, defaultOpen: boolean) => resolveOpen(parseOpenMap(raw), id, defaultOpen), [raw]);
  const setOpen = useCallback(
    (id: string, open: boolean) => {
      const next = withOpen(parseOpenMap(read(storageKey)), id, open);
      memory.set(storageKey, next);
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        /* storage unavailable: kept in memory */
      }
      listeners.forEach((listener) => listener());
    },
    [storageKey],
  );
  return { isOpen, setOpen };
}

/** One group's remembered state: `[open, setOpen]`. */
export function usePersistentOpen(storageKey: string, id: string, defaultOpen: boolean): [boolean, (open: boolean) => void] {
  const { isOpen, setOpen } = useOpenState(storageKey);
  const set = useCallback((open: boolean) => setOpen(id, open), [setOpen, id]);
  return [isOpen(id, defaultOpen), set];
}

/** Header button with a rotating "▸" chevron (motion tokens, so reduced motion is instant). */
export function CollapseToggle({
  open,
  onToggle,
  controls,
  label,
  children,
  disabled,
  className,
}: {
  open: boolean;
  onToggle: () => void;
  controls: string;
  /** Accessible name when the visible text is not enough, e.g. "Collapse Done". */
  label?: string;
  children?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      aria-label={label}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onToggle}
      className={cn("flex min-h-11 min-w-0 items-center gap-2 rounded-md text-left transition-colors duration-[var(--sw-dur-fast)] hover:text-ink focus-visible:outline-none", className)}
    >
      <span aria-hidden className={cn("shrink-0 transition-transform duration-[var(--sw-dur-fast)] ease-[var(--sw-ease-standard)]", open && "rotate-90")}>▸</span>
      {children}
    </button>
  );
}

/**
 * A group with a toggle header and a body that is hidden (not unmounted) when
 * closed. Controlled: keep the state with `useOpenState` / `usePersistentOpen`.
 * `heading` wraps the toggle in h2/h3 for document outline; `count` stays visible when closed.
 */
export function CollapsibleSection({
  id,
  open,
  onOpenChange,
  title,
  count,
  heading,
  forceOpen,
  className,
  toggleClassName,
  bodyClassName,
  children,
}: {
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  count?: number;
  heading?: "h2" | "h3";
  forceOpen?: boolean;
  className?: string;
  toggleClassName?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  const shown = open || Boolean(forceOpen);
  const bodyId = `${id}-body`;
  const toggle = (
    <CollapseToggle open={shown} onToggle={() => onOpenChange(!open)} controls={bodyId} disabled={forceOpen} className={toggleClassName}>
      <span className="min-w-0 truncate">{title}</span>
      {count === undefined ? null : <span className="text-caption tabular-nums text-ink-muted">{count}</span>}
    </CollapseToggle>
  );
  const Heading = heading;
  return (
    <div className={className}>
      {Heading ? <Heading className="m-0">{toggle}</Heading> : toggle}
      <div id={bodyId} hidden={!shown} className={bodyClassName}>
        {children}
      </div>
    </div>
  );
}
