"use client";

import {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { TriangleAlert as AlertCircle, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { controlClasses } from "./styles";

export { controlClasses };

type FieldProps = {
  label: ReactNode;
  /** Shown in muted text after the label. */
  optional?: boolean;
  helperText?: ReactNode;
  error?: ReactNode;
  /** Visually hide the label but keep it for assistive technology. */
  hideLabel?: boolean;
  className?: string;
  id?: string;
  required?: boolean;
  children: ReactElement<Record<string, unknown>>;
};

/** Label above, control, then helper or error text, all wired with ids and ARIA. */
export function Field({ label, optional, helperText, error, hideLabel, className, id, required, children: rawChildren }: FieldProps) {
  const generatedId = useId();
  const children = resolveLazy(rawChildren);
  const childProps = isValidElement<Record<string, unknown>>(children) ? children.props : undefined;
  const controlId = id ?? (childProps?.id as string | undefined) ?? generatedId;
  const describedBy = error || helperText ? `${controlId}-description` : undefined;
  const control = isValidElement<Record<string, unknown>>(children)
    ? cloneElement(children, {
        id: controlId,
        "aria-invalid": error ? true : (children.props["aria-invalid"] as boolean | undefined),
        "aria-describedby": [children.props["aria-describedby"], describedBy].filter(Boolean).join(" ") || undefined,
        required: required ?? (children.props.required as boolean | undefined),
      })
    : children;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={controlId} className={cn("text-label text-ink", hideLabel && "sr-only")}>
        {label}
        {optional ? <span className="ml-1.5 font-normal text-ink-muted">Optional</span> : null}
      </label>
      {control}
      {error ? (
        <p id={describedBy} className="flex items-start gap-1.5 text-caption text-danger-fg">
          <AlertCircle aria-hidden className="mt-px size-4 shrink-0" />
          <span>{error}</span>
        </p>
      ) : helperText ? (
        <p id={describedBy} className="text-caption text-ink-muted">{helperText}</p>
      ) : null}
    </div>
  );
}

const LAZY = Symbol.for("react.lazy");
type LazyNode = { $$typeof: symbol; _payload: unknown; _init: (payload: unknown) => ReactNode };

/**
 * A control passed from a Server Component can reach the server render as a lazy
 * reference. Resolve it the way React does (suspending while it loads) so the
 * server and client both clone the same element and wire the same ids.
 */
function resolveLazy(node: ReactNode): ReactNode {
  const lazy = node as unknown as LazyNode | null;
  return lazy && typeof lazy === "object" && lazy.$$typeof === LAZY ? resolveLazy(lazy._init(lazy._payload)) : node;
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, type, ...props }, ref) {
  const inputType = type ?? (props.name === "q" ? "search" : undefined);
  return <input ref={ref} type={inputType} className={cn(controlClasses, inputType === "search" && searchClasses, className)} {...props} />;
});

const searchClasses = "border-transparent bg-sidebar hover:border-transparent hover:bg-sidebar-hover dark:bg-surface dark:hover:bg-muted";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, rows = 4, ...props }, ref) {
  return <textarea ref={ref} rows={rows} className={cn(controlClasses, "min-h-24 resize-y", className)} {...props} />;
});

/** Every dropdown in the app uses the custom `Dropdown`, never the browser's own picker. */
export { Dropdown } from "./select";

/** Muted prefix segment joined to the input, e.g. `events.example.org/`. */
export const PrefixInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { prefix: string }>(function PrefixInput(
  { prefix, className, ...props },
  ref,
) {
  return (
    <div className="flex min-h-11 w-full overflow-hidden rounded-md border border-line-strong bg-panel transition-colors duration-[var(--sw-dur-fast)] ease-yy hover:border-ink focus-within:border-accent focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--yy-focus)] has-[[aria-invalid=true]]:border-danger-fg">
      <span className="flex shrink-0 items-center border-r border-line bg-surface px-3 text-sm text-ink-muted">{prefix}</span>
      <input ref={ref} className={cn("min-w-0 flex-1 bg-transparent px-3.5 py-[9px] text-base text-ink placeholder:text-ink-muted outline-none", className)} {...props} />
    </div>
  );
});

/** Read-only value with a lock icon (e.g. an email you can't change). */
export function ReadOnlyValue({ id, value, action }: { id?: string; value: ReactNode; action?: ReactNode }) {
  return (
    <div id={id} className="flex items-center gap-2.5 min-h-11 rounded-md border border-line bg-surface px-3.5 py-[9px] text-base text-ink-secondary">
      {null}
      <span className="min-w-0 flex-1 truncate">{value}</span>
      {action}
    </div>
  );
}

export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "type">>(function PasswordInput({ className, ...props }, ref) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input ref={ref} type={visible ? "text" : "password"} className={cn(controlClasses, "pr-20", className)} {...props} />
      <button
        type="button"
        onClick={() => setVisible((value) => !value)}
        aria-pressed={visible}
        className="absolute right-0 top-1/2 inline-flex min-h-11 min-w-11 px-3 -translate-y-1/2 items-center justify-center rounded-md text-ink-muted hover:bg-muted hover:text-ink"
      >
        {visible ? <span className="inline-flex items-center justify-center text-xs font-semibold">Hide</span> : <span className="inline-flex items-center justify-center text-xs font-semibold">Show</span>}
      </button>
    </div>
  );
});

/** Search field with a leading icon and a clear button. */
export const SearchInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { onClear?: () => void }>(function SearchInput(
  { className, onClear, value, ...props },
  ref,
) {
  const hasValue = typeof value === "string" ? value.length > 0 : Boolean(value);
  return (
    <div className="relative">
      <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-ink-muted" />
      <input
        ref={ref}
        type="search"
        value={value}
        className={cn(controlClasses, searchClasses, "pl-11 pr-11 [&::-webkit-search-cancel-button]:appearance-none", className)}
        {...props}
      />
      {onClear && hasValue ? (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear search"
          className="absolute right-0 top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-md text-ink-muted hover:bg-muted hover:text-ink"
        >
          <span aria-hidden="true" className="inline-flex items-center justify-center text-xs font-semibold">×</span>
        </button>
      ) : null}
    </div>
  );
});
