"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ProjectStatus } from "@prisma/client";
import { archiveProjectAction, restoreProjectAction, updateProjectAction } from "@/app/actions/projects";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Card, DangerZone, SettingsRow } from "@/components/ui/display";
import { Dropdown, Field, Input, Textarea } from "@/components/ui/field";
import type { PersonRef, ProjectSummary } from "@/lib/tasks/types";

/** Project details (ADMIN or the project owner) in three sections (Basics, Ownership, Task rules; the task types slot sits in Task rules) plus archive / restore. */
export function ProjectSettingsForm({ slug, project, members, teams, taskTypes }: { slug: string; project: ProjectSummary; members: PersonRef[]; teams: Array<{ id: string; name: string }>; taskTypes: ReactNode }) {
  const router = useRouter();
  const { showToast } = useToast();
  const archived = project.status === "ARCHIVED";
  const [form, setForm] = useState({
    cyclesEnabled: project.cyclesEnabled,
    restrictTaskEdits: project.restrictTaskEdits,
    name: project.name,
    key: project.key,
    description: project.description ?? "",
    ownerId: project.ownerId ?? "",
    teamId: project.teamId ?? "",
    status: (archived ? "ACTIVE" : project.status) as Exclude<ProjectStatus, "ARCHIVED">,
    startsOn: project.startsOn ?? "",
    dueOn: project.dueOn ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setBusy(true);
    const result = await updateProjectAction(slug, { projectId: project.id, ...form, ownerId: form.ownerId || null, teamId: form.teamId || null, startsOn: form.startsOn || null, dueOn: form.dueOn || null }, project.key);
    setBusy(false);
    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      showToast(result.error, "error");
      return;
    }
    setErrors({});
    showToast("Project saved.", "success");
    if (result.data?.key && result.data.key !== project.key) router.replace(`/w/${slug}/projects/${result.data.key}/settings`);
    else router.refresh();
  };

  const toggleArchive = async () => {
    setBusy(true);
    const result = archived ? await restoreProjectAction(slug, { projectId: project.id }, project.key) : await archiveProjectAction(slug, { projectId: project.id }, project.key);
    setBusy(false);
    setConfirm(false);
    if (!result.ok) return showToast(result.error, "error");
    showToast(archived ? "Project restored." : "Project archived. You can restore it here any time.", "success");
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={archived || busy} className="contents">
          <section aria-labelledby="settings-basics" className="flex flex-col gap-3">
            <h2 id="settings-basics" className="text-title text-ink">Basics</h2>
            <Card padding="lg">
              <SettingsRow title="Name and key" description="Changing the key updates every task reference. Links to existing tasks keep working.">
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_160px]">
                  <Field label="Name" error={errors.name?.[0]}>
                    <Input value={form.name} onChange={(event) => set("name", event.target.value)} maxLength={80} required />
                  </Field>
                  <Field label="Key" error={errors.key?.[0]}>
                    <Input value={form.key} onChange={(event) => set("key", event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} maxLength={10} required className="uppercase tabular-nums" />
                  </Field>
                </div>
              </SettingsRow>
              <SettingsRow title="Description">
                <Field label="Description" hideLabel error={errors.description?.[0]}>
                  <Textarea value={form.description} onChange={(event) => set("description", event.target.value)} rows={4} maxLength={2000} />
                </Field>
              </SettingsRow>
              <SettingsRow title="Status and dates">
                <div className="grid gap-4 xl:grid-cols-3">
                  <Field label="Status">
                    <Dropdown value={form.status} onChange={(event) => set("status", event.target.value as typeof form.status)}>
                      <option value="ACTIVE">Active</option>
                      <option value="PAUSED">Paused</option>
                      <option value="DONE">Done</option>
                    </Dropdown>
                  </Field>
                  <Field label="Start" optional>
                    <Input type="date" value={form.startsOn} onChange={(event) => set("startsOn", event.target.value)} />
                  </Field>
                  <Field label="Target" optional>
                    <Input type="date" value={form.dueOn} onChange={(event) => set("dueOn", event.target.value)} />
                  </Field>
                </div>
              </SettingsRow>
            </Card>
          </section>
          <section aria-labelledby="settings-ownership" className="flex flex-col gap-3">
            <h2 id="settings-ownership" className="text-title text-ink">Ownership</h2>
            <Card padding="lg">
              <SettingsRow title="Owner and team" description="The owner can edit the project and its columns. A private team's projects are visible only to its members and admins.">
                <div className="grid gap-4 xl:grid-cols-2">
                  <Field label="Owner">
                    <Dropdown value={form.ownerId} onChange={(event) => set("ownerId", event.target.value)}>
                      <option value="">No owner</option>
                      {members.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name ?? "Member"}
                        </option>
                      ))}
                    </Dropdown>
                  </Field>
                  <Field label="Team" error={errors.teamId?.[0]}>
                    <Dropdown value={form.teamId} onChange={(event) => set("teamId", event.target.value)}>
                      <option value="">Whole workspace</option>
                      {teams.map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </Dropdown>
                  </Field>
                </div>
              </SettingsRow>
            </Card>
          </section>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={busy} disabled={archived}>
              Save changes
            </Button>
          </div>
        </fieldset>
      </form>
      <section aria-labelledby="settings-rules" className="flex flex-col gap-3">
        <h2 id="settings-rules" className="text-title text-ink">Task rules</h2>
        {taskTypes}
        <Card padding="lg">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <fieldset disabled={archived || busy} className="contents">
              <SettingsRow title="Who can edit tasks" description="When on, only a task's creator, its assignees, the project owner and admins can edit it. Anyone can still comment, attach files, or take a task nobody has picked up.">
                <label className="flex min-h-11 items-center gap-3 text-label"><input type="checkbox" checked={form.restrictTaskEdits} onChange={(event) => set("restrictTaskEdits", event.target.checked)} />Restrict task edits</label>
              </SettingsRow>
              <SettingsRow title="Cycles" description="Plan time-boxed batches of work for this project.">
                <label className="flex min-h-11 items-center gap-3 text-label"><input type="checkbox" checked={form.cyclesEnabled} onChange={(event) => set("cyclesEnabled", event.target.checked)} />Enable cycles</label>
              </SettingsRow>
              <div className="flex justify-end pt-4">
                <Button type="submit" variant="primary" loading={busy} disabled={archived}>
                  Save task rules
                </Button>
              </div>
            </fieldset>
          </form>
        </Card>
      </section>
      <DangerZone
        title={archived ? "Restore this project" : "Archive this project"}
        description={archived ? "Bring the board back. Tasks become editable again." : "Archived projects leave the list and become read-only. Nothing is deleted."}
        action={
          archived ? (
            <Button variant="secondary" onClick={() => void toggleArchive()} loading={busy}>
              Restore project
            </Button>
          ) : (
            <Button variant="dangerOutline" onClick={() => setConfirm(true)}>
              Archive project…
            </Button>
          )
        }
      />
      <ConfirmDialog
        open={confirm}
        title={`Archive ${project.name}?`}
        message="The board becomes read-only and leaves the projects list. You can restore it later."
        confirmLabel="Archive project"
        loading={busy}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void toggleArchive()}
      />
    </div>
  );
}
