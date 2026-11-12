"use client";

import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { ToastProvider } from "@/components/feedback/ToastProvider";
import { TooltipProvider } from "@/components/ui/menu";
import { COLOR_MODE_COOKIE, COLOR_MODE_STORAGE_KEY, type ColorMode } from "@/lib/colorMode";
import { syncThemeColorMeta, transitionColorMode, type RevealOrigin } from "@/lib/themeTransition";

export type ColorModePreference = ColorMode | "system";

function readPreference(): ColorModePreference {
  try {
    const saved = window.localStorage.getItem(COLOR_MODE_STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch {
    // Storage can be blocked; fall back to the cookie below.
  }
  // The cookie is what the server rendered with, so honour it when storage is
  // empty; otherwise the page would flip back to the system mode after loading.
  const cookie = document.cookie.split("; ").find((entry) => entry.startsWith(`${COLOR_MODE_COOKIE}=`))?.split("=")[1];
  if (cookie === "light" || cookie === "dark" || cookie === "system") return cookie;
  return "light";
}

function readSystemDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function subscribe(onStoreChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  window.addEventListener("storage", onStoreChange);
  window.addEventListener("sww:color-mode-change", onStoreChange);
  media.addEventListener("change", onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener("sww:color-mode-change", onStoreChange);
    media.removeEventListener("change", onStoreChange);
  };
}

type ColorModeOrigin = RevealOrigin;

const ColorModeContext = createContext<{
  mode: ColorMode;
  /** The stored choice; "system" follows the operating system. */
  preference: ColorModePreference;
  /** Pass the click point to reveal the new mode from there. */
  toggleColorMode: (origin?: ColorModeOrigin) => void;
  /** Pick light, dark or system explicitly (same storage as the toggle). */
  setColorModePreference: (next: ColorModePreference, origin?: ColorModeOrigin) => void;
} | null>(null);

function applyColorMode(next: ColorMode) {
  const root = document.documentElement;
  root.dataset.colorMode = next;
  root.style.colorScheme = next;
  syncThemeColorMeta();
}

export function useAppColorMode() {
  const context = useContext(ColorModeContext);
  if (!context) throw new Error("useAppColorMode must be used inside Providers.");
  return context;
}

/**
 * Colour mode follows the operating system until the person picks one; the
 * choice is stored only in this browser (localStorage plus a cookie so the
 * server renders the right mode without a flash).
 */
export function Providers({
  children,
  session,
  initialColorMode = null,
}: {
  children: React.ReactNode;
  session?: Session | null;
  initialColorMode?: ColorMode | null;
}) {
  const preference = useSyncExternalStore<ColorModePreference>(subscribe, readPreference, () => initialColorMode ?? "system");
  const systemDark = useSyncExternalStore(subscribe, readSystemDark, () => false);
  const mode: ColorMode = preference === "system" ? (systemDark ? "dark" : "light") : preference;

  useEffect(() => {
    const root = document.documentElement;
    if (preference === "system") {
      delete root.dataset.colorMode;
      root.style.removeProperty("color-scheme");
    } else {
      root.dataset.colorMode = preference;
      root.style.colorScheme = preference;
    }
    syncThemeColorMeta();
  }, [preference]);

  const colorMode = useMemo(() => {
    const setColorModePreference = (next: ColorModePreference, origin?: ColorModeOrigin) => {
      const secure = window.location.protocol === "https:" ? "; Secure" : "";
      try {
        window.localStorage.setItem(COLOR_MODE_STORAGE_KEY, next);
      } catch {
        // Ignore blocked storage; the cookie still carries the choice.
      }
      document.cookie = `${COLOR_MODE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
      const resolved: ColorMode = next === "system" ? (readSystemDark() ? "dark" : "light") : next;
      const commit = () => {
        // Tokens and React state (icons, labels) change in the same frame.
        applyColorMode(resolved);
        flushSync(() => window.dispatchEvent(new Event("sww:color-mode-change")));
      };
      if (resolved === mode) commit();
      else transitionColorMode(commit, origin);
    };
    return {
      mode,
      preference,
      setColorModePreference,
      toggleColorMode: (origin?: ColorModeOrigin) => setColorModePreference(mode === "dark" ? "light" : "dark", origin),
    };
  }, [mode, preference]);
  return (
    <SessionProvider session={session}>
      <ColorModeContext.Provider value={colorMode}>
        <TooltipProvider delayDuration={300}>
          <ToastProvider>{children}</ToastProvider>
        </TooltipProvider>
      </ColorModeContext.Provider>
    </SessionProvider>
  );
}
