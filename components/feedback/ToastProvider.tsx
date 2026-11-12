"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { TriangleAlert as AlertTriangle, CircleCheck as CheckCircle2, Info, TriangleAlert as XCircle } from "lucide-react";
import { cn } from "@/lib/cn";

type Severity = "success" | "error" | "info" | "warning";

type ToastAction = {
  label: string;
  onClick: () => void;
};

type ToastContextValue = {
  showToast: (message: string, severity?: Severity, action?: ToastAction | null, durationMs?: number) => void;
};

type ToastState = { id: number; message: string; severity: Severity; action: ToastAction | null; duration: number; closing?: boolean };

const ToastContext = createContext<ToastContextValue | null>(null);

const icons: Record<Severity, React.ReactNode> = {
  // Toasts sit on Deep Ink in both modes: Citron, Warm Yellow, Sky Blue and the
  // spec's light danger red all clear 4.5:1 there.
  success: <CheckCircle2 className="text-sw-citron" />,
  error: <XCircle className="text-on-inverse" />,
  warning: <AlertTriangle className="text-sw-yellow" />,
  info: <Info className="text-sw-sky" />,
};

/**
 * Ink toast (docs/DESIGN.md §4.15): bottom-center on mobile, bottom-left on
 * desktop, optional single action such as Undo. Errors are announced
 * assertively; everything else politely.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counter = useRef(0);

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    // Fade out first; onAnimationEnd (or the fallback timer) unmounts it.
    setToast((current) => (current ? { ...current, closing: true } : current));
  }, []);

  const showToast = useCallback((message: string, severity: Severity = "info", action: ToastAction | null = null, durationMs = 5000) => {
    counter.current += 1;
    setToast({ id: counter.current, message, severity, action, duration: durationMs });
  }, []);

  useEffect(() => {
    if (!toast || toast.closing) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(dismiss, toast.duration);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [toast, dismiss]);

  const closing = toast?.closing ?? false;
  useEffect(() => {
    if (!closing) return;
    const fallback = setTimeout(() => setToast(null), 400);
    return () => clearTimeout(fallback);
  }, [closing]);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div data-sw-toast-viewport className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex justify-center p-4 md:justify-start md:p-6">
        <div role={toast?.severity === "error" ? "alert" : "status"} aria-live={toast?.severity === "error" ? "assertive" : "polite"} className="contents">
          {toast ? (
            <div
              key={toast.id}
              data-state={toast.closing ? "closed" : "open"}
              onAnimationEnd={() => toast.closing && setToast(null)}
              className={cn(
                "sw-toast pointer-events-auto flex w-full max-w-[460px] items-center gap-3 rounded-lg bg-inverse py-3 pl-4 pr-2 text-body-ui text-on-inverse shadow-float",
              )}
            >
              <span aria-hidden className="inline-flex shrink-0 [&_svg]:size-5">{icons[toast.severity]}</span>
              <p className="min-w-0 flex-1">{toast.message}</p>
              {toast.action ? (
                <button
                  type="button"
                  onClick={() => {
                    toast.action?.onClick();
                    dismiss();
                  }}
                  className="min-h-11 shrink-0 rounded-md px-3 text-sm font-semibold underline-offset-4 hover:underline"
                >
                  {toast.action.label}
                </button>
              ) : null}
              <button type="button" onClick={dismiss} aria-label="Dismiss" className="inline-flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-muted hover:text-ink">
                <span aria-hidden="true" className="inline-flex items-center justify-center text-xs font-semibold">×</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}
