import { z } from "zod";

const email = z.string().trim().toLowerCase().email("Enter a valid email address.").max(320);

export const campaignSchema = z.object({
  name: z.string().trim().min(1, "Enter a campaign name.").max(120),
  subject: z.string().trim().min(1, "Enter a subject line.").max(200),
  fromName: z.string().trim().min(1, "Enter a from name.").max(100),
  replyTo: z.union([email, z.literal("")]).default(""),
  contentType: z.enum(["RICHTEXT", "MARKDOWN", "HTML", "PLAIN"]).default("RICHTEXT"),
  bodySource: z.string().max(500_000, "The body is too long.").default(""),
  templateId: z.string().min(1).max(64).nullable().default(null),
  listIds: z.array(z.string().min(1).max(64)).max(50).default([]),
  trackOpens: z.boolean().default(false),
  trackClicks: z.boolean().default(false),
  individualTracking: z.boolean().default(false),
});
export type CampaignInput = z.infer<typeof campaignSchema>;

export const scheduleSchema = z.object({ scheduledAt: z.coerce.date().nullable().default(null) });

export const testSendSchema = z.object({ extra: z.array(email).max(5, "Send tests to at most 5 other addresses.").default([]) });

export const templateSchema = z.object({
  name: z.string().trim().min(1, "Enter a template name.").max(100),
  subject: z.string().trim().max(200).default(""),
  bodyHtml: z.string().min(1, "Add the template HTML.").max(500_000),
  isDefault: z.boolean().default(false),
});
