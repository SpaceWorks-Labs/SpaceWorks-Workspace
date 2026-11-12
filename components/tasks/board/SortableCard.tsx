"use client";

import { useSortable } from "@dnd-kit/sortable";
import type { ComponentProps, HTMLAttributes } from "react";
import { CSS } from "@dnd-kit/utilities";
import { TaskCard } from "../TaskCard";

/** A board card wired into its column's sortable list. Cards the viewer cannot edit are not draggable. */
export function SortableCard(props: Omit<ComponentProps<typeof TaskCard>, "dnd"> & { columnId: string }) {
  const { columnId, ...card } = props;
  const sortable = useSortable({ id: card.task.id, disabled: !card.canEdit, data: { columnId } });
  const { attributes, listeners } = sortable;
  return (
    <TaskCard
      {...card}
      dnd={{
        setNodeRef: sortable.setNodeRef,
        setActivatorNodeRef: sortable.setActivatorNodeRef,
        style: { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition },
        // `onClick` stays the card's own: dnd-kit swallows the click that ends a drag.
        activator: { ...attributes, ...listeners } as HTMLAttributes<HTMLElement>,
        dragging: sortable.isDragging,
      }}
    />
  );
}
