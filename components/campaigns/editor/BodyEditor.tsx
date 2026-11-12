"use client";

import { useState } from "react";
import { RichTextEditor } from "@/components/community/RichTextEditor";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";

type ContentType = "RICHTEXT" | "MARKDOWN" | "HTML" | "PLAIN";

/** Body editor: rich text (with an image-by-URL control) or a source box for Markdown, HTML and plain text. */
export function BodyEditor({ contentType, value, onChange }: { contentType: ContentType; value: string; onChange: (next: string) => void }) {
  const [imageUrl, setImageUrl] = useState("");
  const [revision, setRevision] = useState(0);
  const [imageError, setImageError] = useState("");

  if (contentType !== "RICHTEXT") {
    return (
      <Textarea
        aria-label="Body"
        rows={16}
        className="text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={contentType === "MARKDOWN" ? "Write in Markdown. Use {{first_name}} to personalise." : contentType === "HTML" ? "<p>Hello {{first_name}}</p>" : "Hello {{first_name}}"}
      />
    );
  }
  const addImage = () => {
    const url = imageUrl.trim();
    if (!/^https:\/\/[^\s"'<>]+$/i.test(url)) return setImageError("Use a full https:// address.");
    setImageError("");
    onChange(`${value}<p><img src="${url}" alt=""></p>`);
    setRevision((n) => n + 1);
    setImageUrl("");
  };
  return (
    <div className="flex flex-col gap-3">
      <RichTextEditor key={revision} id="campaign-body" label="Body" value={value} onChange={onChange} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="flex-1">
          <Input aria-label="Image address" aria-invalid={imageError ? true : undefined} value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://example.com/banner.png" />
          {imageError ? <p className="mt-1 text-caption text-danger-fg">{imageError}</p> : null}
        </div>
        <Button onClick={addImage}>Add image</Button>
      </div>
    </div>
  );
}
