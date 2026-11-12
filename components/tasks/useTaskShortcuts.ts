"use client";

import { useEffect, type RefObject } from "react";
import { nextFocusIndex, shortcutFor } from "@/lib/tasks/shortcuts";

/** Open menus and dialogs, and a card picked up for a keyboard drag, swallow the shortcuts. */
const OVERLAYS = '[role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"], [data-card-focus][aria-pressed="true"]';

/**
 * `/` focuses the search field; on the board `j` / `k` move focus to the next
 * / previous card (column by column, top to bottom). Ignored while typing and
 * while a menu, dialog or listbox is open.
 */
export function useTaskShortcuts({ searchRef, board }: { searchRef: RefObject<HTMLInputElement | null>; board: boolean }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = shortcutFor(event, Boolean(document.querySelector(OVERLAYS)));
      if (!action) return;
      if (action === "search") {
        const input = searchRef.current;
        if (!input) return;
        event.preventDefault();
        input.focus();
        input.select();
        return;
      }
      if (!board) return;
      const cards = [...document.querySelectorAll<HTMLElement>("[data-card-focus]")].filter((card) => card.offsetParent !== null);
      const active = document.activeElement as HTMLElement | null;
      const target = cards[nextFocusIndex(active ? cards.indexOf(active) : -1, cards.length, action)];
      if (!target) return;
      event.preventDefault();
      target.focus();
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [searchRef, board]);
}
