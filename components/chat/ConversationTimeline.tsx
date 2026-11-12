"use client";

import { Fragment } from "react";
import type { ChannelInfo, MessageDTO } from "@/lib/chat/types";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/display";
import { BoxSpinner } from "@/components/brand/BoxSpinner";
import { Composer, type ComposerSubmit } from "./Composer";
import { MessageItem } from "./MessageItem";
import type { useMessageActions } from "./useMessageActions";
import type { useConversationTimeline } from "./useConversationTimeline";
import { continuesPrevious, dayKey, dayLabel } from "./ui";

export function ConversationTimeline({ info, timeZone, timeline, actions, saveEdit }: {
  info: ChannelInfo;
  timeZone: string;
  timeline: ReturnType<typeof useConversationTimeline>;
  actions: ReturnType<typeof useMessageActions>["actions"];
  saveEdit: (message: MessageDTO) => (submit: ComposerSubmit) => Promise<boolean>;
}) {
  const {
    messages, hasOlder, hasNewer, loading, divider, highlight, editingId,
    pending, atBottom, setAtBottom, scroller, topSentinel, stickRef,
    scheduleRead, loadOlder, loadNewer, setEditingId,
  } = timeline;
  return (
    <div
      ref={scroller}
      className="relative min-h-0 flex-1 overflow-y-auto"
      onScroll={(event) => {
        const el = event.currentTarget;
        const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        stickRef.current = bottom && !hasNewer;
        if (bottom !== atBottom) setAtBottom(bottom);
        if (bottom) scheduleRead();
      }}
    >
      <div ref={topSentinel} aria-hidden className="h-px" />
      {hasOlder ? (
        <div className="flex justify-center py-3">
          {loading === "older" ? <BoxSpinner label="Loading older messages" /> : (
            <Button size="sm" variant="quiet" onClick={() => void loadOlder()}>
              Load older messages
            </Button>
          )}
        </div>
      ) : (
        <Intro info={info} />
      )}

      <ol className="pb-3" aria-label="Messages">
        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const newDay = !previous || dayKey(previous.createdAt, timeZone) !== dayKey(message.createdAt, timeZone);
          return (
            <Fragment key={message.id}>
              {newDay ? (
                <li role="separator" className="flex items-center gap-3 px-4 pb-1 pt-4">
                  <span className="h-px flex-1 bg-line" />
                  <span className="text-caption font-semibold text-ink-secondary" suppressHydrationWarning>
                    {dayLabel(message.createdAt, timeZone)}
                  </span>
                  <span className="h-px flex-1 bg-line" />
                </li>
              ) : null}
              {message.id === divider ? (
                <li id={`divider-${message.id}`} role="separator" aria-label="New messages" className="flex scroll-mt-4 items-center gap-3 px-4 py-1">
                  <span className="h-px flex-1 bg-accent-soft" />
                  <Chip tone="accent" size="sm">New messages</Chip>
                </li>
              ) : null}
              <li>
                <MessageItem
                  message={message}
                  compact={!newDay && message.id !== divider && continuesPrevious(previous, message, timeZone)}
                  highlighted={message.id === highlight}
                  canReact={info.can.post}
                  timeZone={timeZone}
                  actions={actions}
                  editor={
                    editingId === message.id && message.source ? (
                      <Composer
                        mode="edit"
                        channelId={info.id}
                        placeholder="Edit message"
                        allowBroadcast={info.can.broadcast}
                        allowUpload={false}
                        initialText={message.source.text}
                        initialMentions={message.source.mentions}
                        autoFocus
                        onSubmit={saveEdit(message)}
                        onCancel={() => setEditingId(null)}
                      />
                    ) : undefined
                  }
                />
              </li>
            </Fragment>
          );
        })}
        {pending.map((item) => (
          <li key={item.key} className="flex gap-3 px-4 py-1 text-body-ui text-ink-muted" aria-live="polite">
            <span className="w-9 shrink-0" />
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{item.text}</span>
            <span className="shrink-0 text-caption">Sending</span>
          </li>
        ))}
      </ol>

      {hasNewer ? (
        <div className="flex justify-center pb-4">
          <Button size="sm" variant="secondary" loading={loading === "newer"} onClick={() => void loadNewer()}>
            Load newer messages
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Intro({ info }: { info: ChannelInfo }) {
  if (info.kind === "DIRECT") {
    return (
      <div className="px-4 pb-2 pt-8">
        <p className="text-h4 text-ink">{info.name}</p>
        <p className="mt-1 max-w-xl text-body-ui text-ink-secondary">This is the start of your conversation. Only the people here can see it.</p>
      </div>
    );
  }
  return (
    <div className="px-4 pb-2 pt-8">
      <p className="text-h4 text-ink">Welcome to #{info.name}</p>
      <p className="mt-1 max-w-xl text-body-ui text-ink-secondary">
        {info.topic ? info.topic : "This is the very beginning of the channel."}
        {info.kind === "PRIVATE" ? " It's private: only the people added can see it." : ""}
      </p>
    </div>
  );
}
