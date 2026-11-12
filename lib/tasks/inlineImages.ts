/**
 * Images pasted or dropped into a task description (pure, client-safe).
 * They are stored as private task files in a reserved folder and referenced
 * by the authenticated file route only: `/api/files/<id>`. The route applies
 * the same membership and private-team checks as attachments.
 */

export const INLINE_FOLDER = "/tasks/inline";

/** The only `src` a description image may carry. */
export const INLINE_IMAGE_SRC = /^\/api\/files\/[A-Za-z0-9_-]{1,64}$/;

export const isInlineImageSrc = (src: string | undefined | null): boolean => Boolean(src && INLINE_IMAGE_SRC.test(src));

export const INLINE_IMAGE_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
