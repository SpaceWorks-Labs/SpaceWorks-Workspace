import { z } from "zod";
import { REQUESTABLE_LIMIT_KEYS, REQUESTABLE_MODULES } from "./constants";

const message = z.string().trim().max(1000, "Keep the reason under 1000 characters.").optional().nullable();

export const newOrgSchema = z.object({
  name: z.string().trim().min(2, "Enter the organisation's name.").max(80, "Keep the name under 80 characters."),
  slug: z.string().trim().toLowerCase().min(1, "Enter an address for the organisation."),
  message,
});

export const moreLimitSchema = z.object({
  limit: z.enum(REQUESTABLE_LIMIT_KEYS, { message: "Choose a limit to raise." }),
  requested: z.number({ message: "Enter the number you need." }).int("Enter a whole number.").min(1, "Enter a number above zero."),
  message,
}).refine((value) => value.requested <= (value.limit === "maxStorageBytes" ? Number.MAX_SAFE_INTEGER : 2_147_483_647), { path: ["requested"], message: "That number is too large." });

export const featureSchema = z.object({
  module: z.string().refine((value) => REQUESTABLE_MODULES.includes(value), "Choose a feature to request."),
  message,
});

export const decisionNoteSchema = z.string().trim().max(1000, "Keep the note under 1000 characters.").optional().nullable();
