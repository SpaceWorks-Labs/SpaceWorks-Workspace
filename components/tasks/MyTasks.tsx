"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { loadMyTasksTabAction } from "@/app/actions/myTasks";
import { setTaskCompletedAction } from "@/app/actions/tasks";
import { useToast } from "@/components/feedback/ToastProvider";
import { useRealtime } from "@/components/realtime/useRealtime";
import { CollapsibleSection, useOpenState } from "@/components/ui/collapsible-section";
import { EmptyState } from "@/components/ui/display";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import { DUE_BUCKETS, dueBucket } from "@/lib/tasks/due";
import { PRIORITY_RANK } from "@/lib/tasks/filters";
import { taskReference } from "@/lib/tasks/links";
import { MY_TASK_TABS, parseMyTasksTab, visibleMyTaskTabs, type MyTaskItem, type MyTasksTab, type QuickAddProject } from "@/lib/tasks/myTasks";
import type { LabelRef } from "@/lib/tasks/types";
import { MyTaskRow } from "./MyTaskRow";
import { MyTasksQuickAdd } from "./MyTasksQuickAdd";
import { TaskDrawer } from "./TaskDrawer";
import { useNow } from "./useNow";

const EMPTY: Record<MyTasksTab, string> = {
  assigned: "Nothing assigned to you right now.",
  "assigned-by-me": "You haven't assigned anything to other people.",
  team: "Nothing open for your team.",
  created: "You haven't created any tasks.",
};

const COLLAPSE_KEY = "sw:collapse:my-tasks";
/** Everything starts open except the undated bucket. */
const CLOSED_BY_DEFAULT = new Set(["none"]);

/**
 * My tasks in four tabs (assigned to me, assigned by me, my team, created by
 * me), each grouped by due date (overdue, today, this week, later, no date).
 * Ticking a task completes it at once; it stays in place, struck through, so
 * a mis-tap is one more tap to undo. The tab lives in `?tab=`.
 */
export function MyTasks({
  slug,
  viewerId,
  initial,
  initialTab,
  hasTeam,
  projects,
  labels,
  timeZone,
  projectsHref,
}: {
  slug: string;
  viewerId: string;
  initial: MyTaskItem[];
  initialTab: MyTasksTab;
  hasTeam: boolean;
  projects: QuickAddProject[];
  labels: LabelRef[];
  timeZone: string;
  projectsHref: string;
}) {
  const [tab, setTab] = useState(initialTab);
  const [tasks, setTasks] = useState(initial);
  const [open, setOpen] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const { showToast } = useToast();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(0);
  const tabRef = useRef(tab);

  const load = useCallback(
    async (target: MyTasksTab) => {
      const ticket = ++latest.current;
      try {
        const next = await loadMyTasksTabAction(slug, target);
        if (next && ticket === latest.current) {
          setTasks(next);
          setFailed(false);
        }
      } catch {
        if (ticket === latest.current) {
          setFailed(true);
          showToast("Couldn't load tasks. Try again.", "error");
        }
      } finally {
        if (ticket === latest.current) setLoading(false);
      }
    },
    [slug, showToast],
  );
  const reload = useCallback(() => load(tabRef.current), [load]);

  const changeTab = (value: string) => {
    const next = parseMyTasksTab(value);
    if (next === tabRef.current) return;
    tabRef.current = next;
    setTab(next);
    setFailed(false);
    setLoading(true);
    try {
      window.history.replaceState(null, "", next === "assigned" ? window.location.pathname : `${window.location.pathname}?tab=${next}`);
    } catch {
      /* the tab still works without a URL update */
    }
    void load(next);
  };

  useRealtime(
    slug,
    useCallback(
      (event) => {
        if (!event.channel.startsWith("project:") && !event.channel.startsWith("user:")) return;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void reload(), 400);
      },
      [reload],
    ),
  );

  const sections = useOpenState(COLLAPSE_KEY);

  const now = useNow();
  const groups = useMemo(() => {
    const sorted = [...tasks].sort((a, b) => {
      const da = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
      const db = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
      return da - db || PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || b.number - a.number;
    });
    return {
      openCount: tasks.filter((task) => !task.completedAt).length,
      sections: DUE_BUCKETS.map((bucket) => ({ ...bucket, tasks: sorted.filter((task) => dueBucket(task.dueAt, now, timeZone) === bucket.key) })).filter((section) => section.tasks.length > 0),
    };
  }, [tasks, now, timeZone]);

  const toggle = async (task: MyTaskItem, completed: boolean) => {
    const revert = () => setTasks((list) => list.map((item) => (item.id === task.id ? { ...item, completedAt: task.completedAt } : item)));
    setTasks((list) => list.map((item) => (item.id === task.id ? { ...item, completedAt: completed ? new Date().toISOString() : null } : item)));
    const reference = taskReference(task.projectKey, task.number);
    try {
      const result = await setTaskCompletedAction(slug, { taskId: task.id, completed });
      if (!result.ok) {
        revert();
        showToast(result.error, "error");
        return;
      }
      showToast(completed ? `${reference} done. Nice work.` : `${reference} reopened.`, "success", completed ? { label: "Undo", onClick: () => void toggle({ ...task, completedAt: new Date().toISOString() }, false) } : null);
    } catch {
      revert();
      showToast("Couldn't save. Try again.", "error");
    }
  };

  const tabs = visibleMyTaskTabs(hasTeam);
  const description = MY_TASK_TABS.find((item) => item.value === tab)?.description;

  return (
    <div className="flex flex-col gap-6">
      <MyTasksQuickAdd slug={slug} viewerId={viewerId} projects={projects} onCreated={reload} />
      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList aria-label="My tasks views">
          {tabs.map((item) => (
            <TabsTrigger key={item.value} value={item.value}>
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={tab} className="flex flex-col gap-8">
          {loading ? (
            <p className="text-body-ui text-ink-muted" role="status">
              Loading tasks.
            </p>
          ) : failed ? (
            <EmptyState title="Couldn't load these tasks." action={<button type="button" onClick={() => void load(tab)} className="font-semibold text-ink underline underline-offset-4">Try again</button>}>
              Your connection may have dropped.
            </EmptyState>
          ) : tasks.length === 0 ? (
            <EmptyState patch title={EMPTY[tab]} action={tab === "assigned" ? <Link href={projectsHref} className="font-semibold text-ink underline underline-offset-4">Browse projects</Link> : undefined}>
              {description}
            </EmptyState>
          ) : (
            <>
              <p className="text-body-ui text-ink-secondary" aria-live="polite">
                {groups.openCount === 0 ? "All done. Enjoy the build night." : `${groups.openCount} open ${groups.openCount === 1 ? "task" : "tasks"}.`}
              </p>
              {groups.sections.map((section) => (
                <CollapsibleSection
                  key={section.key}
                  id={`bucket-${section.key}`}
                  heading="h2"
                  open={sections.isOpen(section.key, !CLOSED_BY_DEFAULT.has(section.key))}
                  onOpenChange={(open) => sections.setOpen(section.key, open)}
                  title={section.label}
                  count={section.tasks.length}
                  className="flex flex-col gap-2"
                  toggleClassName={cn("text-h4", section.key === "overdue" ? "text-danger-fg" : "text-ink")}
                  bodyClassName="flex flex-col"
                >
                  <ul className="divide-y divide-line rounded-xl border border-line bg-panel">
                    {section.tasks.map((task) => (
                      <MyTaskRow key={task.id} task={task} tab={tab} labels={labels} timeZone={timeZone} now={now} onOpen={setOpen} onToggle={(item, completed) => void toggle(item, completed)} />
                    ))}
                  </ul>
                </CollapsibleSection>
              ))}
            </>
          )}
        </TabsContent>
      </Tabs>
      <TaskDrawer slug={slug} number={open} onClose={() => setOpen(null)} onChanged={reload} />
    </div>
  );
}
