"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import * as Popover from "@radix-ui/react-popover";
import { Bell } from "lucide-react";

import {
  notificationSummaryAction,
  notificationStateAction,
} from "@/app/actions/notificationPreferences";
import { useRealtime } from "@/components/realtime/useRealtime";
export function NotificationBell({
  slug,
  initialCount = 0,
}: {
  slug: string;
  initialCount?: number;
}) {
  const [data, setData] = useState<{
    unread: number;
    items: Array<{ id: string; title: string; read: boolean }>;
  }>({ unread: initialCount, items: [] });
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const result = await notificationSummaryAction(slug);
      if (result) {
        setData(result);
        setError("");
      } else setError("Couldn't load notifications. Try again.");
    } catch {
      setError("Couldn't load notifications. Try again.");
    }
  }, [slug]);
  useEffect(() => {
    const id = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(id);
  }, [refresh]);
  useRealtime(slug, (e) => {
    if (e.type.startsWith("notification")) void refresh();
  });
  return (
    <Popover.Root
      onOpenChange={(open) => {
        if (open) void refresh();
      }}
    >
      <Popover.Trigger
        className="relative flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-muted"
      >
        <Bell aria-hidden className="size-5" />
        <span className="sr-only">Notifications, {data.unread} unread</span>
        {data.unread > 0 ? (
          <span
            aria-hidden
            className="absolute right-0 top-0 rounded-full bg-accent-soft px-1.5 text-caption text-accent-text"
          >
            {data.unread > 99 ? "99+" : data.unread}
          </span>
        ) : null}
      </Popover.Trigger>
      <span className="sr-only" role="status">
        {data.unread} unread notifications
      </span>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          className="sw-pop z-50 w-[min(360px,calc(100vw-32px))] rounded-xl border border-line bg-panel p-4 text-ink shadow-float"
        >
          <h2 className="text-title">Notifications</h2>
          {error ? <p role="alert">{error}</p> : null}
          <ul className="my-3 divide-y divide-line">
            {data.items.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/w/${slug}/notifications`}
                  className="block min-h-11 py-3 text-label"
                >
                  {item.title}
                  {!item.read ? (
                    <span className="ml-2 text-caption text-accent-text">
                      Unread
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
          {!data.items.length ? (
            <p className="py-3 text-ink-muted">You’re all caught up.</p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Link
              className="inline-flex min-h-11 items-center underline"
              href={`/w/${slug}/notifications`}
            >
              View all
            </Link>
            <button
              className="min-h-11 underline"
              onClick={async () => {
                const r = await notificationStateAction(slug, {
                  operation: "all",
                });
                if (r.ok) void refresh();
                else setError(r.error);
              }}
            >
              Mark all read
            </button>
          </div>
          <Popover.Arrow className="fill-panel" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
