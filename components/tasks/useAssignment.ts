"use client";

import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { claimTaskAction, unclaimTaskAction } from "@/app/actions/taskAssign";
import { useToast } from "@/components/feedback/ToastProvider";
import { taskReference } from "@/lib/tasks/links";
import type { BoardData, TaskDetailDTO } from "@/lib/tasks/types";

export type AssignMode = "claim" | "unclaim";
type Target = { id: string; reference: string; assigneeIds: string[] };

/**
 * Take or give up a task for the signed-in person. The change shows at once
 * through `apply(taskId, assigneeIds)`, is rolled back with the server's
 * message if refused, and success toasts offer Undo. `refresh` refetches the
 * authoritative state (rights such as canClaim depend on the whole assignee set).
 */
export function useAssignment(slug: string, viewerId: string, apply: (taskId: string, assigneeIds: string[]) => void, refresh?: () => void | Promise<void>) {
  const { showToast } = useToast();
  const self = useRef<((target: Target, mode: AssignMode, isUndo?: boolean) => Promise<boolean>) | null>(null);
  const run = useCallback(
    async (target: Target, mode: AssignMode, isUndo = false): Promise<boolean> => {
      const before = target.assigneeIds;
      const next = mode === "claim" ? [...before.filter((id) => id !== viewerId), viewerId] : before.filter((id) => id !== viewerId);
      apply(target.id, next);
      let result;
      try {
        result = await (mode === "claim" ? claimTaskAction : unclaimTaskAction)(slug, { taskId: target.id });
      } catch {
        result = { ok: false as const, error: "Couldn't save. Check your connection and try again." };
      }
      if (!result.ok) {
        apply(target.id, before);
        showToast(result.error, "error");
        // apply() clears the claim rights while the change is pending; the server's state restores them.
        await refresh?.();
        return false;
      }
      apply(target.id, result.data?.assigneeIds ?? next);
      const undo = isUndo
        ? null
        : { label: "Undo", onClick: () => void self.current?.({ ...target, assigneeIds: result.data?.assigneeIds ?? next }, mode === "claim" ? "unclaim" : "claim", true) };
      showToast(mode === "claim" ? "Assigned to you" : "Unassigned", "success", undo, 6000);
      await refresh?.();
      return true;
    },
    [slug, viewerId, apply, refresh, showToast],
  );
  useEffect(() => {
    self.current = run;
  }, [run]);
  return run;
}

/** Board variant: patches the card in place (rights are recomputed by `refresh`). */
export function useBoardAssignment(slug: string, viewerId: string, setData: Dispatch<SetStateAction<BoardData>>, refresh: () => void | Promise<void>) {
  const apply = useCallback(
    (taskId: string, assigneeIds: string[]) =>
      setData((data) => ({
        ...data,
        tasks: data.tasks.map((task) => {
          if (task.id !== taskId) return task;
          const mine = assigneeIds.includes(viewerId);
          return { ...task, assigneeIds, isAssignedToMe: mine, canClaim: false, canUnclaim: mine };
        }),
      })),
    [setData, viewerId],
  );
  return useAssignment(slug, viewerId, apply, refresh);
}

const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * Task panel variant: the primary "Assign to me" / "Unassign me" action and,
 * in the drawer, the `i` shortcut (ignored while typing or with modifiers).
 */
export function useDetailAssignment(slug: string, task: TaskDetailDTO, setTask: Dispatch<SetStateAction<TaskDetailDTO>>, refresh: () => void | Promise<void>, shortcut: boolean) {
  const apply = useCallback(
    (_taskId: string, ids: string[]) =>
      setTask((current) => {
        const mine = ids.includes(current.viewerId);
        return { ...current, assignees: ids.map((id) => current.members.find((member) => member.id === id) ?? { id, name: "Member", image: null }), isAssignedToMe: mine, canClaim: false, canUnclaim: mine };
      }),
    [setTask],
  );
  const run = useAssignment(slug, task.viewerId, apply, refresh);
  const mode: AssignMode | null = task.archivedAt ? null : task.canUnclaim ? "unclaim" : task.canClaim ? "claim" : null;
  const toggle = useCallback(() => {
    if (mode) void run({ id: task.id, reference: taskReference(task.project?.key, task.number), assigneeIds: task.assignees.map((person) => person.id) }, mode);
  }, [mode, run, task]);
  const latest = useRef(toggle);
  useEffect(() => {
    latest.current = toggle;
  }, [toggle]);
  useEffect(() => {
    if (!shortcut) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "i" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.repeat || isTyping(event.target)) return;
      if (document.querySelector('[role="menu"], [role="listbox"]')) return;
      const dialogs = document.querySelectorAll('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]');
      if (dialogs.length > 1) return;
      const target = event.target;
      if (dialogs.length === 1 && target instanceof Node && target !== document.body && target !== document.documentElement && !dialogs[0].contains(target)) return;
      event.preventDefault();
      latest.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcut]);
  return { mode, toggle };
}
