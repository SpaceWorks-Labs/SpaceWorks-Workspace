import "server-only";
import { revalidatePath } from "@/lib/frontend/cache";
import { getWorkspaceForAction } from "@/lib/permissions";
import type { ChatContext } from "@/lib/chat/access";
import { slugSchema } from "./action-validation";

export const NOT_AVAILABLE = "That conversation isn't available.";

export async function context(slug: unknown): Promise<ChatContext | null> {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return null;
  return getWorkspaceForAction(parsed.data, "GUEST", { module: "chat" });
}

export function revalidateChat(slug: string) {
  revalidatePath(`/w/${slug}/chat`, "layout");
  revalidatePath(`/w/${slug}/dm`, "layout");
}

