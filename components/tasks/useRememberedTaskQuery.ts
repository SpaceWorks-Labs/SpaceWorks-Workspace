"use client";

import { useEffect, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import type { TaskQuery } from "@/lib/tasks/filters";
import { deserializeQuery, sameQuery, serializeQuery, storageKey, urlHasQuery } from "@/lib/tasks/rememberedQuery";

/**
 * Per-project memory of the view, filters, sort and grouping in localStorage
 * (`sww.tasks.view.<workspaceSlug>.<projectKey>`). The URL always wins: on a
 * project URL without any query parameters the remembered query is applied
 * through `onChange` once; afterwards every change is saved. Storage can be
 * blocked or full, so every access is wrapped and the board works without it.
 */
export function useRememberedTaskQuery(query: TaskQuery, onChange: (query: TaskQuery) => void) {
  const params = useParams<{ workspaceSlug?: string; key?: string }>();
  const search = useSearchParams();
  const workspaceSlug = params.workspaceSlug;
  const projectKey = params.key;
  const key = workspaceSlug && projectKey ? storageKey(workspaceSlug, projectKey) : null;
  const ready = useRef<string | null>(null);
  /** Serialized remembered query we asked the URL to adopt; not saved over until it shows up. */
  const pending = useRef<string | null>(null);
  const latest = useRef({ query, onChange, hasUrlQuery: false });
  useEffect(() => {
    latest.current = { query, onChange, hasUrlQuery: urlHasQuery(new URLSearchParams(search.toString())) };
  });

  useEffect(() => {
    if (!key || ready.current === key) return;
    ready.current = key;
    if (latest.current.hasUrlQuery) return;
    let stored: TaskQuery | null = null;
    try {
      stored = deserializeQuery(window.localStorage.getItem(key));
    } catch {
      stored = null;
    }
    if (stored && !sameQuery(stored, latest.current.query)) {
      pending.current = serializeQuery(stored);
      latest.current.onChange(stored);
    }
  }, [key]);

  const serialized = serializeQuery(query);
  useEffect(() => {
    if (!key || ready.current !== key) return;
    if (pending.current !== null) {
      if (pending.current !== serialized) return;
      pending.current = null;
    }
    try {
      window.localStorage.setItem(key, serialized);
    } catch {
      /* storage unavailable: nothing to remember */
    }
  }, [key, serialized]);
}
