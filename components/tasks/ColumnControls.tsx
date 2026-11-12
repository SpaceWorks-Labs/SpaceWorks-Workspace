"use client";

import { useState } from "react";
import type { ColumnCategory, LabelTone } from "@prisma/client";
import { Ellipsis, Plus } from "lucide-react";
import { addColumnAction, deleteColumnAction, reorderColumnsAction, updateColumnAction } from "@/app/actions/projects";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Dropdown, Field, Input } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { COLUMN_CATEGORY_LABELS } from "@/lib/projects/keys";
import { LABEL_TONES } from "@/lib/labels";
import type { ColumnDTO } from "@/lib/tasks/types";
import type { RunAction } from "./useTaskRunner";

const CATEGORIES: ColumnCategory[] = ["TODO", "IN_PROGRESS", "DONE"];

function CategorySelect({ value, onChange }: { value: ColumnCategory; onChange: (value: ColumnCategory) => void }) {
  return (
    <Dropdown value={value} onChange={(event) => onChange(event.target.value as ColumnCategory)}>
      {CATEGORIES.map((category) => (
        <option key={category} value={category}>
          {COLUMN_CATEGORY_LABELS[category]}
        </option>
      ))}
    </Dropdown>
  );
}

/** Column header menu for admins and the project owner: rename, move, delete. */
export function ColumnMenu({ slug, projectId, projectKey, column, columns, taskCount, run }: { slug: string; projectId: string; projectKey: string; column: ColumnDTO; columns: ColumnDTO[]; taskCount: number; run: RunAction }) {
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null);
  const [name, setName] = useState(column.name);
  const [category, setCategory] = useState<ColumnCategory>(column.category);
  const [color, setColor] = useState<LabelTone | "">(column.color ?? "");
  const [limit, setLimit] = useState(column.wipLimit ? String(column.wipLimit) : "");
  const others = columns.filter((item) => item.id !== column.id);
  const [target, setTarget] = useState(others[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const index = columns.findIndex((item) => item.id === column.id);

  const reorder = (direction: -1 | 1) => {
    const ids = columns.map((item) => item.id);
    const swap = index + direction;
    if (swap < 0 || swap >= ids.length) return;
    [ids[index], ids[swap]] = [ids[swap]!, ids[index]!];
    void run(() => reorderColumnsAction(slug, { projectId, columnIds: ids }, projectKey));
  };

  const act = async (fn: Parameters<RunAction>[0], success: string) => {
    setBusy(true);
    const ok = await run(fn, success);
    setBusy(false);
    if (ok) setDialog(null);
  };

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <IconButton label={`Options for ${column.name}`} size="sm">
            <Ellipsis />
          </IconButton>
        </MenuTrigger>
        <MenuContent>
          <MenuItem
            onSelect={() => {
              setName(column.name);
              setCategory(column.category);
              setColor(column.color ?? "");
              setLimit(column.wipLimit ? String(column.wipLimit) : "");
              setDialog("rename");
            }}
          >
            Edit column…
          </MenuItem>
          <MenuItem disabled={index <= 0} onSelect={() => reorder(-1)}>
            Move left
          </MenuItem>
          <MenuItem disabled={index >= columns.length - 1} onSelect={() => reorder(1)}>
            Move right
          </MenuItem>
          <MenuSeparator />
          <MenuItem danger disabled={others.length === 0} onSelect={() => setDialog("delete")}>
            Delete column…
          </MenuItem>
        </MenuContent>
      </Menu>
      <Dialog open={dialog === "rename"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader title="Edit column" description="Tasks in a Done column count as finished." />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void act(() => updateColumnAction(slug, { columnId: column.id, name, category, color: color || null, wipLimit: limit.trim() ? Number(limit) : null }, projectKey), "Column saved.");
            }}
          >
            <DialogBody className="flex flex-col gap-4">
              <Field label="Name">
                <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} required autoFocus />
              </Field>
              <Field label="Counts as">
                <CategorySelect value={category} onChange={setCategory} />
              </Field>
              <Field label="Colour" helperText="Tints the dot in the column header.">
                <Dropdown value={color} onChange={(event) => setColor(event.target.value as LabelTone | "")}>
                  <option value="">Default</option>
                  {LABEL_TONES.map((tone) => (
                    <option key={tone.value} value={tone.value}>
                      {tone.label}
                    </option>
                  ))}
                </Dropdown>
              </Field>
              <Field label="WIP limit" helperText="A soft limit: the header shows tasks/limit and turns amber when it is passed. Leave empty for none.">
                <Input type="number" inputMode="numeric" min={1} max={999} value={limit} onChange={(event) => setLimit(event.target.value)} />
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={busy}>
                Save column
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === "delete"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent role="alertdialog">
          <DialogHeader title={`Delete ${column.name}?`} description={taskCount ? `Its ${taskCount} ${taskCount === 1 ? "task moves" : "tasks move"} to the column you pick.` : "It has no tasks."} />
          <DialogBody>
            <Field label="Move its tasks to">
              <Dropdown value={target} onChange={(event) => setTarget(event.target.value)}>
                {others.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Dropdown>
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button variant="dangerSolid" loading={busy} onClick={() => void act(() => deleteColumnAction(slug, { columnId: column.id, moveToColumnId: target }, projectKey), "Column deleted.")}>
              Delete column
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** "Add column" at the end of the board. */
export function AddColumn({ slug, projectId, projectKey, run }: { slug: string; projectId: string; projectKey: string; run: RunAction }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ColumnCategory>("IN_PROGRESS");
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <Button variant="ghost" startIcon={<Plus />} onClick={() => setOpen(true)} className="w-full justify-start">
        Add column
      </Button>
    );
  }
  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        const ok = await run(() => addColumnAction(slug, { projectId, name, category }, projectKey), "Column added.");
        setBusy(false);
        if (ok) {
          setName("");
          setOpen(false);
        }
      }}
    >
      <Field label="Column name">
        <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} required autoFocus onKeyDown={(event) => event.key === "Escape" && setOpen(false)} />
      </Field>
      <Field label="Counts as">
        <CategorySelect value={category} onChange={setCategory} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" loading={busy}>
          Add column
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
