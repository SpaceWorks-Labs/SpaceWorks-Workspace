"use client";

import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { loadTaskAction } from "@/app/actions/tasks";
import { IconButton } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { EmptyState, Skeleton } from "@/components/ui/display";
import type { TaskDetailDTO } from "@/lib/tasks/types";
import { TaskDetail } from "./TaskDetail";

/** Side panel with the task detail, opened from the board, list or My tasks. */
export function TaskDrawer({ slug, number, onClose, onChanged }: { slug: string; number: number | null; onClose: () => void; onChanged?: () => void }) {
  const [state, setState] = useState<{ number: number; task: TaskDetailDTO | null } | null>(null);

  useEffect(() => {
    if (number === null) return;
    let cancelled = false;
    void loadTaskAction(slug, number)
      .then((task) => {
        if (!cancelled) setState({ number, task });
      })
      .catch(() => {
        if (!cancelled) setState({ number, task: null });
      });
    return () => {
      cancelled = true;
    };
  }, [slug, number]);

  const loaded = state && state.number === number ? state : null;

  return (
    <Dialog open={number !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        presentation="drawer"
        hideClose
        aria-describedby={undefined}
        className="left-auto right-0 top-0 h-dvh max-h-dvh w-full max-w-[760px] translate-x-0 translate-y-0 rounded-none border-y-0 border-r-0 sm:w-[92vw]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2 sm:px-6">
          <DialogPrimitive.Title className="text-label text-ink-muted">Task</DialogPrimitive.Title>
          <DialogClose asChild>
            <IconButton label="Close task">
              <span aria-hidden="true" className="inline-flex items-center justify-center text-xs font-semibold">×</span>
            </IconButton>
          </DialogClose>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {!loaded ? (
            <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading task">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-9 w-3/4" />
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : loaded.task ? (
            <div className="sw-fade-in"><TaskDetail slug={slug} initial={loaded.task} variant="drawer" onChanged={onChanged} /></div>
          ) : (
            <EmptyState title="That task isn't here.">It may have been archived, or you may not have access to it.</EmptyState>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
