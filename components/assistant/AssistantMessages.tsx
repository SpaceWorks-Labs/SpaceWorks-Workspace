"use client";

import type { Ref } from "react";
import Link from "next/link";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout, EmptyState } from "@/components/ui/display";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { BoxArt } from "@/components/brand/BoxSpinner";
import { Markdown } from "@/components/assistant/Markdown";
import { cn } from "@/lib/cn";
import type { PendingCall } from "@/lib/assistant/chat";
import type { LiveItem } from "./AssistantChatTypes";

const SUGGESTIONS = ["What's due this week?", "Who can help with soldering?", "Summarise the latest announcements", "What happened in #general today?"];

function previewInput(input: unknown): Array<[string, string]> {
  if (!input || typeof input !== "object") return [];
  return Object.entries(input as Record<string, unknown>)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)]);
}

export function AssistantMessages({
  configured,
  setupHref,
  items,
  streaming,
  pending,
  error,
  bottom,
  send,
}: {
  configured: boolean;
  setupHref: string | null;
  items: LiveItem[];
  streaming: boolean;
  pending: PendingCall[];
  error: string | null;
  bottom: Ref<HTMLDivElement>;
  send: (body: { text?: string; decision?: "approve" | "decline" }) => Promise<void>;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5" aria-live="polite" aria-busy={streaming}>
      {!configured ? (
        <Callout tone="warning" title="The assistant isn't set up yet." className="mb-4">
          {setupHref ? (
            <>Add an Anthropic API key in <Link href={setupHref} className="font-semibold underline">instance settings</Link> to switch it on.</>
          ) : (
            "Ask your instance admin to add an AI key in instance settings."
          )}
        </Callout>
      ) : null}
      {items.length === 0 ? (
        configured ? (
        <EmptyState patch title="Ask the assistant about the workspace." className="border-none" action={
          <Menu>
            <MenuTrigger asChild><Button variant="secondary" disabled={streaming}>Choose a prompt</Button></MenuTrigger>
            <MenuContent align="center">
            {SUGGESTIONS.map((suggestion) => (
              <MenuItem key={suggestion} onSelect={() => void send({ text: suggestion })} disabled={streaming}>
                {suggestion}
              </MenuItem>
            ))}
            </MenuContent>
          </Menu>
        } />
        ) : null
      ) : (
        <ol className="flex flex-col gap-4">
          {items.map((item) => (
            <li key={item.id} className={cn("flex", item.kind === "user" ? "justify-end" : "justify-start")}>
              {item.kind === "user" ? (
                <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-primary px-4 py-2.5 text-body-ui text-on-primary [overflow-wrap:anywhere]">{item.text}</div>
              ) : item.kind === "assistant" ? (
                <div className="max-w-[92%]">
                  <span className="mb-1 block text-caption font-semibold text-ink-muted">Assistant</span>
                  <Markdown source={item.text} />
                </div>
              ) : (
                <div className={cn("inline-flex max-w-full items-center gap-2 rounded-md border px-3 py-2 text-caption", item.error ? "border-danger-border text-danger-fg" : "border-line bg-surface text-ink-secondary")}>
                  {"running" in item && item.running ? <BoxArt size={14} /> : item.error ? <TriangleAlert aria-hidden className="size-3.5" /> : <CircleCheck aria-hidden className="size-3.5 text-accent-text" />}
                  <span className="font-semibold text-ink">{item.title}</span>
                  <span className="truncate">{item.summary}</span>
                </div>
              )}
            </li>
          ))}
          {streaming && items.at(-1)?.kind === "user" ? (
            <li className="flex items-center gap-2 text-caption text-ink-muted"><BoxArt size={16} /> Thinking</li>
          ) : null}
        </ol>
      )}
      {pending.length > 0 && !streaming ? (
        <section aria-label="Confirm changes" className="mt-4 rounded-lg border-[1.5px] border-accent-text bg-panel p-4">
          <h3 className="text-label text-ink">Confirm {pending.length === 1 ? "this change" : "these changes"}</h3>
          <ul className="mt-2 flex flex-col gap-3">
            {pending.map((call) => (
              <li key={call.id}>
                <p className="text-body-ui font-semibold text-ink">{call.title}</p>
                <dl className="mt-1 grid gap-x-3 gap-y-0.5 text-caption sm:grid-cols-[max-content_minmax(0,1fr)]">
                  {previewInput(call.input).map(([key, value]) => (
                    <div key={key} className="contents">
                      <dt className="text-ink-muted">{key}</dt>
                      <dd className="whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">{value}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => void send({ decision: "approve" })}>Confirm</Button>
            <Button variant="secondary" onClick={() => void send({ decision: "decline" })}>Cancel</Button>
          </div>
        </section>
      ) : null}
      {error ? <Callout tone="danger" role="alert" className="mt-4">{error}</Callout> : null}
      <div ref={bottom} />
    </div>
  );
}
