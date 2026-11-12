"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { createTaskAction, loadBoardAction, moveTaskAction, setTaskCompletedAction } from "@/app/actions/tasks";
import { useRealtime } from "@/components/realtime/useRealtime";
import { Callout } from "@/components/ui/display";
import { activeFilterCount, matchesFilters, parseTaskQuery, taskQueryToParams, type TaskQuery } from "@/lib/tasks/filters";
import { taskReference } from "@/lib/tasks/links";
import { useNow } from "./useNow";
import { applyOptimisticMove, buildLayout, relativeAfterId, type RelativeMove } from "@/lib/tasks/boardMoves";
import type { BoardData, BoardTask } from "@/lib/tasks/types";
import { FilterBar } from "./FilterBar";
import { ListView } from "./ListView";
import type { CardMove } from "./TaskCard";
import { BoardView } from "./board/BoardView";
import { TaskDrawer } from "./TaskDrawer";
import { useDensity } from "./useDensity";
import { useTaskShortcuts } from "./useTaskShortcuts";
import { useBoardAssignment } from "./useAssignment";
import { useTaskRunner } from "./useTaskRunner";

/**
 * The project board and list. Cards move by drag and drop (pointer, touch,
 * keyboard: see board/) or with each card's Move menu; changes show immediately and are rolled back if the
 * server refuses. Other people's changes arrive over realtime
 * (`project:<id>`) and trigger a refetch. Filters, view, sorting and the
 * open task live in the URL.
 */
export function ProjectBoard({ slug, initial, viewerId, timeZone }: { slug: string; initial: BoardData; viewerId: string; timeZone: string }) {
  const [data, setData] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    // The server re-rendered (e.g. after a column change): take the fresh data.
    setSeen(initial);
    setData(initial);
  }
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = useMemo(() => parseTaskQuery(new URLSearchParams(searchParams.toString())), [searchParams]);
  const openNumber = Number(searchParams.get("task")) || null;
  const [focusId, setFocusId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [density, setDensity] = useDensity();
  useTaskShortcuts({ searchRef, board: query.view === "board" });
  const dragging = useRef(false);
  const stale = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = data.project.key;
  const projectId = data.project.id;

  const reload = useCallback(async () => {
    const next = await loadBoardAction(slug, key);
    if (next) setData(next);
  }, [slug, key]);
  const run = useTaskRunner(reload);
  const assign = useBoardAssignment(slug, viewerId, setData, reload);

  useRealtime(
    slug,
    useCallback(
      (event) => {
        if (event.channel !== `project:${projectId}`) return;
        if (dragging.current) {
          stale.current = true;
          return;
        }
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void reload(), 250);
      },
      [projectId, reload],
    ),
  );

  /** A drag in progress holds back realtime refetches; the missed one runs when it ends. */
  const onActiveChange = useCallback(
    (active: boolean) => {
      dragging.current = active;
      if (!active && stale.current) {
        stale.current = false;
        void reload();
      }
    },
    [reload],
  );

  useEffect(() => {
    if (!focusId) return;
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-card-focus="${focusId}"]`)?.focus();
      setFocusId(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusId, data]);

  const writeUrl = useCallback(
    (next: TaskQuery, task: number | null, push = false) => {
      const params = taskQueryToParams(next);
      if (task) params.set("task", String(task));
      const url = `${pathname}${params.size ? `?${params.toString()}` : ""}`;
      if (push) window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    },
    [pathname],
  );

  const now = useNow();
  const context = useMemo(() => ({ userId: viewerId, now, timeZone }), [viewerId, now, timeZone]);
  const visible = useMemo(() => data.tasks.filter((task) => matchesFilters(task, query.filters, context)), [data.tasks, query.filters, context]);
  const filtered = activeFilterCount(query.filters) > 0;

  /** Show the move at once, send it, and put the board back (with the server's message) if refused. */
  const applyMove = useCallback(
    async (task: BoardTask, columnId: string, afterTaskId: string | null, success?: string) => {
      const original = data.tasks.find((item) => item.id === task.id) ?? task;
      setData({ ...data, tasks: applyOptimisticMove(data.tasks, data.columns, task.id, columnId, afterTaskId) });
      const ok = await run(() => moveTaskAction(slug, { taskId: task.id, columnId, afterTaskId }), success);
      // Put back only the moved card; other edits that landed meanwhile stay.
      if (!ok) setData((current) => ({ ...current, tasks: current.tasks.map((item) => (item.id === task.id ? original : item)) }));
    },
    [data, run, slug],
  );

  const onCommit = useCallback(
    (task: BoardTask, columnId: string, afterTaskId: string | null, movedColumn: boolean) => {
      setFocusId(task.id);
      const column = data.columns.find((item) => item.id === columnId);
      void applyMove(task, columnId, afterTaskId, movedColumn ? `Moved ${taskReference(key, task.number)} to ${column?.name ?? "the column"}.` : undefined);
    },
    [applyMove, data.columns, key],
  );

  const onMove = useCallback(
    (task: BoardTask, move: CardMove) => {
      const reference = taskReference(key, task.number);
      if (move.kind === "column") {
        onCommit(task, move.columnId, null, true);
        return;
      }
      if (!task.columnId) return;
      const layout = buildLayout(data.columns, visible);
      const after = relativeAfterId(layout[task.columnId] ?? [], task.id, move.kind as RelativeMove);
      const label = { up: "up", down: "down", top: "to the top", bottom: "to the bottom" }[move.kind];
      setFocusId(task.id);
      void applyMove(task, task.columnId, after, `Moved ${reference} ${label}.`);
    },
    [applyMove, data.columns, key, onCommit, visible],
  );

  /** Resolves with whether the task was added; `openAfter` (Shift+Enter) opens it. */
  const createIn = useCallback(
    async (columnId: string, title: string, options: { openAfter: boolean }) => {
      let created: number | null = null;
      const ok = await run(
        () => createTaskAction(slug, { projectId, columnId, title }),
        (task) => {
          created = task?.number ?? null;
          return task ? `Added ${task.reference}.` : null;
        },
      );
      if (ok && options.openAfter && created) writeUrl(query, created, true);
      return ok;
    },
    [projectId, query, run, slug, writeUrl],
  );

  const openTask = useCallback((number: number) => writeUrl(query, number, true), [query, writeUrl]);
  const closeTask = useCallback(() => writeUrl(query, null), [query, writeUrl]);

  return (
    <div className="flex flex-col gap-5">
      <FilterBar
        query={query}
        onChange={(next) => writeUrl(next, openNumber)}
        members={data.members}
        labels={data.labels}
        taskTypes={data.taskTypes}
        slug={slug}
        projectKey={key}
        canShareViews={data.permissions.canEdit}
        density={density}
        onDensityChange={setDensity}
        searchRef={searchRef}
      />
      {data.project.status === "ARCHIVED" ? (
        <Callout tone="info" title="This project is archived.">
          The board is read-only until someone restores it in the project settings.
        </Callout>
      ) : null}
      {filtered ? (
        <p className="text-caption text-ink-muted" aria-live="polite">
          Showing {visible.length} of {data.tasks.length} tasks.
        </p>
      ) : null}

      {query.view === "list" ? (
        <ListView
          data={data}
          tasks={visible}
          sort={query.sort}
          dir={query.dir}
          group={query.group}
          query={query}
          onQueryChange={(next) => writeUrl(next, openNumber)}
          timeZone={timeZone}
          slug={slug}
          viewerId={viewerId}
          onChanged={reload}
          onOpen={openTask}
          onComplete={(task, completed) => void run(() => setTaskCompletedAction(slug, { taskId: task.id, completed }), completed ? `${taskReference(key, task.number)} done.` : `${taskReference(key, task.number)} reopened.`)}
        />
      ) : (
        <BoardView
          slug={slug}
          data={data}
          visible={visible}
          group={query.group}
          filtered={filtered}
          compact={density === "compact"}
          timeZone={timeZone}
          run={run}
          onOpen={openTask}
          onMove={onMove}
          onCommit={onCommit}
          onClaim={(item) => void assign({ id: item.id, reference: taskReference(key, item.number), assigneeIds: item.assigneeIds }, "claim")}
          onCreate={createIn}
          onActiveChange={onActiveChange}
        />
      )}
      <TaskDrawer slug={slug} number={openNumber} onClose={closeTask} onChanged={reload} />
    </div>
  );
}
