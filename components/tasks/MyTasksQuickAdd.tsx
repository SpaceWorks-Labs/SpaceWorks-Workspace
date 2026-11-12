"use client";

import { useState } from "react";
import { createTaskAction } from "@/app/actions/tasks";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/choice";
import { Dropdown, Input } from "@/components/ui/field";
import type { QuickAddProject } from "@/lib/tasks/myTasks";

/** Compact "add a task" row on My tasks: title, project, and "Assign to me" (on by default). */
export function MyTasksQuickAdd({ slug, viewerId, projects, onCreated }: { slug: string; viewerId: string; projects: QuickAddProject[]; onCreated: () => void | Promise<void> }) {
  const { showToast } = useToast();
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [assignMe, setAssignMe] = useState(true);
  const [busy, setBusy] = useState(false);
  if (projects.length === 0) return null;

  const submit = async () => {
    const text = title.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const result = await createTaskAction(slug, { projectId, title: text, assigneeIds: assignMe ? [viewerId] : [] });
      if (!result.ok) {
        showToast(result.error, "error");
        return;
      }
      setTitle("");
      showToast(`Added ${result.data?.reference ?? "task"}.`, "success");
      await onCreated();
    } catch {
      showToast("Couldn't save. Check your connection and try again.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      aria-label="Add a task"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-2 rounded-xl border border-line bg-panel p-3 sm:flex-row sm:items-center"
    >
      <div className="min-w-0 flex-1">
        <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder="Add a task, then Enter" aria-label="New task title" />
      </div>
      <div className="w-full sm:w-[200px]">
        <Dropdown aria-label="Project" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </Dropdown>
      </div>
      <CheckboxField label="Assign to me" checked={assignMe} onCheckedChange={(checked) => setAssignMe(checked === true)} />
      <Button type="submit" variant="primary" size="sm" loading={busy} loadingLabel="Adding" disabled={!title.trim()}>
        Add
      </Button>
    </form>
  );
}
