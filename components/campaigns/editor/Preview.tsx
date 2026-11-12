"use client";

import { useEffect, useState } from "react";
import { previewCampaignAction } from "@/app/actions/campaigns";

type Input = { contentType: "RICHTEXT" | "MARKDOWN" | "HTML" | "PLAIN"; bodySource: string; templateId: string | null };

/** Live preview. The server renders and sanitises; the iframe is fully sandboxed (no scripts, no same-origin). */
export function CampaignPreview({ slug, input }: { slug: string; input: Input }) {
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  const key = JSON.stringify(input);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const result = await previewCampaignAction(slug, JSON.parse(key) as Input);
        if (!live) return;
        if (result.ok) {
          setHtml(result.data?.html ?? "");
          setError("");
        } else setError(result.error);
      } catch {
        if (live) setError("Couldn't render the preview.");
      }
    }, 600);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [slug, key]);
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-h3 text-ink">Preview</h2>
      {error ? <p role="alert" className="text-caption text-danger-fg">{error}</p> : null}
      <iframe title="Email preview" sandbox="" srcDoc={html} className="h-[560px] w-full rounded-lg border border-line bg-white" />
    </div>
  );
}
