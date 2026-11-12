"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { deleteTaskViewAction, loadTaskViewsAction, saveTaskViewAction } from "@/app/actions/taskViews";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/choice";
import { Input } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/menu";
import type { TaskQuery } from "@/lib/tasks/filters";
import { deserializeQuery, serializeQuery } from "@/lib/tasks/rememberedQuery";
import type { TaskViewDTO } from "@/lib/tasks/views";

/**
 * Saved views of this project's board: pick one to apply its view, filters,
 * sort and grouping; save the current ones under a name (private, or shared
 * with the workspace). Stored on the shared SavedView model.
 */
export function TaskViews({ slug, projectKey, query, onApply, canShare }: { slug: string; projectKey: string; query: TaskQuery; onApply: (query: TaskQuery) => void; canShare: boolean }) {
  const [views, setViews] = useState<TaskViewDTO[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();

  const refresh = useCallback(async () => {
    try {
      setViews(await loadTaskViewsAction(slug, projectKey));
    } catch {
      setViews([]);
    }
  }, [slug, projectKey]);
  useEffect(() => {
    // Load on mount and after every save or removal.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const save = async () => {
    setBusy(true);
    try {
      const result = await saveTaskViewAction(slug, { projectKey, name, state: serializeQuery(query), shared: canShare && shared });
      if (!result.ok) return showToast(result.error, "error");
      showToast("View saved.", "success");
      setName("");
      setShared(false);
      await refresh();
    } catch {
      showToast("Couldn't save the view. Try again.", "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (view: TaskViewDTO) => {
    try {
      const result = await deleteTaskViewAction(slug, view.id);
      if (!result.ok) return showToast(result.error, "error");
      showToast(`Removed ${view.name}.`, "success");
      await refresh();
    } catch {
      showToast("Couldn't remove the view. Try again.", "error");
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm" endIcon={<ChevronsUpDown />}>
          Views
          {views.length ? <span className="rounded-full bg-primary px-1.5 text-xs tabular-nums text-on-primary">{views.length}</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-[min(92vw,320px)] flex-col gap-3">
        {views.length === 0 ? (
          <p className="text-body-ui text-ink-muted">No saved views yet. Set up the filters, then save them here.</p>
        ) : (
          <ul aria-label="Saved views" className="flex max-h-64 flex-col overflow-y-auto">
            {views.map((view) => (
              <li key={view.id} className="flex items-center gap-1">
                <button
                  type="button"
                  className="flex min-h-11 min-w-0 flex-1 flex-col items-start justify-center rounded-md px-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-[var(--yy-focus)]"
                  onClick={() => {
                    const next = deserializeQuery(view.state);
                    if (next) onApply(next);
                    setOpen(false);
                  }}
                >
                  <span className="w-full truncate text-body-ui font-medium text-ink">{view.name}</span>
                  <span className="text-caption text-ink-muted">{view.shared ? "Shared with the workspace" : "Only you"}</span>
                </button>
                {view.mine ? (
                  <Button variant="quiet" size="sm" aria-label={`Remove view ${view.name}`} onClick={() => void remove(view)}>
                    Remove
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-col gap-2 border-t border-line pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) void save();
          }}
        >
          <Input aria-label="View name" placeholder="Name this view" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
          {canShare ? <CheckboxField label="Share with the workspace" checked={shared} onCheckedChange={(checked) => setShared(checked === true)} /> : null}
          <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!name.trim()}>
            Save current view
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
