"use client";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";

/**
 * Add tasks to a column. Stays open after Enter for rapid entry; Shift+Enter
 * adds the task and opens it; Escape closes and returns focus to the button.
 */
export function QuickAdd({ onCreate, open, onOpenChange }: { onCreate: (title: string, options: { openAfter: boolean }) => Promise<boolean>; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  const close = () => {
    onOpenChange(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  const submit = async (openAfter: boolean) => {
    const value = title.trim();
    if (!value || busy) return;
    setBusy(true);
    const ok = await onCreate(value, { openAfter });
    setBusy(false);
    if (ok) setTitle("");
  };

  if (!open) {
    return (
      <Button ref={trigger} variant="quiet" size="sm" startIcon={<Plus />} onClick={() => onOpenChange(true)} className="justify-start">
        Add task
      </Button>
    );
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit(false);
      }}
      className="flex flex-col gap-2"
    >
      <Input
        autoFocus
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        maxLength={200}
        placeholder="Task title, then Enter"
        aria-label="New task title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            close();
          } else if (event.key === "Enter" && event.shiftKey) {
            event.preventDefault();
            void submit(true);
          }
        }}
      />
      <p className="text-caption text-ink-muted">Enter adds another. Shift+Enter adds and opens. Esc closes.</p>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!title.trim()}>
          Add
        </Button>
        <Button variant="secondary" size="sm" onClick={close}>
          Done
        </Button>
      </div>
    </form>
  );
}
