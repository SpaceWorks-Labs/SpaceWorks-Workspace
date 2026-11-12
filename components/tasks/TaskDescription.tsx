"use client";

import { useCallback, useState } from "react";
import { updateTaskAction, uploadDescriptionImageAction } from "@/app/actions/tasks";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import type { TaskDetailDTO } from "@/lib/tasks/types";
import { RichTextEditor, RichTextView, type UploadImage } from "./RichTextEditor";

/**
 * The description: read view, and an editor with image paste/drop/upload.
 * A save sends the description the editor started from; if someone else
 * changed it meanwhile, or their change arrives while the editor holds
 * unsaved text, an inline Callout offers to reload instead of overwriting.
 */
export function TaskDescription({ slug, task, canEdit, reload }: { slug: string; task: TaskDetailDTO; canEdit: boolean; reload: () => Promise<void> }) {
  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  /** The description when the editor opened: the baseline for "did it change underneath me". */
  const [base, setBase] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const current = task.description ?? null;
  const dirty = editing && draft !== (base ?? "");
  const stale = editing && (conflict || (dirty && current !== base));

  const open = () => {
    setBase(current);
    setDraft(current ?? "");
    setConflict(false);
    setEditing(true);
  };
  const close = () => {
    setEditing(false);
    setConflict(false);
  };

  const save = async () => {
    setBusy(true);
    try {
      const result = await updateTaskAction(slug, { taskId: task.id, description: draft || null, expectedDescription: base });
      if (!result.ok) {
        if (result.fieldErrors?.conflict) setConflict(true);
        else showToast(result.error, "error");
        return;
      }
      await reload();
      close();
    } catch {
      showToast("Couldn't save. Check your connection and try again.", "error");
    } finally {
      setBusy(false);
    }
  };

  const upload = useCallback<UploadImage>(
    async (file) => {
      try {
        const form = new FormData();
        form.set("taskId", task.id);
        form.set("file", file);
        const result = await uploadDescriptionImageAction(slug, form);
        if (!result.ok || !result.data) {
          showToast(result.ok ? "Couldn't add that image." : result.error, "error");
          return null;
        }
        return { url: result.data.url, alt: result.data.alt };
      } catch {
        showToast("Couldn't add that image. Check your connection and try again.", "error");
        return null;
      }
    },
    [slug, task.id, showToast],
  );

  return (
    <section aria-labelledby={`desc-${task.id}`} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 id={`desc-${task.id}`} className="text-title text-ink">
          Description
        </h3>
        {canEdit && !editing ? (
          <Button variant="ghost" size="sm" onClick={open}>
            {task.description ? "Edit" : "Add description"}
          </Button>
        ) : null}
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          {stale ? (
            <Callout
              tone="warning"
              role="alert"
              title="Someone changed this description while you were editing."
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    close();
                    void reload();
                  }}
                >
                  Reload
                </Button>
              }
            >
              Your edit isn&apos;t saved. Reload to see their version, then make your change again.
            </Callout>
          ) : null}
          <RichTextEditor initialHtml={task.description ?? ""} onChange={setDraft} autoFocus onUploadImage={upload} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={close}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" loading={busy} disabled={stale} onClick={() => void save()}>
              Save description
            </Button>
          </div>
        </div>
      ) : task.description ? (
        <RichTextView html={task.description} />
      ) : (
        <p className="text-body-ui text-ink-muted">{canEdit ? "Add the details someone needs to pick this up." : "No description."}</p>
      )}
    </section>
  );
}
