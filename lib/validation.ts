import { z } from "zod";
import { newPasswordSchema } from "@/lib/passwordPolicy";
import { isValidWorkspaceSlug } from "@/lib/slug";
import { isValidTimeZone } from "@/lib/timeZone";
import { isValidCurrency } from "@/lib/format/money";
import { checkUsername } from "@/lib/username";

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254);
export const nameSchema = z.string().trim().min(1, "Enter a name.").max(80, "Keep the name under 80 characters.");
export { newPasswordSchema };

/** Lowercased sign-in handle (see lib/username.ts). */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .superRefine((value, ctx) => {
    const result = checkUsername(value);
    if (!result.ok) ctx.addIssue({ code: "custom", message: result.error });
  });


export const workspaceSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine(isValidWorkspaceSlug, "Use 1–60 lowercase letters, numbers and dashes (not a reserved word).");

export const timeZoneSchema = z.string().trim().refine(isValidTimeZone, "Choose a valid time zone.");
export const currencySchema = z.string().trim().toUpperCase().refine(isValidCurrency, "Use a three-letter currency code such as INR.");

export const workspaceSettingsSchema = z.object({
  name: z.string().trim().min(2, "Enter a workspace name.").max(80),
  tagline: z.string().trim().max(140).optional().transform((v) => v || null),
  description: z.string().trim().max(2000).optional().transform((v) => v || null),
  timezone: timeZoneSchema,
  currency: currencySchema,
  financeVisibleToMembers: z.boolean(),
});

export const roleSchema = z.enum(["OWNER", "ADMIN", "MEMBER", "GUEST"]);
export const labelToneSchema = z.enum(["NEUTRAL", "SUCCESS", "WARNING", "INFO", "DANGER", "ACCENT", "HIGHLIGHT"]);
export const idSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
