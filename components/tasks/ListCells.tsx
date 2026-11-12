"use client";

import { useId, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, Chip } from "@/components/ui/display";
import { Menu, MenuContent, MenuItem, MenuTrigger, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/menu";
import { cn } from "@/lib/cn";
import { PRIORITIES, PRIORITY_LABELS } from "@/lib/tasks/filters";
import { toDateInputValue } from "@/lib/tasks/localDate";
import type { BoardData, BoardTask, ColumnDTO } from "@/lib/tasks/types";
import { AvatarStack, DueChip, PriorityChip } from "./bits";
import { MultiSelect, type MultiSelectItem } from "./MultiSelect";

/** Inline-edit cells of the list view. Each trigger is a plain button; none of them opens the task drawer. */

const trigger = "inline-flex min-h-11 items-center gap-1 rounded-md px-1.5 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--yy-focus)]";

const columnTone = (column: ColumnDTO) => (column.category === "DONE" ? "success" : column.category === "IN_PROGRESS" ? "info" : "neutral");
const dash = <span className="text-ink-muted">—</span>;

function Locked({ hint, children }: { hint: string; children: ReactNode }) {
  const id = useId();
  return (
    <span title={hint} tabIndex={0} aria-describedby={id} className="group/locked relative inline-flex min-h-11 items-center rounded-md px-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--yy-focus)]">
      {children}
      <span id={id} role="tooltip" className="pointer-events-none absolute left-0 top-full z-10 hidden w-max max-w-[240px] rounded-md bg-inverse px-2 py-1 text-caption text-on-inverse group-focus-visible/locked:block group-focus/locked:block">
        {hint}
      </span>
    </span>
  );
}

export function StatusCell({ task, columns, editable, hint, onPick }: { task: BoardTask; columns: ColumnDTO[]; editable: boolean; hint: string; onPick: (columnId: string) => void }) {
  const column = columns.find((item) => item.id === task.columnId);
  const chip = column ? <Chip size="sm" tone={columnTone(column)}>{column.name}</Chip> : dash;
  if (!editable) return <Locked hint={hint}>{chip}</Locked>;
  return (
    <Menu>
      <MenuTrigger className={trigger} aria-label={`Status: ${column?.name ?? "none"}. Change`}>
        {chip}
      </MenuTrigger>
      <MenuContent align="start">
        {columns.map((item) => (
          <MenuItem key={item.id} onSelect={() => item.id !== task.columnId && onPick(item.id)}>
            {item.name}
            {item.id === task.columnId ? <span className="sr-only"> (current)</span> : null}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

export function PriorityCell({ task, editable, hint, onPick }: { task: BoardTask; editable: boolean; hint: string; onPick: (priority: BoardTask["priority"]) => void }) {
  const chip = task.priority === "NONE" ? dash : <PriorityChip priority={task.priority} />;
  if (!editable) return <Locked hint={hint}>{chip}</Locked>;
  return (
    <Menu>
      <MenuTrigger className={trigger} aria-label={`Priority: ${PRIORITY_LABELS[task.priority]}. Change`}>
        {chip}
      </MenuTrigger>
      <MenuContent align="start">
        {PRIORITIES.map((priority) => (
          <MenuItem key={priority} onSelect={() => priority !== task.priority && onPick(priority)}>
            {PRIORITY_LABELS[priority]}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

/** Members with "Me" first (when the viewer is known). */
export function assigneeItems(members: BoardData["members"], viewerId?: string): MultiSelectItem[] {
  const me = viewerId ? members.find((member) => member.id === viewerId) : undefined;
  const others = members.filter((member) => member.id !== viewerId);
  const item = (id: string, label: string, name: string | null, image: string | null): MultiSelectItem => ({ id, label, leading: <Avatar name={name} src={image} size="xs" /> });
  return [...(me ? [item(me.id, "Me", me.name, me.image)] : []), ...others.map((member) => item(member.id, member.name ?? "Member", member.name, member.image))];
}

export function AssigneesCell({
  task,
  members,
  items,
  editable,
  hint,
  onSet,
  onClaim,
}: {
  task: BoardTask;
  members: BoardData["members"];
  items: MultiSelectItem[];
  editable: boolean;
  hint: string;
  onSet: (ids: string[]) => void;
  onClaim: (() => void) | null;
}) {
  const people = task.assigneeIds.map((id) => members.find((member) => member.id === id) ?? { id, name: "Former member", image: null });
  const stack = people.length ? <AvatarStack people={people} /> : dash;
  if (editable) {
    return (
      <MultiSelect
        title="Assignees"
        commitOnClose
        items={items}
        selected={task.assigneeIds}
        onChange={onSet}
        searchPlaceholder="Find a member"
        trigger={
          <button type="button" className={trigger} aria-label={`Assignees: ${people.length ? people.map((person) => person.name ?? "Member").join(", ") : "none"}. Change`}>
            {people.length ? stack : <span className="text-ink-muted">Assign</span>}
          </button>
        }
      />
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Locked hint={hint}>{stack}</Locked>
      {onClaim ? (
        <Button variant="quiet" size="sm" onClick={onClaim}>
          Assign to me
        </Button>
      ) : null}
    </span>
  );
}

export function DueCell({ task, editable, hint, timeZone, now, onPick }: { task: BoardTask; editable: boolean; hint: string; timeZone: string; now: Date; onPick: (value: string) => void }) {
  const chip = task.dueAt ? <DueChip dueAt={task.dueAt} completedAt={task.completedAt} timeZone={timeZone} now={now} /> : dash;
  if (!editable) return <Locked hint={hint}>{chip}</Locked>;
  return (
    <Popover>
      <PopoverTrigger className={cn(trigger, "whitespace-nowrap")} aria-label={`Due date: ${task.dueAt ? toDateInputValue(new Date(task.dueAt), timeZone) : "none"}. Change`}>
        {task.dueAt ? chip : <span className="text-ink-muted">Set date</span>}
      </PopoverTrigger>
      <PopoverContent className="flex w-auto items-center gap-2">
        <input
          type="date"
          aria-label="Due date"
          className="min-h-11 rounded-md border border-line-strong bg-panel px-3 text-body-ui text-ink focus:border-accent focus:outline-none"
          value={task.dueAt ? toDateInputValue(new Date(task.dueAt), timeZone) : ""}
          onChange={(event) => event.target.value && onPick(event.target.value)}
        />
        {task.dueAt ? (
          <Button variant="quiet" size="sm" onClick={() => onPick("")}>
            Clear
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
