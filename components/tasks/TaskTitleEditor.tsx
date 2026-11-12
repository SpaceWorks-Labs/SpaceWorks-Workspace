"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export function TitleEditor({ value, editable, onSave, as }: { value: string; editable: boolean; onSave: (title: string) => Promise<boolean>; as: "h1" | "h2" }) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
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
  const commit = async () => {
    const next = draft.replace(/\s+/g, " ").trim();
    if (!next) return setDraft(value);
    if (next !== value && !(await onSave(next))) setDraft(value);
  };
  return (
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
            setDraft(value);
            event.currentTarget.blur();
          }
        }}
        className={cn(
          "block w-full resize-none overflow-hidden rounded-md border border-transparent bg-transparent px-2 py-1 -mx-2 font-sans font-semibold text-ink hover:border-line focus:border-accent focus:bg-panel focus:outline-none",
          as === "h1" ? "text-h1" : "text-h3",
        )}
      />
    </Heading>
  );
}
