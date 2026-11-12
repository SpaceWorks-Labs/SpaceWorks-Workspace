"use client";

import { useCallback, useSyncExternalStore } from "react";
import { DENSITY_KEY, parseDensity, type Density } from "@/lib/tasks/density";

const listeners = new Set<() => void>();
/** Fallback when localStorage is blocked: the choice lasts for this page view. */
let memory: string | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function read(): string {
  try {
    return window.localStorage.getItem(DENSITY_KEY) ?? memory ?? "";
  } catch {
    return memory ?? "";
  }
}

/** Board card density, remembered in localStorage. The server render and first client render use "comfortable". */
export function useDensity(): [Density, (density: Density) => void] {
  const density = parseDensity(useSyncExternalStore(subscribe, read, () => ""));
  const set = useCallback((next: Density) => {
    memory = next;
    try {
      window.localStorage.setItem(DENSITY_KEY, next);
    } catch {
      /* storage unavailable: kept in memory */
    }
    listeners.forEach((listener) => listener());
  }, []);
  return [density, set];
}
