"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EditorContent, useEditor } from "@tiptap/react";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { Avatar, Callout, Chip } from "@/components/ui/display";
import { cn } from "@/lib/cn";
import { DocMentionMenu } from "./DocMentionMenu";
import { DocActions } from "./DocActions";
import { useDocs } from "./DocsShell";
import { EditorToolbar } from "./EditorToolbar";
import { createDocSession, IMAGE_TYPES, type DocMember, type MentionMenu, type SaveStatus } from "./docSession";
import { usePresence, type PresenceEntry } from "./usePresence";
import styles from "./DocProse.module.css";

export type { DocMember } from "./docSession";
export type DocView = {
  id: string;
  title: string;
  html: string;
  version: string;
  visibility: "WORKSPACE" | "ADMINS";
  parentId: string | null;
  verification: { state: "none" | "verified" | "due_soon" | "expired"; label: string | null };
};

const STATUS_LABEL: Record<SaveStatus, string> = {
  saved: "Saved",
  dirty: "Unsaved changes",
  saving: "Saving",
  error: "Couldn't save. Retrying",
  conflict: "Not saved",
};

function presenceText(entries: PresenceEntry[], names: Map<string, string>) {
  if (entries.length === 0) return null;
  const name = (entry: PresenceEntry) => names.get(entry.userId) ?? "A member";
  const editing = entries.filter((entry) => entry.state === "editing");
  const lead = editing.length > 0 ? editing : entries;
  const verb = editing.length > 0 ? (editing.length === 1 ? "is editing" : "are editing") : entries.length === 1 ? "is viewing" : "are viewing";
  if (lead.length === 1) return `${name(lead[0]!)} ${verb}`;
  if (lead.length === 2) return `${name(lead[0]!)} and ${name(lead[1]!)} ${verb}`;
  return `${name(lead[0]!)} and ${lead.length - 1} others ${verb}`;
}

/**
 * The doc page body: title, toolbar, editor, autosave and collaboration
 * signals. Saves are debounced and carry the version the editor started
 * from; if someone else saved in between, the save is refused and the page
 * offers a reload instead of overwriting their work.
 */
export function DocEditor({
  doc,
  canEdit,
  canArchive,
  currentUserId,
  members,
  breadcrumbs,
  meta,
}: {
  doc: DocView;
  canEdit: boolean;
  canArchive: boolean;
  currentUserId: string;
  members: DocMember[];
  breadcrumbs: Array<{ id: string; title: string }>;
  meta: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const { slug, subscribe, isAdmin } = useDocs();
  const [title, setTitle] = useState(doc.title);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [remoteChange, setRemoteChange] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);
  const [focused, setFocused] = useState(false);
  const [imageProgress, setImageProgress] = useState<number | null>(null);
  const [mention, setMention] = useState<MentionMenu | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const names = useMemo(() => new Map(members.map((member) => [member.id, member.name])), [members]);
  const [session] = useState(() =>
    createDocSession({
      slug,
      docId: doc.id,
      version: doc.version,
      title: doc.title,
      currentUserId,
      members,
      canEdit,
      callbacks: {
        setStatus,
        setMention,
        setImageProgress,
        notifyError: (message) => showToast(message, "error"),
        onReloaded: (freshTitle) => {
          setTitle(freshTitle);
          setRemoteChange(null);
        },
      },
    }),
  );

  const editor = useEditor({
    immediatelyRender: false,
    editable: canEdit,
    content: doc.html,
    extensions: session.extensions,
    editorProps: {
      attributes: { class: cn(styles.prose, "min-h-[50vh] pb-24"), "aria-label": "Page content", ...(canEdit ? {} : { "aria-readonly": "true" }) },
      handlePaste: session.handlers.handlePaste,
      handleDrop: session.handlers.handleDrop,
    },
    onCreate: ({ editor: created }) => session.attach(created),
    onUpdate: () => session.schedule(),
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  });

  useEffect(() => session.setMembers(members), [session, members]);
  useEffect(() => () => session.dispose(), [session]);
  useEffect(() => {
    if (archived) editor?.setEditable(false);
  }, [archived, editor]);

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (status === "dirty" || status === "saving" || status === "error") event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [status]);

  // Other people's saves and archive on this doc.
  useEffect(
    () =>
      subscribe((event) => {
        if (event.channel !== `doc:${doc.id}` || event.actorId === currentUserId) return;
        if (event.type === "doc.updated" && event.data?.version !== session.version) setRemoteChange(names.get(event.actorId ?? "") ?? "Someone");
        if (event.type === "doc.archived") setArchived(true);
      }),
    [subscribe, doc.id, currentUserId, names, session],
  );

  // After "Reload", swap in the fresh server copy once it arrives.
  useEffect(() => session.applyServerCopy({ version: doc.version, title: doc.title, html: doc.html }), [session, doc.version, doc.title, doc.html]);

  const loadLatest = () => {
    session.requestReload();
    router.refresh();
  };

  const presence = usePresence({ slug, docId: doc.id, userId: currentUserId, state: canEdit && focused ? "editing" : "viewing", subscribe });
  const presenceLine = presenceText(presence, names);

  const copyMyText = async () => {
    try {
      await navigator.clipboard.writeText(`${session.title}\n\n${editor?.getText() ?? ""}`);
      showToast("Your version is on the clipboard.", "success");
    } catch {
      showToast("Couldn't copy. Select the text and copy it yourself.", "error");
    }
  };

  const resizeTitle = (element: HTMLTextAreaElement | null) => {
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  };

  return (
    <article className="flex flex-col gap-5">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav aria-label="Breadcrumb" className="min-w-0 text-caption text-ink-muted">
            <ol className="flex flex-wrap items-center gap-1">
              <li><Link href={`/w/${slug}/docs`} className="hover:text-ink hover:underline">Docs</Link></li>
              {breadcrumbs.map((crumb) => (
                <li key={crumb.id} className="flex items-center gap-1">
                  <span aria-hidden>/</span>
                  <Link href={`/w/${slug}/docs/${crumb.id}`} className="max-w-[180px] truncate hover:text-ink hover:underline">{crumb.title}</Link>
                </li>
              ))}
            </ol>
          </nav>
          <div className="flex items-center gap-2">
            {canEdit ? (
              <span aria-live="polite" className={cn("text-caption tabular-nums", status === "error" || status === "conflict" ? "text-danger-fg" : "text-ink-muted")}>
                {STATUS_LABEL[status]}
              </span>
            ) : null}
            <DocActions doc={doc} title={title} canEdit={canEdit} canArchive={canArchive} isAdmin={isAdmin} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {doc.visibility === "ADMINS" ? <Chip tone="ink" size="sm">Admins only</Chip> : null}
          {doc.verification.state === "verified" ? <Chip tone="success" size="sm">{doc.verification.label}</Chip> : null}
          {doc.verification.state === "due_soon" ? <Chip tone="warning" size="sm">{doc.verification.label}</Chip> : null}
          {doc.verification.state === "expired" ? <Chip tone="warning" size="sm">Needs review</Chip> : null}
          {!canEdit ? <Chip tone="outline" size="sm">Read only</Chip> : null}
          <span className="text-caption text-ink-muted">{meta}</span>
        </div>
        {presenceLine ? (
          <div className="flex items-center gap-2" aria-live="polite">
            <span className="flex -space-x-1.5">
              {presence.slice(0, 4).map((entry) => (
                <Avatar key={entry.userId} name={names.get(entry.userId) ?? "Member"} size="xs" tone={entry.state === "editing" ? "accent" : "neutral"} className="ring-2 ring-[var(--yy-bg-canvas)]" />
              ))}
            </span>
            <span className="text-caption text-ink-secondary">{presenceLine}</span>
          </div>
        ) : null}
      </header>

      {archived ? (
        <Callout tone="warning" role="status" title="This page was archived.">
          Changes are no longer saved. Restore it from Archived pages to keep editing.
        </Callout>
      ) : null}
      {status === "conflict" ? (
        <Callout
          tone="danger"
          role="alert"
          title="Someone else edited this page."
          action={
            <>
              <Button size="sm" variant="secondary" onClick={copyMyText}>Copy my version</Button>
              <Button size="sm" variant="primary" onClick={loadLatest}>Reload</Button>
            </>
          }
        >
          Your latest changes weren&apos;t saved. Copy them if you need them, then reload.
        </Callout>
      ) : remoteChange ? (
        <Callout tone="info" role="status" title={`${remoteChange} updated this page.`} action={<Button size="sm" variant="secondary" onClick={loadLatest}>Load latest</Button>}>
          {status === "saved" ? "Load the latest version to see their changes." : "Your unsaved changes may conflict. Copy anything important before you load."}
        </Callout>
      ) : null}

      <textarea
        ref={resizeTitle}
        value={title}
        readOnly={!canEdit || archived}
        rows={1}
        maxLength={200}
        aria-label="Page title"
        placeholder="Untitled"
        onChange={(event) => {
          setTitle(event.target.value);
          resizeTitle(event.target);
          session.setTitle(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            editor?.chain().focus("start").run();
          }
        }}
        className="w-full resize-none overflow-hidden bg-transparent font-sans text-h1 text-ink placeholder:text-ink-muted focus:outline-none"
      />

      {canEdit && editor && !archived ? (
        <div className="sticky top-0 z-10 -mx-2 rounded-lg border border-line bg-panel px-2 py-1.5">
          <EditorToolbar editor={editor} imageBusy={imageProgress !== null} onPickImage={() => fileInput.current?.click()} />
          {imageProgress !== null ? (
            <p className="px-1 pt-1 text-caption text-ink-muted" aria-live="polite">Uploading image {Math.round(imageProgress * 100)}%</p>
          ) : null}
          <input
            ref={fileInput}
            type="file"
            accept={IMAGE_TYPES.join(",")}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              void session.uploadImages(files);
            }}
          />
        </div>
      ) : null}

      <div className={cn(archived && "pointer-events-none")}>
        {editor ? <EditorContent editor={editor} /> : <div className={cn(styles.prose, "min-h-[50vh]")} dangerouslySetInnerHTML={{ __html: doc.html }} />}
      </div>

      <DocMentionMenu mention={mention} />
    </article>
  );
}
