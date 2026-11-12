"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import { cn } from "@/lib/cn";

/** `"conflict"`: the server refused because someone else changed the title meanwhile. */
export type TitleSave = boolean | "conflict";

/**
 * The editable task title. If the title changes underneath an unsaved edit
 * (another person saved, or the save came back as a conflict) the draft is
 * kept and an inline Callout offers to reload the new title.
 */
export function TitleEditor({ value, editable, onSave, as }: { value: string; editable: boolean; onSave: (title: string) => Promise<TitleSave>; as: "h1" | "h2" }) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  const [stale, setStale] = useState(false);
  if (seen !== value) {
    setSeen(value);
    if (draft === seen) setDraft(value);
    else setStale(true);
  }
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);
  const Heading = as;
  if (!editable) return <Heading className={cn("break-words text-ink", as === "h1" ? "text-h1" : "text-h3")}>{value}</Heading>;
  const reload = () => {
    setDraft(value);
    setStale(false);
  };
  const commit = async () => {
    if (stale) return;
    const next = draft.replace(/\s+/g, " ").trim();
    if (!next) return setDraft(value);
    if (next === value) return;
    const result = await onSave(next);
    if (result === "conflict") setStale(true);
    else if (!result) setDraft(value);
  };
  return (
    <div className="flex flex-col gap-2">
      <Heading className="m-0">
        <textarea
          ref={ref}
          value={draft}
          rows={1}
          maxLength={200}
          aria-label="Task title"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              reload();
              event.currentTarget.blur();
            }
          }}
          className={cn(
            "block w-full resize-none overflow-hidden rounded-md border border-transparent bg-transparent px-2 py-1 -mx-2 font-sans font-semibold text-ink hover:border-line focus:border-accent focus:bg-panel focus:outline-none",
            as === "h1" ? "text-h1" : "text-h3",
          )}
        />
      </Heading>
      {stale ? (
        <Callout
          tone="warning"
          role="alert"
          title="Someone changed the title while you were editing."
          action={
            <Button size="sm" variant="secondary" onClick={reload}>
              Reload
            </Button>
          }
        >
          Your edit isn&apos;t saved. Reload to see their title.
        </Callout>
      ) : null}
    </div>
  );
}
