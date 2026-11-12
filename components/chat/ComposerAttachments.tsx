"use client";

import { BoxSpinner } from "@/components/brand/BoxSpinner";
import { fileSize } from "@/components/chat/ui";
import type { PendingFile } from "./useComposerAttachments";

export function ComposerAttachments({ files, onRemove }: {
  files: PendingFile[];
  onRemove: (key: string) => void;
}) {
  return (
    <ul className="flex flex-wrap gap-2 px-3 pt-3" aria-label="Files to send">
      {files.map((file) => (
        <li key={file.key} className="flex min-h-10 max-w-[260px] items-center gap-2 rounded-lg border border-line bg-surface py-1 pl-2.5 pr-1">
          {file.status === "uploading" ? <BoxSpinner size={16} label="Uploading" /> : null}
          <span className="min-w-0 flex-1 truncate text-caption text-ink">{file.name}</span>
          {file.attachment ? <span className="text-caption text-ink-muted tabular-nums">{fileSize(file.attachment.size)}</span> : null}
          <button
            type="button"
            aria-label={`Remove ${file.name}`}
            disabled={file.status === "uploading"}
            onClick={() => onRemove(file.key)}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-muted hover:text-ink disabled:text-ink-disabled"
          >
            <span aria-hidden="true" className="inline-flex items-center justify-center text-xs font-semibold">×</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
