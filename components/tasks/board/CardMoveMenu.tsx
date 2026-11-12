"use client";

import { Ellipsis } from "lucide-react";
import { IconButton } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import type { RelativeMove } from "@/lib/tasks/boardMoves";
import type { ColumnDTO } from "@/lib/tasks/types";

export type CardMove = { kind: "column"; columnId: string } | { kind: RelativeMove };

/** The "Move to" menu on each card: the keyboard and touch alternative to dragging. */
export function CardMoveMenu({ reference, columns, columnId, position, onMove }: { reference: string; columns: ColumnDTO[]; columnId: string | null; position: { index: number; count: number }; onMove: (move: CardMove) => void }) {
  const first = position.index === 0;
  const last = position.index >= position.count - 1;
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton label={`Move ${reference}`} size="sm">
          <Ellipsis />
        </IconButton>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuLabel>Move to</MenuLabel>
        {columns.map((column) => (
          <MenuItem key={column.id} disabled={column.id === columnId} onSelect={() => onMove({ kind: "column", columnId: column.id })}>
            {column.name}
            {column.id === columnId ? <span className="sr-only"> (current)</span> : null}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem disabled={first} onSelect={() => onMove({ kind: "up" })}>
          Move up
        </MenuItem>
        <MenuItem disabled={last} onSelect={() => onMove({ kind: "down" })}>
          Move down
        </MenuItem>
        <MenuItem disabled={first} onSelect={() => onMove({ kind: "top" })}>
          Top of column
        </MenuItem>
        <MenuItem disabled={last} onSelect={() => onMove({ kind: "bottom" })}>
          Bottom of column
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
