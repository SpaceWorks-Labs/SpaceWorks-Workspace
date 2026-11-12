"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { LabelTone, TaskTypeIcon } from "@prisma/client";
import { createTaskTypeAction, deleteTaskTypeAction, reorderTaskTypesAction, setDefaultTaskTypeAction, updateTaskTypeAction } from "@/app/actions/taskTypes";
import { useToast } from "@/components/feedback/ToastProvider";
import { TypeChip } from "@/components/tasks/bits";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Card, SettingsRow } from "@/components/ui/display";
import { Dropdown, Input } from "@/components/ui/field";
import { LABEL_TONES } from "@/lib/labels";
import { MAX_TASK_TYPES, TASK_TYPE_ICONS, TASK_TYPE_ICON_LABELS, type TaskTypeRef } from "@/lib/tasks/taskTypes";

type TypeRow = TaskTypeRef & { taskCount: number };

function TypeEditor({ type, index, count, disabled, onSave, onDefault, onMove, onDelete }: {
  type: TypeRow;
  index: number;
  count: number;
  disabled: boolean;
  onSave: (patch: { name?: string; tone?: LabelTone; icon?: TaskTypeIcon }) => void;
  onDefault: () => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(type.name);
  return (
    <li className="flex flex-wrap items-center gap-2 py-2.5">
      <div className="w-28 shrink-0">
        <TypeChip type={{ ...type, name: name || type.name }} size="md" />
      </div>
      <Input aria-label={`Name of ${type.name}`} className="min-w-0 flex-1 basis-40" value={name} maxLength={30} disabled={disabled} onChange={(event) => setName(event.target.value)} onBlur={() => name.trim() && name.trim() !== type.name && onSave({ name })} />
      <Dropdown aria-label={`Colour of ${type.name}`} className="w-32" value={type.tone} disabled={disabled} onChange={(event) => onSave({ tone: event.target.value as LabelTone })}>
        {LABEL_TONES.map((tone) => (
          <option key={tone.value} value={tone.value}>
            {tone.label}
          </option>
        ))}
      </Dropdown>
      <Dropdown aria-label={`Icon of ${type.name}`} className="w-32" value={type.icon} disabled={disabled} onChange={(event) => onSave({ icon: event.target.value as TaskTypeIcon })}>
        {TASK_TYPE_ICONS.map((icon) => (
          <option key={icon} value={icon}>
            {TASK_TYPE_ICON_LABELS[icon]}
          </option>
        ))}
      </Dropdown>
      <div className="flex items-center gap-1">
        {type.isDefault ? <span className="px-2 text-caption font-semibold text-ink-secondary">Default</span> : <Button variant="quiet" size="sm" disabled={disabled} onClick={onDefault}>{`Make default`}<span className="sr-only">{` ${type.name}`}</span></Button>}
        <Button variant="quiet" size="sm" disabled={disabled || index === 0} onClick={() => onMove(-1)}>
          Up<span className="sr-only">{` ${type.name}`}</span>
        </Button>
        <Button variant="quiet" size="sm" disabled={disabled || index === count - 1} onClick={() => onMove(1)}>
          Down<span className="sr-only">{` ${type.name}`}</span>
        </Button>
        <Button variant="quiet" size="sm" disabled={disabled || type.isDefault} onClick={onDelete} title={type.taskCount ? `${type.taskCount} tasks use this type` : undefined}>
          Delete<span className="sr-only">{` ${type.name}`}</span>
        </Button>
      </div>
    </li>
  );
}

/** Per-project task types (project settings; ADMIN or the project owner). */
export function TaskTypesSettings({ slug, projectId, types, readOnly }: { slug: string; projectId: string; types: TypeRow[]; readOnly: boolean }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState<TypeRow | null>(null);

  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>, success?: string) => {
    setBusy(true);
    let result: { ok: boolean; error?: string };
    try {
      result = await fn();
    } catch {
      result = { ok: false, error: "Couldn't save. Check your connection and try again." };
    } finally {
      setBusy(false);
    }
    if (!result.ok) {
      showToast(result.error ?? "Couldn't save. Try again.", "error");
      return false;
    }
    if (success) showToast(success, "success");
    router.refresh();
    return true;
  };

  const move = (index: number, direction: -1 | 1) => {
    const ids = types.map((type) => type.id);
    const swap = index + direction;
    [ids[index], ids[swap]] = [ids[swap]!, ids[index]!];
    void act(() => reorderTaskTypesAction(slug, { projectId, typeIds: ids }));
  };

  return (
    <Card padding="lg">
      <SettingsRow title="Task types" description="Label tasks as a bug, feature or anything else this project needs. New tasks get the default type.">
        <ul className="flex flex-col divide-y divide-line">
          {types.map((type, index) => (
            // Keyed by name and tone so a refresh from the server resets the draft name.
            <TypeEditor
              key={`${type.id}-${type.name}`}
              type={type}
              index={index}
              count={types.length}
              disabled={readOnly || busy}
              onSave={(patch) => void act(() => updateTaskTypeAction(slug, { typeId: type.id, ...patch }), "Type saved.")}
              onDefault={() => void act(() => setDefaultTaskTypeAction(slug, { typeId: type.id }), `${type.name} is now the default.`)}
              onMove={(direction) => move(index, direction)}
              onDelete={() => setDeleting(type)}
            />
          ))}
        </ul>
        {readOnly ? null : (
          <form
            className="mt-3 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim()) return;
              void act(() => createTaskTypeAction(slug, { projectId, name }), "Type added.").then((ok) => ok && setName(""));
            }}
          >
            <Input aria-label="New type name" className="min-w-0 flex-1" placeholder={types.length >= MAX_TASK_TYPES ? "Type limit reached" : "New type name"} value={name} maxLength={30} disabled={busy || types.length >= MAX_TASK_TYPES} onChange={(event) => setName(event.target.value)} />
            <Button type="submit" variant="secondary" loading={busy} disabled={!name.trim() || types.length >= MAX_TASK_TYPES}>
              Add type
            </Button>
          </form>
        )}
      </SettingsRow>
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? "type"}?`}
        message={deleting?.taskCount ? `${deleting.taskCount} tasks use this type and will switch to the default type.` : "This type is not used by any task."}
        loading={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const type = deleting;
          if (!type) return;
          void act(() => deleteTaskTypeAction(slug, { typeId: type.id }), `${type.name} deleted.`).then(() => setDeleting(null));
        }}
      />
    </Card>
  );
}
