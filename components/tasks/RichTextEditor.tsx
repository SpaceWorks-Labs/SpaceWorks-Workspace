"use client";

import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import Image from "@tiptap/extension-image";
import StarterKit from "@tiptap/starter-kit";
import type { Editor } from "@tiptap/core";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { INLINE_IMAGE_TYPES } from "@/lib/tasks/inlineImages";

/** Uploads one pasted, dropped or chosen image and answers where it is served from (null = refused). */
export type UploadImage = (file: File) => Promise<{ url: string; alt: string } | null>;

const imageFiles = (files: FileList | null | undefined) => [...(files ?? [])].filter((file) => INLINE_IMAGE_TYPES.has(file.type));

/**
 * Rich text for task descriptions (tiptap starter kit: headings 2–3, bold,
 * italic, strike, code, lists, quotes, links, images). Images are pasted,
 * dropped or chosen and uploaded through `onUploadImage`; only the URL of the
 * stored file ever goes into the HTML. The server sanitises whatever this
 * produces (lib/tasks/sanitize.ts) before storing it.
 */
export function RichTextEditor({ initialHtml, onChange, label = "Description", autoFocus = false, onUploadImage }: { initialHtml: string; onChange: (html: string) => void; label?: string; autoFocus?: boolean; onUploadImage?: UploadImage }) {
  const [uploading, setUploading] = useState(0);
  const upload = useRef(onUploadImage);
  useEffect(() => {
    upload.current = onUploadImage;
  });
  const fileInputId = useId();
  const editorRef = useRef<Editor | null>(null);
  /** Upload each image and insert it at the cursor; images that are refused simply don't appear. */
  const insertImages = async (current: Editor, files: File[]) => {
    const send = upload.current;
    if (!send) return;
    setUploading((count) => count + files.length);
    for (const file of files) {
      try {
        const stored = await send(file);
        if (stored && !current.isDestroyed) current.chain().focus().setImage({ src: stored.url, alt: stored.alt }).run();
      } finally {
        setUploading((count) => count - 1);
      }
    }
  };
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false, autolink: true, defaultProtocol: "https" } }), Image.configure({ allowBase64: false })],
    content: initialHtml,
    immediatelyRender: false,
    autofocus: autoFocus ? "end" : false,
    editorProps: {
      attributes: {
        class: "yy-prose min-h-36 px-3.5 py-3 text-sm focus:outline-none [&_img]:my-2 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-md",
        "aria-label": label,
        "aria-multiline": "true",
        role: "textbox",
      },
      handlePaste: (_view, event) => {
        const files = imageFiles(event.clipboardData?.files);
        if (files.length === 0 || !upload.current || !editorRef.current) return false;
        event.preventDefault();
        void insertImages(editorRef.current, files);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = imageFiles(event.dataTransfer?.files);
        if (files.length === 0 || !upload.current || !editorRef.current) return false;
        event.preventDefault();
        void insertImages(editorRef.current, files);
        return true;
      },
    },
    onUpdate: ({ editor: current }) => {
      const html = current.getHTML();
      onChange(current.isEmpty && !html.includes("<img") ? "" : html);
    },
  });
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current
        ? {
            bold: current.isActive("bold"),
            italic: current.isActive("italic"),
            strike: current.isActive("strike"),
            code: current.isActive("code"),
            h2: current.isActive("heading", { level: 2 }),
            h3: current.isActive("heading", { level: 3 }),
            bullet: current.isActive("bulletList"),
            ordered: current.isActive("orderedList"),
            quote: current.isActive("blockquote"),
          }
        : null,
  });

  const tool = (name: string, icon: ReactNode, active: boolean | undefined, run: () => void) => (
    <button
      type="button"
      key={name}
      aria-label={icon ? name : undefined}
      title={name}
      aria-pressed={Boolean(active)}
      disabled={!editor}
      onMouseDown={(event) => event.preventDefault()}
      onClick={run}
      className={cn(
        "inline-flex min-h-11 min-w-11 px-2 items-center justify-center rounded-md text-xs font-semibold text-ink-secondary transition-colors duration-[var(--sw-dur-fast)] hover:bg-muted hover:text-ink [&_svg]:size-4",
        active && "bg-accent-soft text-accent-text",
      )}
    >
      {icon ?? name}
    </button>
  );

  return (
    <div className="overflow-hidden rounded-md border border-line-strong bg-panel focus-within:border-accent focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--yy-focus)]">
      <div role="toolbar" aria-label="Formatting" className="flex flex-wrap gap-0.5 border-b border-line bg-surface px-1.5 py-1">
        {tool("Bold", <span aria-hidden="true" className="inline-flex items-center justify-center text-xs font-semibold">B</span>, state?.bold, () => editor?.chain().focus().toggleBold().run())}
        {tool("Italic", <span aria-hidden="true" className="inline-flex items-center justify-center text-xs font-semibold">I</span>, state?.italic, () => editor?.chain().focus().toggleItalic().run())}
        {tool("Strikethrough", <span aria-hidden="true" className="inline-flex items-center justify-center text-xs font-semibold">S</span>, state?.strike, () => editor?.chain().focus().toggleStrike().run())}
        {tool("Inline code", <span aria-hidden="true" className="inline-flex items-center justify-center text-xs font-semibold">&lt;/&gt;</span>, state?.code, () => editor?.chain().focus().toggleCode().run())}
        {tool("Heading", <span aria-hidden="true" className="inline-flex items-center justify-center text-xs font-semibold">H2</span>, state?.h2, () => editor?.chain().focus().toggleHeading({ level: 2 }).run())}
        {tool("Subheading", <span aria-hidden="true" className="inline-flex items-center justify-center text-xs font-semibold">H3</span>, state?.h3, () => editor?.chain().focus().toggleHeading({ level: 3 }).run())}
        {tool("List", undefined, state?.bullet, () => editor?.chain().focus().toggleBulletList().run())}
        {tool("Numbered list", <span aria-hidden="true" className="inline-flex items-center justify-center text-xs font-semibold">1.</span>, state?.ordered, () => editor?.chain().focus().toggleOrderedList().run())}
        {tool("Quote", undefined, state?.quote, () => editor?.chain().focus().toggleBlockquote().run())}
        {onUploadImage ? tool("Image", undefined, false, () => document.getElementById(fileInputId)?.click()) : null}
      </div>
      {onUploadImage ? (
        <input
          id={fileInputId}
          type="file"
          accept={[...INLINE_IMAGE_TYPES].join(",")}
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-label="Add an image"
          onChange={(event) => {
            const files = imageFiles(event.target.files);
            event.target.value = "";
            if (editor && files.length) void insertImages(editor, files);
          }}
        />
      ) : null}
      <EditorContent editor={editor} />
      {uploading > 0 ? (
        <p role="status" className="border-t border-line bg-surface px-3 py-1.5 text-caption text-ink-muted">
          Uploading {uploading === 1 ? "an image" : `${uploading} images`}…
        </p>
      ) : null}
    </div>
  );
}

/** Stored (sanitised) HTML. */
export function RichTextView({ html, className }: { html: string; className?: string }) {
  // The HTML was sanitised on the server with an allow-list before it was stored.
  return <div className={cn("yy-prose text-sm [&_img]:my-2 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-md", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
